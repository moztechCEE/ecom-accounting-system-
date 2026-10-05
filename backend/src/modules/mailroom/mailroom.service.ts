import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  DEPARTMENT_ACCESS_SELECT,
  effectivePermissionKeys,
} from '../../common/department-access/department-access';
import { NotificationGateway } from '../notification/notification.gateway';
import { MailroomSyncService } from './mailroom-sync.service';
import { AfterSalesStockService } from '../integration/after-sales/after-sales-stock.service';
import {
  can,
  fingerprint,
  isRepairWorkbenchItem,
  REPAIR_RETURN_STATUSES,
  requireEntity,
  requirePermission,
  transition,
  type Actor,
  type SourceCase,
} from './mailroom.contract';
import {
  CreateReceiptDto,
  MailroomCommandDto,
  MailroomQuery,
} from './mailroom.dto';
import {
  validateInspectionRelease,
  validateInspectionSubmission,
  validateRepairCompletion,
} from './repair-document.contract';
import {
  currentCsrReview,
  physicalCustody,
  repairWorkflow,
  sentCustomerWorkflow,
  requireSourceConsent,
  repairStatusLabel,
} from './repair-workflow.contract';

const actorSelect = {
  id: true,
  name: true,
  isActive: true,
  mustChangePassword: true,
  employee: { select: DEPARTMENT_ACCESS_SELECT },
  entityMemberships: { select: { entityId: true } },
  roles: {
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  },
} as const;
const withReceipt = { receipt: true } as const;
type Item = Prisma.MailroomItemGetPayload<{ include: typeof withReceipt }>;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const canViewRepairDocuments = (actor: Actor) =>
  can(actor, 'repair_workbench:read') || can(actor, 'mailroom:review');
const withoutRepairDocuments = <T extends object>(value: T): T => {
  const result = { ...value } as T & {
    repairInspection?: unknown;
    repairReport?: unknown;
    repairWorkflow?: unknown;
  };
  delete result.repairInspection;
  delete result.repairReport;
  delete result.repairWorkflow;
  return result;
};
function withoutRepairHistoryDocuments(
  value: Prisma.JsonValue,
): Prisma.JsonValue {
  if (Array.isArray(value)) return value.map(withoutRepairHistoryDocuments);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !['repairInspection', 'repairReport', 'repairWorkflow'].includes(key),
      )
      .map(([key, nested]) => [
        key,
        withoutRepairHistoryDocuments(nested as Prisma.JsonValue),
      ]),
  );
}

@Injectable()
export class MailroomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationGateway,
    private readonly sync: MailroomSyncService,
    @Optional() private readonly stock?: AfterSalesStockService,
  ) {}
  enabled() {
    if (process.env.MAILROOM_ENABLED !== 'true')
      throw new ServiceUnavailableException('收發室工作台尚未啟用');
  }
  async actor(id: string, tx?: Prisma.TransactionClient): Promise<Actor> {
    const user = await (tx || this.prisma).user.findUnique({
      where: { id },
      select: actorSelect,
    });
    if (
      !user?.isActive ||
      user.mustChangePassword ||
      (user.employee && !user.employee.isActive)
    )
      throw new ForbiddenException('帳號尚未完成設定或已停用');
    const admin = user.roles.some((x) =>
      ['ADMIN', 'SUPER_ADMIN'].includes(x.role.code),
    );
    const superAdmin = user.roles.some((x) => x.role.code === 'SUPER_ADMIN');
    return {
      id,
      name: user.name || '員工',
      permissions: new Set([
        ...effectivePermissionKeys(user),
        ...(admin ? ['*'] : []),
      ]),
      entityIds: superAdmin
        ? null
        : [
            ...new Set([
              ...(user.employee?.entityId ? [user.employee.entityId] : []),
              ...user.entityMemberships.map((x) => x.entityId),
            ]),
          ],
    };
  }
  private canRead(actor: Actor, item: Item) {
    requireEntity(actor, item.entityId);
    if (
      can(actor, 'mailroom:read') ||
      (can(actor, 'repair_workbench:read') && isRepairWorkbenchItem(item)) ||
      (can(actor, 'mailroom:review') && isRepairWorkbenchItem(item)) ||
      item.recipientId === actor.id
    )
      return;
    throw new ForbiddenException('無此物件存取權限');
  }
  private async target(userId: string, entityId: string, permission?: string) {
    const actor = await this.actor(userId);
    requireEntity(actor, entityId);
    const employee = await this.prisma.employee.findFirst({
      where: { userId, entityId, isActive: true },
      select: { id: true },
    });
    if (!employee)
      throw new BadRequestException('接收人必須是此公司已綁定帳號的在職員工');
    if (permission) requirePermission(actor, permission);
    return actor;
  }
  async people(userId: string, entityId: string) {
    this.enabled();
    const actor = await this.actor(userId);
    requireEntity(actor, entityId);
    if (!can(actor, 'mailroom:read') && !can(actor, 'repair_workbench:read'))
      throw new ForbiddenException();
    const rows = await this.prisma.employee.findMany({
      where: {
        entityId,
        isActive: true,
        userId: { not: null },
        user: { isActive: true, mustChangePassword: false },
      },
      select: {
        userId: true,
        name: true,
        employeeNo: true,
        department: { select: { name: true } },
      },
      orderBy: { employeeNo: 'asc' },
      take: 1000,
    });
    const result: Array<{
      id: string;
      name: string;
      employeeNo: string;
      department: string;
      repair: boolean;
      mailroom: boolean;
    }> = [];
    for (const row of rows) {
      const person = await this.actor(row.userId!);
      result.push({
        id: row.userId!,
        name: row.name,
        employeeNo: row.employeeNo,
        department: row.department?.name || '未分部門',
        repair: can(person, 'repair_workbench:update'),
        mailroom: can(person, 'mailroom:update'),
      });
    }
    return result;
  }
  async sourceCases(
    userId: string,
    entityId: string,
    search?: string,
    options: { awaiting?: boolean; cursor?: string } = {},
  ) {
    this.enabled();
    const actor = await this.actor(userId);
    requireEntity(actor, entityId);
    if (!can(actor, 'mailroom:read') && !can(actor, 'repair_workbench:read'))
      throw new ForbiddenException('沒有此作業權限');
    const result = await this.sync.cases(entityId, search, undefined, options);
    return can(actor, 'mailroom:read')
      ? result
      : {
          ...result,
          items: result.items.filter((source) => source.type === 'REPAIR'),
        };
  }
  private async customerService(
    source: SourceCase | undefined,
    entityId: string,
    tx?: Prisma.TransactionClient,
  ) {
    if (!source?.assigneeId || !source.assigneeEmail) return null;
    const rows = await (tx || this.prisma).user.findMany({
      where: {
        email: { equals: source.assigneeEmail, mode: 'insensitive' },
        isActive: true,
        mustChangePassword: false,
        employee: { entityId, isActive: true },
      },
      select: actorSelect,
      take: 2,
    });
    if (rows.length !== 1) return null;
    const candidate = await this.actor(rows[0].id, tx);
    return can(candidate, 'mailroom:review') ? candidate.id : null;
  }
  async list(userId: string, query: MailroomQuery) {
    this.enabled();
    const actor = await this.actor(userId);
    requireEntity(actor, query.entityId);
    const mode = query.view || 'mailroom';
    if (mode !== 'mine')
      requirePermission(
        actor,
        mode === 'repair' ? 'repair_workbench:read' : 'mailroom:read',
      );
    const where: Prisma.MailroomItemWhereInput = {
      entityId: query.entityId,
      ...(mode === 'mine' ? { recipientId: userId } : {}),
    };
    const and: Prisma.MailroomItemWhereInput[] = [];
    if (mode === 'repair') {
      and.push({
        OR: [
          { receipt: { category: 'REPAIR' } },
          {
            receipt: { category: 'RETURN' },
            OR: [
              { status: { in: [...REPAIR_RETURN_STATUSES] } },
              { repairOwnerId: { not: null } },
            ],
          },
        ],
      });
      switch (query.repairScope || 'all') {
        case 'mine':
          and.push({ OR: [{ nextUserId: userId }, { repairOwnerId: userId }] });
          break;
        case 'acceptance':
          and.push({
            status: { in: ['WAITING_REPAIR_ACCEPTANCE', 'PENDING_REFURBISH'] },
          });
          break;
        case 'waiting':
          and.push({
            status: {
              in: [
                'WAITING_CUSTOMER',
                'FACTORY_OUTBOUND',
                'FACTORY_RECEIVED',
                'FACTORY_RETURNING',
              ],
            },
          });
          break;
        case 'delivery':
          and.push({ status: 'WAITING_RETURN_ACCEPTANCE' });
          break;
        case 'records':
          and.push({
            status: { in: ['READY_FOR_DISPATCH', 'PENDING_WELFARE_STOCK'] },
          });
          break;
      }
    }
    if (query.status) and.push({ status: query.status });
    if (query.search?.trim())
      and.push({
        OR: ['productName', 'sku', 'serialNumber', 'label', 'location']
          .map((key) => ({
            [key]: { contains: query.search!.trim(), mode: 'insensitive' },
          }))
          .concat([
            {
              receipt: {
                sourceNumber: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
            },
            {
              receipt: {
                trackingNumber: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
            },
          ] as any),
      });
    if (and.length) where.AND = and;
    const [total, rows] = await Promise.all([
      this.prisma.mailroomItem.count({ where }),
      this.prisma.mailroomItem.findMany({
        where,
        include: withReceipt,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 50,
        skip: ((query.page || 1) - 1) * 50,
      }),
    ]);
    return {
      total,
      items: await this.views(rows, userId, actor),
      page: query.page || 1,
    };
  }
  async views(items: Item[], userId: string, actor: Actor) {
    const ids = [
      ...new Set(
        items
          .flatMap((x) => [
            x.custodianId,
            x.nextUserId,
            x.recipientId,
            x.repairOwnerId,
            repairWorkflow(x.repairWorkflow).csr?.ownerId,
          ])
          .filter(Boolean),
      ),
    ] as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((x) => [x.id, x.name]));
    return items.map(({ evidence, receipt, ...item }) => ({
      ...(canViewRepairDocuments(actor) ? item : withoutRepairDocuments(item)),
      statusLabel: repairStatusLabel({ ...item, receipt }),
      physicalCustody: isRepairWorkbenchItem({ ...item, receipt })
        ? physicalCustody({ ...item, receipt })
        : undefined,
      releasePurpose:
        repairWorkflow(item.repairWorkflow).release?.purpose || null,
      custodianName: names.get(item.custodianId) || '未綁定',
      repairOwnerName: item.repairOwnerId
        ? names.get(item.repairOwnerId) || '已停用／待轉派'
        : null,
      customerOwnerName: repairWorkflow(item.repairWorkflow).csr?.ownerId
        ? names.get(repairWorkflow(item.repairWorkflow).csr!.ownerId!) ||
          '已停用／待轉派'
        : null,
      nextUserName: item.nextUserId
        ? names.get(item.nextUserId) || '已停用／待轉派'
        : null,
      recipientName: item.recipientId
        ? names.get(item.recipientId) || '已停用／待確認'
        : null,
      evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
      mine: item.nextUserId === userId,
      receipt: {
        id: receipt.id,
        number: receipt.number,
        category: receipt.category,
        sourceCaseId: receipt.sourceCaseId,
        sourceNumber: receipt.sourceNumber,
        customerServiceUserId: receipt.customerServiceUserId,
        carrier: receipt.carrier,
        trackingNumber: receipt.trackingNumber,
        senderLabel: receipt.senderLabel,
        receivedAt: receipt.receivedAt,
      },
    }));
  }
  async detail(userId: string, entityId: string, id: string) {
    this.enabled();
    const actor = await this.actor(userId);
    const item = await this.prisma.mailroomItem.findUnique({
      where: { id },
      include: withReceipt,
    });
    if (!item || item.entityId !== entityId)
      throw new NotFoundException('找不到物件');
    this.canRead(actor, item);
    const [history, deliveries, deliverySummary] = await Promise.all([
      this.prisma.mailroomAction.findMany({
        where: { itemId: id },
        orderBy: { version: 'asc' },
        select: {
          id: true,
          actorName: true,
          action: true,
          fromStatus: true,
          toStatus: true,
          version: true,
          note: true,
          snapshot: true,
          createdAt: true,
        },
      }),
      this.prisma.mailroomDelivery.findMany({
        where: { itemId: id },
        select: {
          id: true,
          target: true,
          status: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          deliveredAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.mailroomDelivery.groupBy({
        by: ['target', 'status'],
        where: { itemId: id },
        _count: true,
      }),
    ]);
    return {
      ...(await this.views([item], userId, actor))[0],
      evidence: item.evidence || [],
      history: canViewRepairDocuments(actor)
        ? history
        : history.map((entry) => ({
            ...entry,
            snapshot: withoutRepairHistoryDocuments(entry.snapshot),
          })),
      deliverySummary: deliverySummary.map((x) => ({
        target: x.target,
        status: x.status,
        count: x._count,
      })),
      deliveries: item.receipt.sourceCaseId ? deliveries : [],
    };
  }
  async tasks(userId: string, entityId: string) {
    this.enabled();
    const actor = await this.actor(userId);
    requireEntity(actor, entityId);
    const tasks = await this.prisma.mailroomTask.findMany({
      where: { userId, entityId, status: 'OPEN' },
      include: { item: { include: withReceipt } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const result = [] as Array<Record<string, unknown>>;
    for (const task of tasks) {
      try {
        this.canRead(actor, task.item);
      } catch {
        continue;
      }
      result.push({
        id: task.id,
        kind: task.kind,
        createdAt: task.createdAt,
        item: (await this.views([task.item], userId, actor))[0],
      });
    }
    return result;
  }
  private itemSnapshot(item: Item) {
    return {
      label: item.label,
      productName: item.productName,
      sku: item.sku,
      serialNumber: item.serialNumber,
      status: item.status,
      matchResult: item.matchResult,
      grade: item.grade,
      disposition: item.disposition,
      location: item.location,
      custodianId: item.custodianId,
      nextUserId: item.nextUserId,
      quantity: 1,
      evidenceCount: Array.isArray(item.evidence) ? item.evidence.length : 0,
      returnInspection: item.returnInspection,
      releasePurpose:
        repairWorkflow(item.repairWorkflow).release?.purpose || null,
      physicalCustody: isRepairWorkbenchItem(item)
        ? physicalCustody(item)
        : undefined,
    };
  }
  async record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    item: Item,
    action: string,
    requestId: string,
    requestHash: string,
    fromStatus: string | null,
    note: string | undefined,
    replaceTasks: boolean,
    evidenceChanged = false,
    tabletHandoff?: { clerkId: string; clerkName: string; signerId: string },
  ) {
    const entry = await tx.mailroomAction.create({
      data: {
        entityId: item.entityId,
        itemId: item.id,
        actorId: actor.id,
        actorName: actor.name,
        requestId,
        requestHash,
        action,
        fromStatus,
        toStatus: item.status,
        version: item.version,
        note,
        snapshot: json({
          ...this.itemSnapshot(item),
          repairInspection: (item as Item & { repairInspection?: unknown })
            .repairInspection,
          repairReport: (item as Item & { repairReport?: unknown })
            .repairReport,
          repairWorkflow: item.repairWorkflow,
          ...(evidenceChanged ? { evidence: item.evidence || [] } : {}),
          ...(tabletHandoff ? { tabletHandoff } : {}),
        }),
      },
    });
    const notifications: Array<{
      userId: string;
      id: string;
      title: string;
      message: string;
      category: string;
      type: string;
      data: Prisma.JsonValue | null;
      read: boolean;
      createdAt: Date;
    }> = [];
    if (replaceTasks) {
      const recipients = new Map<string, string>();
      if (item.nextUserId && item.status !== 'COLLECTED')
        recipients.set(item.nextUserId, item.status);
      if (['MISMATCH', 'WAITING_CUSTOMER'].includes(item.status)) {
        const csr = repairWorkflow(item.repairWorkflow).csr;
        const customerOwner =
          item.status === 'WAITING_CUSTOMER' && csr?.status === 'ACCEPTED'
            ? csr.ownerId
            : item.receipt.customerServiceUserId;
        if (customerOwner)
          recipients.set(
            customerOwner,
            item.status === 'WAITING_CUSTOMER' && csr?.status === 'ACCEPTED'
              ? 'CUSTOMER_ACCEPTED'
              : item.status,
          );
      }
      const inspection = item.returnInspection as {
        reviewedAt?: string;
      } | null;
      if (
        item.receipt.category === 'RETURN' &&
        inspection &&
        !inspection.reviewedAt &&
        item.status !== 'MISMATCH' &&
        item.receipt.customerServiceUserId
      )
        recipients.set(item.receipt.customerServiceUserId, 'RETURN_REVIEW');
      const existing = await tx.mailroomTask.findMany({
        where: { itemId: item.id, status: 'OPEN' },
      });
      const removed = existing.filter(
        (task) => recipients.get(task.userId) !== task.kind,
      );
      if (removed.length)
        await tx.mailroomTask.updateMany({
          where: { id: { in: removed.map((x) => x.id) } },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      for (const [userId, kind] of recipients) {
        const open = existing.find(
          (task) => task.userId === userId && task.kind === kind,
        );
        if (open) {
          await tx.mailroomTask.update({
            where: { id: open.id },
            data: { version: item.version },
          });
          continue;
        }
        const receiver = await this.actor(userId, tx).catch(() => null);
        if (
          !receiver ||
          (receiver.entityIds !== null &&
            !receiver.entityIds.includes(item.entityId))
        )
          continue;
        if (
          (userId === item.receipt.customerServiceUserId ||
            kind === 'CUSTOMER_ACCEPTED') &&
          !can(receiver, 'mailroom:review')
        )
          continue;
        await tx.mailroomTask.create({
          data: {
            entityId: item.entityId,
            itemId: item.id,
            userId,
            kind,
            version: item.version,
          },
        });
        if (userId === actor.id) continue;
        notifications.push(
          await tx.notification.create({
            data: {
              userId,
              title:
                kind === 'RETURN_REVIEW'
                  ? '退貨檢查完成，待客服接手'
                  : kind === 'CUSTOMER_ACCEPTED'
                    ? '客服已接手檢修交辦'
                    : repairStatusLabel(item),
              message:
                item.label + ' · ' + item.productName + ' · ' + item.location,
              type: item.status === 'MISMATCH' ? 'warning' : 'info',
              category: 'mailroom',
              data: {
                itemId: item.id,
                entityId: item.entityId,
                targetPath:
                  '/my/inbox?itemId=' +
                  item.id +
                  '&entityId=' +
                  encodeURIComponent(item.entityId),
              },
            },
          }),
        );
      }
    }
    if (item.receipt.sourceCaseId) {
      const payload = {
        schema: 'corely.mailroom.v1',
        eventId: entry.id,
        entityId: item.entityId,
        sourceCaseId: item.receipt.sourceCaseId,
        sourceNumber: item.receipt.sourceNumber,
        itemId: item.id,
        receiptId: item.receiptId,
        version: item.version,
        action,
        occurredAt: entry.createdAt.toISOString(),
        receivedAt: item.receipt.receivedAt.toISOString(),
        actor: { id: actor.id, name: actor.name },
        item: {
          ...this.itemSnapshot(item),
          declared: item.declared,
          conditionNote: item.conditionNote,
          evidenceCount: Array.isArray(item.evidence)
            ? item.evidence.length
            : 0,
        },
        customerDecisionRequired: ['MISMATCH', 'WAITING_CUSTOMER'].includes(
          item.status,
        ),
        inventoryPosted: false,
        refundExecuted: false,
      };
      await tx.mailroomDelivery.createMany({
        data: ['AFTER_SALES', 'AI_CUSTOMER_SERVICE'].map((target) => ({
          eventId: entry.id,
          entityId: item.entityId,
          itemId: item.id,
          target,
          payload: json(payload),
        })),
      });
    }
    return notifications;
  }
  publish(notifications: Array<{ userId: string }>) {
    for (const notification of notifications) {
      try {
        this.gateway.sendToUser(notification.userId, notification);
      } catch {
        /* Persisted notification remains available through GET. */
      }
    }
    void this.sync.deliverPending().catch(() => undefined);
  }
  async create(userId: string, input: CreateReceiptDto) {
    this.enabled();
    const actor = await this.actor(userId);
    requirePermission(actor, 'mailroom:create');
    requireEntity(actor, input.entityId);
    if (
      !input.location.trim() ||
      input.items.some((x) => !x.productName.trim())
    )
      throw new BadRequestException('請填寫物件與存放位置');
    if (input.category === 'UNMATCHED' && input.items.length !== 1)
      throw new BadRequestException('待辨識物件請逐件登記，以便補登不同歸屬');
    const hash = fingerprint(input);
    const previous = await this.prisma.mailroomReceipt.findUnique({
      where: {
        entityId_receivedById_requestId: {
          entityId: input.entityId,
          receivedById: userId,
          requestId: input.requestId,
        },
      },
      include: { items: true },
    });
    if (previous) {
      if (previous.requestHash !== hash)
        throw new ConflictException('同一收件請求的內容不同');
      return {
        id: previous.id,
        itemIds: previous.items.map((x) => x.id),
        duplicate: true,
      };
    }
    let source: SourceCase | undefined;
    if (['REPAIR', 'RETURN'].includes(input.category)) {
      if (!input.sourceCaseId)
        throw new BadRequestException(
          '請先選擇售後案件；不明包裹請使用待辨識類別',
        );
      source = (await this.sync.cases(input.entityId, '', input.sourceCaseId))
        .items[0];
      if (
        !source ||
        source.type !== input.category ||
        ['CANCELLED', 'CLOSED', 'COMPLETED'].includes(source.status)
      )
        throw new BadRequestException('售後案件類別不符');
    } else if (input.sourceCaseId)
      throw new BadRequestException('信件、員工包裹及待辨識件不可掛售後案件');
    if (['LETTER', 'PARCEL'].includes(input.category) && !input.recipientId)
      throw new BadRequestException(
        '請選擇已確認身分的收件同仁；不明收件人請先列待辨識',
      );
    if (input.recipientId && !['LETTER', 'PARCEL'].includes(input.category))
      throw new BadRequestException(
        '售後件與待辨識件須先核對，不能直接指定一般收件人',
      );
    if (input.recipientId) await this.target(input.recipientId, input.entityId);
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize the operation key, so a retried click cannot create a second receipt.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':' + userId + ':' + input.requestId}))`,
      );
      const duplicate = await tx.mailroomReceipt.findUnique({
        where: {
          entityId_receivedById_requestId: {
            entityId: input.entityId,
            receivedById: userId,
            requestId: input.requestId,
          },
        },
        include: { items: true },
      });
      if (duplicate) {
        if (duplicate.requestHash !== hash)
          throw new ConflictException('同一收件請求的內容不同');
        return {
          id: duplicate.id,
          itemIds: duplicate.items.map((x) => x.id),
          duplicate: true,
          notifications: [],
        };
      }
      const number =
        'MR-' +
        new Date().toISOString().slice(0, 10).replace(/-/g, '') +
        '-' +
        randomUUID().slice(0, 8).toUpperCase();
      const receipt = await tx.mailroomReceipt.create({
        data: {
          entityId: input.entityId,
          number,
          category: input.category,
          sourceCaseId: source?.id,
          sourceNumber: source?.number,
          sourceSnapshot: source ? json(source) : undefined,
          customerServiceUserId: await this.customerService(
            source,
            input.entityId,
            tx,
          ),
          carrier: input.carrier?.trim(),
          trackingNumber: input.trackingNumber?.trim(),
          senderLabel: input.senderLabel?.trim(),
          receivedById: userId,
          requestId: input.requestId,
          requestHash: hash,
        },
      });
      const itemIds: string[] = [];
      const notifications: any[] = [];
      for (let i = 0; i < input.items.length; i++) {
        const row = input.items[i];
        const declared = source?.items.find((x) => x.id === row.sourceItemId);
        if (source && !declared)
          throw new BadRequestException('請將每件物件關聯到來源申報品項');
        const item = await tx.mailroomItem.create({
          data: {
            receiptId: receipt.id,
            entityId: input.entityId,
            label: number + '-' + (i + 1),
            productName: row.productName.trim(),
            sku: row.sku?.trim() || null,
            serialNumber: row.serialNumber?.trim() || null,
            declared: declared ? json(declared) : undefined,
            status: input.recipientId ? 'WAITING_PICKUP' : 'RECEIVED',
            location: input.location.trim(),
            custodianId: userId,
            recipientId: input.recipientId,
            nextUserId: input.recipientId,
          },
          include: withReceipt,
        });
        itemIds.push(item.id);
        notifications.push(
          ...(await this.record(
            tx,
            actor,
            item,
            'receive',
            input.requestId + ':' + i,
            hash,
            null,
            undefined,
            true,
          )),
        );
      }
      return { id: receipt.id, itemIds, duplicate: false, notifications };
    });
    this.publish(result.notifications);
    return {
      id: result.id,
      itemIds: result.itemIds,
      duplicate: result.duplicate,
    };
  }
  async command(
    userId: string,
    id: string,
    input: MailroomCommandDto,
    context?: { tabletClerkId: string },
  ) {
    this.enabled();
    const actor = await this.actor(userId);
    requireEntity(actor, input.entityId);
    const hash = fingerprint({
      id,
      ...input,
      ...(context ? { tabletClerkId: context.tabletClerkId } : {}),
    });
    const current = await this.prisma.mailroomItem.findUnique({
      where: { id },
      include: withReceipt,
    });
    if (!current || current.entityId !== input.entityId)
      throw new NotFoundException('找不到物件');
    this.canRead(actor, current);
    let identifiedSource: SourceCase | undefined;
    if (
      input.action === 'identify' &&
      ['REPAIR', 'RETURN'].includes(input.targetCategory || '')
    ) {
      if (!input.sourceCaseId)
        throw new BadRequestException('請選擇對應售後案件');
      identifiedSource = (
        await this.sync.cases(input.entityId, '', input.sourceCaseId)
      ).items[0];
      if (
        !identifiedSource ||
        identifiedSource.type !== input.targetCategory ||
        ['CANCELLED', 'CLOSED', 'COMPLETED'].includes(
          identifiedSource.status,
        ) ||
        !identifiedSource.items.some((x) => x.id === input.sourceItemId)
      )
        throw new BadRequestException('來源案件或申報品項不符');
    }
    let repairAllowed = false;
    let repairSource: SourceCase | undefined;
    const requireCompletionRelease =
      input.action === 'complete_repair' &&
      (!!repairWorkflow(current.repairWorkflow).csr ||
        (current.repairReport as { data?: { outcome?: string } } | null)?.data
          ?.outcome === 'REPLACED');
    if (
      (input.action === 'start_repair' || requireCompletionRelease) &&
      current.receipt.sourceCaseId
    ) {
      const committed = await this.prisma.mailroomAction.findUnique({
        where: {
          entityId_actorId_requestId: {
            entityId: input.entityId,
            actorId: userId,
            requestId: input.requestId,
          },
        },
      });
      if (!committed)
        repairSource = (
          await this.sync.cases(
            input.entityId,
            '',
            current.receipt.sourceCaseId,
          )
        ).items[0];
      repairAllowed =
        repairSource?.id === current.receipt.sourceCaseId &&
        repairSource.type === current.receipt.category &&
        repairSource.repairAllowed === true;
    }
    const refreshCustomerService = [
      'inspect',
      'grade',
      'resolve_mismatch',
      'resolve_customer',
      'await_customer',
      'acknowledge_inspection',
    ].includes(input.action);
    let latestAssignee: SourceCase | undefined;
    if (refreshCustomerService && current.receipt.sourceCaseId) {
      // A committed retry does not depend on another source fetch. Its exact hash and
      // current actor permissions are still verified inside the transaction below.
      const committed = await this.prisma.mailroomAction.findUnique({
        where: {
          entityId_actorId_requestId: {
            entityId: input.entityId,
            actorId: userId,
            requestId: input.requestId,
          },
        },
        select: { id: true },
      });
      if (!committed) {
        latestAssignee = (
          await this.sync.cases(
            input.entityId,
            '',
            current.receipt.sourceCaseId,
          )
        ).items[0];
        if (
          !latestAssignee ||
          latestAssignee.id !== current.receipt.sourceCaseId ||
          latestAssignee.type !== current.receipt.category
        )
          throw new BadRequestException('無法確認此售後案件目前的承辦客服');
      }
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_items WHERE id=${id} FOR UPDATE`,
      );
      const previous = await tx.mailroomAction.findUnique({
        where: {
          entityId_actorId_requestId: {
            entityId: input.entityId,
            actorId: userId,
            requestId: input.requestId,
          },
        },
      });
      const freshActor = await this.actor(userId, tx);
      requireEntity(freshActor, input.entityId);
      if (input.action === 'claim') {
        requirePermission(freshActor, 'repair_workbench:update');
        const employee = await tx.employee.findFirst({
          where: { userId, entityId: input.entityId, isActive: true },
          select: { id: true },
        });
        if (!employee)
          throw new BadRequestException(
            '認領人必須是此公司已綁定帳號的在職員工',
          );
      }
      let clerk: Actor | undefined;
      if (context) {
        clerk = await this.actor(context.tabletClerkId, tx);
        requireEntity(clerk, input.entityId);
        requirePermission(clerk, 'mailroom:update');
        if (input.action !== 'accept')
          throw new ForbiddenException('平板只能執行本人簽收');
        requirePermission(freshActor, 'repair_workbench:update');
      }
      if (previous) {
        if (previous.requestHash !== hash || previous.itemId !== id)
          throw new ConflictException('同一操作識別碼的內容不同');
        return { duplicate: true, notifications: [] };
      }
      const item = await tx.mailroomItem.findUniqueOrThrow({
        where: { id },
        include: withReceipt,
      });
      this.canRead(freshActor, item);
      if (
        clerk &&
        (item.custodianId !== clerk.id ||
          !['WAITING_REPAIR_ACCEPTANCE', 'PENDING_REFURBISH'].includes(
            item.status,
          ))
      )
        throw new ForbiddenException('這件物件目前不在此收發人員的交接範圍');
      if (identifiedSource)
        await tx.mailroomReceipt.update({
          where: { id: item.receiptId },
          data: {
            customerServiceUserId: await this.customerService(
              identifiedSource,
              item.entityId,
              tx,
            ),
          },
        });
      let reassignedInspection: Prisma.InputJsonValue | undefined;
      if (refreshCustomerService) {
        const baseline = item.receipt.sourceSnapshot as unknown as
          | SourceCase
          | undefined;
        // Refresh only staff routing. Original declared items, source version,
        // customer claim and approval snapshot remain the receipt's original evidence.
        const sourceForRouting = latestAssignee
          ? ({
              ...baseline,
              assigneeId: latestAssignee.assigneeId ?? null,
              assigneeEmail: latestAssignee.assigneeEmail ?? null,
              assigneeName: latestAssignee.assigneeName ?? null,
            } as SourceCase)
          : baseline;
        const customerServiceUserId = await this.customerService(
          sourceForRouting,
          item.entityId,
          tx,
        );
        const previousCustomerServiceUserId =
          item.receipt.customerServiceUserId;
        await tx.mailroomReceipt.update({
          where: { id: item.receiptId },
          data: {
            customerServiceUserId,
            ...(latestAssignee
              ? { sourceSnapshot: json(sourceForRouting) }
              : {}),
          },
        });
        item.receipt.customerServiceUserId = customerServiceUserId;
        if (latestAssignee)
          item.receipt.sourceSnapshot = json(
            sourceForRouting,
          ) as Prisma.JsonValue;
        const inspection = item.returnInspection as {
          reviewedAt?: string;
          reviewedBy?: string;
        } | null;
        if (
          item.receipt.category === 'RETURN' &&
          inspection?.reviewedAt &&
          previousCustomerServiceUserId !== customerServiceUserId
        ) {
          const checks = { ...inspection };
          delete checks.reviewedAt;
          delete checks.reviewedBy;
          reassignedInspection = json(checks);
          item.returnInspection = reassignedInspection as Prisma.JsonValue;
        }
        if (
          ['resolve_mismatch', 'resolve_customer'].includes(input.action) &&
          customerServiceUserId !== freshActor.id &&
          !can(freshActor, '*')
        )
          throw new ForbiddenException('僅此案件的承辦客服可確認顧客結果');
      }
      const documents = item as Item & {
        repairInspection?: unknown;
        repairReport?: unknown;
      };
      const workflow = repairWorkflow(item.repairWorkflow);
      if (
        [
          'move',
          'start_inspection',
          'await_customer',
          'start_repair',
          'complete_repair',
          'complete_refurbish',
        ].includes(input.action) &&
        isRepairWorkbenchItem(item) &&
        physicalCustody(item) !== 'TECHNICIAN'
      )
        throw new ConflictException('實物目前在原廠或物流，須先由本人簽收返還');
      if (input.action === 'resolve_customer' && workflow.csr)
        throw new BadRequestException(
          '請先本人接手客服交辦，再以檢修版本與顧客決定回覆',
        );
      let reviewedInspection: Prisma.InputJsonValue | undefined;
      if (
        input.action === 'resolve_customer' &&
        (documents.repairInspection as { status?: string } | null)?.status ===
          'SUBMITTED'
      ) {
        const inspection = validateInspectionSubmission(
          documents.repairInspection,
        );
        reviewedInspection = json({
          ...inspection,
          review: {
            inspectionRevision: inspection.revision,
            actorId: freshActor.id,
            name: freshActor.name,
            confirmedAt: new Date().toISOString(),
          },
        });
      }
      if (['await_customer', 'start_repair'].includes(input.action)) {
        const inspection = validateInspectionSubmission(
          documents.repairInspection,
        );
        if (
          input.action === 'start_repair' &&
          !['REPAIR', 'REPLACE'].includes(inspection.data.plan)
        )
          throw new BadRequestException(
            '送原廠或原件返還方案須由客服安排，不能直接開始維修',
          );
        if (input.action === 'start_repair')
          validateInspectionRelease(documents.repairInspection);
        if (input.action === 'start_repair' && workflow.csr) {
          currentCsrReview(item);
          if (workflow.csr.decision !== 'APPROVE')
            throw new ConflictException('顧客未同意目前檢修方案');
          if (
            !repairSource ||
            repairSource.id !== item.receipt.sourceCaseId ||
            repairSource.type !== item.receipt.category
          )
            throw new ConflictException('來源案件不符或尚未放行');
          requireSourceConsent(repairSource, workflow.csr.quoteRevision, true);
        }
      }
      if (['complete_repair', 'complete_refurbish'].includes(input.action))
        validateRepairCompletion(
          documents.repairInspection,
          documents.repairReport,
        );
      if (requireCompletionRelease) {
        if (
          !repairAllowed ||
          !repairSource ||
          repairSource.id !== item.receipt.sourceCaseId ||
          repairSource.type !== item.receipt.category
        )
          throw new ConflictException('目前售後同意與收款尚未放行');
        if (workflow.csr) {
          currentCsrReview(item);
          if (workflow.csr.decision !== 'APPROVE')
            throw new ConflictException('顧客尚未同意此處置');
          requireSourceConsent(repairSource, workflow.csr.quoteRevision, true);
        }
      }
      const { changes, replaceTasks } = transition(
        item,
        input,
        freshActor,
        repairAllowed,
      );
      if (input.action === 'await_customer') {
        changes.repairWorkflow = json(
          sentCustomerWorkflow(
            item,
            freshActor,
            new Date().toISOString(),
            latestAssignee?.releaseInfo?.quoteRevision || null,
          ),
        );
        changes.nextUserId = null;
      }
      if (['complete_repair', 'complete_refurbish'].includes(input.action)) {
        const report = validateRepairCompletion(
          documents.repairInspection,
          documents.repairReport,
        );
        let stockProof:
          | Awaited<ReturnType<AfterSalesStockService['consumeForRepair']>>
          | undefined;
        if (report.data.outcome === 'REPLACED') {
          if (
            item.serialNumber &&
            report.data.replacementSerial?.trim() === item.serialNumber.trim()
          )
            throw new BadRequestException('替換件序號不可與原件相同');
          if (input.action !== 'complete_repair')
            throw new BadRequestException('整新作業不可用換機出庫代替');
          if (!this.stock)
            throw new ServiceUnavailableException('售後換機正式庫存尚未設定');
          stockProof = await this.stock.consumeForRepair(
            tx,
            item.entityId,
            item,
            freshActor.id,
            input.requestId,
            report.data.replacementSerial,
            report.data.replacementSku,
            report.data.replacementCondition,
          );
          if (
            stockProof.status !== 'POSTED' ||
            stockProof.entityId !== item.entityId ||
            stockProof.itemId !== item.id ||
            stockProof.quantity !== 1 ||
            !stockProof.postingId
          )
            throw new ConflictException('正式換機庫存出庫證明不符，不能放行');
        }
        changes.repairWorkflow = json({
          ...workflow,
          release: {
            purpose: report.data.outcome,
            inspectionRevision: report.inspectionRevision,
            releasedAt: new Date().toISOString(),
            releasedBy: freshActor.id,
            note: input.note,
            ...(stockProof ? { stock: stockProof } : {}),
          },
        });
      }
      if (reassignedInspection && changes.returnInspection === undefined)
        changes.returnInspection = reassignedInspection;
      if (reviewedInspection) changes.repairInspection = reviewedInspection;
      if (input.action === 'identify') {
        if (
          (await tx.mailroomItem.count({
            where: { receiptId: item.receiptId },
          })) !== 1
        )
          throw new BadRequestException(
            '此待辨識收件不是逐件登記，需先由管理員核對',
          );
        if (!identifiedSource && (input.sourceCaseId || input.sourceItemId))
          throw new BadRequestException('一般收件不可掛售後案件');
        await tx.mailroomReceipt.update({
          where: { id: item.receiptId },
          data: {
            category: input.targetCategory!,
            sourceCaseId: identifiedSource?.id || null,
            sourceNumber: identifiedSource?.number || null,
            sourceSnapshot: identifiedSource
              ? json(identifiedSource)
              : Prisma.DbNull,
          },
        });
        if (identifiedSource)
          changes.declared = json(
            identifiedSource.items.find((x) => x.id === input.sourceItemId),
          );
      }
      if (input.nextUserId) {
        const status =
          typeof changes.status === 'string' ? changes.status : item.status;
        await this.target(
          input.nextUserId,
          item.entityId,
          ['WAITING_REPAIR_ACCEPTANCE', 'PENDING_REFURBISH'].includes(status)
            ? 'repair_workbench:update'
            : status === 'WAITING_RETURN_ACCEPTANCE'
              ? 'mailroom:update'
              : undefined,
        );
      }
      if (
        ['inspect', 'grade'].includes(input.action) &&
        input.matchResult === 'MATCH' &&
        item.matchResult !== 'CONFIRMED_ACTUAL'
      ) {
        const declared = item.declared as {
          sku?: string;
          serialNumber?: string;
        } | null;
        if (
          (declared?.sku &&
            declared.sku !==
              ((input.action === 'grade' ? item.sku : input.sku)?.trim() ||
                '')) ||
          (declared?.serialNumber &&
            declared.serialNumber !==
              ((input.action === 'grade'
                ? item.serialNumber
                : input.serialNumber
              )?.trim() || ''))
        )
          throw new BadRequestException(
            '實收 SKU／SN 與申報不一致，請列為品項不符',
          );
      }
      const updated = await tx.mailroomItem.update({
        where: { id },
        data: {
          ...changes,
          version: { increment: 1 },
        } as Prisma.MailroomItemUpdateInput,
        include: withReceipt,
      });
      const notifications = await this.record(
        tx,
        freshActor,
        updated,
        input.action,
        input.requestId,
        hash,
        item.status,
        input.note?.trim(),
        replaceTasks,
        input.evidence !== undefined,
        clerk
          ? {
              clerkId: clerk.id,
              clerkName: clerk.name,
              signerId: freshActor.id,
            }
          : undefined,
      );
      return { duplicate: false, notifications };
    });
    this.publish(result.notifications);
    return { id, duplicate: result.duplicate };
  }
  async caseProgress(entityId: string, sourceCaseId: string) {
    this.enabled();
    const items = await this.prisma.mailroomItem.findMany({
      where: { entityId, receipt: { sourceCaseId } },
      include: withReceipt,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return {
      sourceCaseId,
      items: items.map((item) => ({
        itemId: item.id,
        version: item.version,
        category: item.receipt.category,
        status: item.status,
        statusLabel: repairStatusLabel(item),
        releasePurpose:
          repairWorkflow(item.repairWorkflow).release?.purpose || null,
        physicalCustody: isRepairWorkbenchItem(item)
          ? physicalCustody(item)
          : undefined,
        declared: item.declared,
        productName: item.productName,
        sku: item.sku,
        serialNumber: item.serialNumber,
        matchResult: item.matchResult,
        grade: item.grade,
        disposition: item.disposition,
        conditionNote: item.conditionNote,
        receivedAt: item.receipt.receivedAt,
        updatedAt: item.updatedAt,
        customerDecisionRequired: ['MISMATCH', 'WAITING_CUSTOMER'].includes(
          item.status,
        ),
        inventoryPosted: false,
        refundExecuted: false,
      })),
    };
  }
}
