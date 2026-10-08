import { ErpAfterSalesModuleService } from '../integration/after-sales/erp-module.service';
import {
  allowedIntakeActions,
  caseIntake,
  caseIntakeSummary,
  isIntakeReader,
} from './mailroom-intake.contract';
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
import { consumedReturnCustody } from './repair-stock-custody.contract';
import { sourceSyncSummary } from './mailroom-source.contract';
import {
  dispatchText,
  dispatchedLocation,
  dispatchedPhysicalItem,
  outboundShipment,
  type OutboundShipment,
} from './mailroom-dispatch.contract';
import {
  can,
  fingerprint,
  isRepairWorkbenchItem,
  requireEntity,
  requirePermission,
  transition,
  STATUS_LABELS,
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
import {
  REPAIR_LIST_SCOPES,
  repairConditions,
  repairOverview,
  repairPhoto as nativeRepairPhoto,
  type RepairListScope,
} from './repair-list.contract';
import {
  receiptLinkChanges,
  requireReceiptSourceVersion,
  resolveReceiptLocation,
  validateReceiptPayload,
  validateReceiptProduct,
} from './mailroom-receipt.contract';

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
    @Optional() private readonly sourceModule?: ErpAfterSalesModuleService,
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
      item.recipientId === actor.id ||
      isIntakeReader(actor, item.repairWorkflow)
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
  /** Viewing an intake does not grant employee acceptance or Source case-write rights. */
  async intakeQueueReader(userId: string, entityId: string) {
    const actor = await this.actor(userId);
    requireEntity(actor, entityId);
    requirePermission(actor, 'mailroom:review');
    return {
      actor,
      scope:
        actor.entityIds === null ? ('company' as const) : ('mine' as const),
    };
  }
  /** The same Source module actor gate used by SSO, intersected with native CSR acceptance rights. */
  async intakeCustomerService(
    userId: string,
    entityId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const actor = await this.actor(userId, tx);
    requireEntity(actor, entityId);
    requirePermission(actor, 'mailroom:review');
    requirePermission(actor, 'after_sales_cases:read');
    requirePermission(actor, 'after_sales_cases:update');
    if (!tx) {
      if (!this.sourceModule)
        throw new ServiceUnavailableException('售後建案模組尚未開通');
      const sourceActor = await this.sourceModule.actor(userId, entityId);
      if (
        sourceActor.entityId !== entityId ||
        !sourceActor.modules.includes('dashboard') ||
        !sourceActor.modules.includes('cases') ||
        !sourceActor.writeModules.includes('cases')
      )
        throw new ForbiddenException('接手客服需要售後工作台與建案權限');
    }
    // Re-read transaction-local employee/scope after the external gate. A revoked role or
    // ENTITY→SELF downgrade cannot proceed using the earlier authorization snapshot.
    const scope = await (tx || this.prisma).user.findUnique({
      where: { id: userId },
      select: {
        salesDataScope: true,
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    if (
      !scope ||
      (scope.salesDataScope !== 'ENTITY' &&
        !scope.roles.some((entry) => entry.role.code === 'SUPER_ADMIN'))
    )
      throw new ForbiddenException('客服建案需要公司範圍權限');
    const employee = await (tx || this.prisma).employee.findFirst({
      where: { userId, entityId, isActive: true },
      select: { id: true },
    });
    if (!employee)
      throw new ForbiddenException('接手客服必須是此公司已綁定帳號的在職員工');
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
      customerService: boolean;
      intakeCustomerService: boolean;
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
        customerService: can(person, 'mailroom:review'),
        intakeCustomerService: can(person, 'mailroom:review')
          ? await this.intakeCustomerService(row.userId!, entityId)
              .then(() => true)
              .catch(() => false)
          : false,
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
    let intakeCsr = false;
    if (
      !can(actor, 'mailroom:read') &&
      can(actor, 'mailroom:review') &&
      can(actor, 'after_sales_cases:read') &&
      can(actor, 'after_sales_cases:update')
    ) {
      try {
        await this.intakeCustomerService(userId, entityId);
        intakeCsr = true;
      } catch (error) {
        if (
          !(error instanceof ForbiddenException) ||
          !can(actor, 'repair_workbench:read')
        )
          throw error;
        // CSR qualification cannot cancel an independent repair read. Recheck
        // current account, company and read grants after the asynchronous gate.
        const repairActor = await this.actor(userId);
        requireEntity(repairActor, entityId);
        requirePermission(repairActor, 'repair_workbench:read');
      }
    }
    if (
      !can(actor, 'mailroom:read') &&
      !can(actor, 'repair_workbench:read') &&
      !intakeCsr
    )
      throw new ForbiddenException('沒有此作業權限');
    const result = await this.sync.cases(entityId, search, undefined, options);
    return can(actor, 'mailroom:read') || intakeCsr
      ? result
      : {
          ...result,
          items: result.items.filter((source) => source.type === 'REPAIR'),
        };
  }
  async customerService(
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
    if (mode === 'repair')
      and.push(...repairConditions(query.repairScope || 'all', userId));
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
    const [total, rows, queueCounts] = await Promise.all([
      this.prisma.mailroomItem.count({ where }),
      this.prisma.mailroomItem.findMany({
        where,
        include: withReceipt,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 50,
        skip: ((query.page || 1) - 1) * 50,
      }),
      mode === 'repair'
        ? Promise.all(
            REPAIR_LIST_SCOPES.map(
              async (scope): Promise<[RepairListScope, number]> => [
                scope,
                await this.prisma.mailroomItem.count({
                  where: {
                    entityId: query.entityId,
                    AND: repairConditions(scope, userId),
                  },
                }),
              ],
            ),
          ).then((entries) => Object.fromEntries<number>(entries))
        : undefined,
    ]);
    return {
      total,
      items: await this.views(rows, userId, actor, {
        repairOverview: mode === 'repair',
      }),
      page: query.page || 1,
      ...(queueCounts ? { queueCounts } : {}),
    };
  }
  async views(
    items: Item[],
    userId: string,
    actor: Actor,
    options: { repairOverview?: boolean } = {},
  ) {
    const donors = items.filter(
      (item) => item.status === 'STOCKED' && item.receipt.category === 'RETURN',
    );
    for (const donor of donors) this.canRead(actor, donor);
    const consumedUnits = donors.length
      ? await this.prisma.afterSalesStockUnit.findMany({
          // Authorize through the already scoped source item. A malformed foreign
          // child is detected as UNKNOWN without exposing its linked case.
          where: {
            sourceItemId: { in: donors.map((item) => item.id) },
            status: 'CONSUMED',
          },
          select: {
            id: true,
            entityId: true,
            productId: true,
            warehouseId: true,
            sourceItemId: true,
            serialNumber: true,
            kind: true,
            status: true,
            qualification: true,
            reservations: {
              where: { status: 'POSTED' },
              take: 2,
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                entityId: true,
                unitId: true,
                itemId: true,
                status: true,
                outTransactionId: true,
                outTransaction: {
                  select: {
                    id: true,
                    entityId: true,
                    productId: true,
                    warehouseId: true,
                    direction: true,
                    quantity: true,
                    referenceType: true,
                    referenceId: true,
                  },
                },
                item: {
                  select: {
                    id: true,
                    entityId: true,
                    sku: true,
                    status: true,
                    version: true,
                    custodianId: true,
                    repairOwnerId: true,
                    repairWorkflow: true,
                    location: true,
                    receipt: {
                      select: {
                        entityId: true,
                        category: true,
                        sourceCaseId: true,
                        sourceNumber: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : [];
    const custody = new Map(
      donors.map((item) => [
        item.id,
        consumedReturnCustody(item, consumedUnits),
      ]),
    );
    const ids = [
      ...new Set(
        items
          .flatMap((x) => [
            x.custodianId,
            x.nextUserId,
            x.recipientId,
            x.repairOwnerId,
            repairWorkflow(x.repairWorkflow).csr?.ownerId,
            custody.get(x.id)?.linkedReplacementCustody?.custodianId,
          ])
          .filter(Boolean),
      ),
    ] as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((x) => [x.id, x.name]));
    for (const projection of custody.values()) {
      const linked = projection?.linkedReplacementCustody;
      if (linked) {
        linked.custodianName = names.get(linked.custodianId) || '未綁定';
        linked.statusLabel = STATUS_LABELS[linked.status] || linked.status;
      }
    }
    const intakeEligible = new Map<string, boolean>();
    for (const entityId of new Set(
      items
        .filter((item) => isIntakeReader(actor, item.repairWorkflow))
        .map((item) => item.entityId),
    ))
      intakeEligible.set(
        entityId,
        await this.intakeCustomerService(userId, entityId)
          .then(() => true)
          .catch(() => false),
      );
    return items.map(({ evidence, receipt, ...item }) => ({
      ...(canViewRepairDocuments(actor) ? item : withoutRepairDocuments(item)),
      ...(options.repairOverview &&
      can(actor, 'repair_workbench:read') &&
      isRepairWorkbenchItem({ ...item, receipt })
        ? { repairOverview: repairOverview({ ...item, evidence, receipt }) }
        : {}),
      location: dispatchedLocation(item),
      statusLabel:
        custody.get(item.id)?.statusLabel ||
        repairStatusLabel({ ...item, receipt }),
      ...(custody.get(item.id)?.linkedReplacementCustody
        ? {
            linkedReplacementCustody: custody.get(item.id)!
              .linkedReplacementCustody,
          }
        : {}),
      physicalCustody:
        custody.get(item.id)?.physicalCustody ||
        (isRepairWorkbenchItem({ ...item, receipt })
          ? physicalCustody({ ...item, receipt })
          : undefined),
      caseIntake: caseIntakeSummary(item.repairWorkflow),
      outboundShipment: outboundShipment(item.repairWorkflow),
      allowedIntakeActions: allowedIntakeActions(
        { ...item, receipt },
        actor,
        intakeEligible.get(item.entityId) || false,
      ),
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
        sourceSync: sourceSyncSummary(receipt.sourceSnapshot),
      },
    }));
  }
  async repairPhoto(userId: string, entityId: string, id: string) {
    this.enabled();
    const actor = await this.actor(userId);
    requireEntity(actor, entityId);
    requirePermission(actor, 'repair_workbench:read');
    const item = await this.prisma.mailroomItem.findUnique({
      where: { id },
      include: withReceipt,
    });
    if (
      !item ||
      item.entityId !== entityId ||
      item.receipt.entityId !== entityId ||
      !isRepairWorkbenchItem(item)
    )
      throw new NotFoundException('找不到案件照片');
    const photo = nativeRepairPhoto(item.evidence);
    if (!photo) throw new NotFoundException('找不到案件照片');
    return photo;
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
    if (
      !can(actor, 'mailroom:read') &&
      !isRepairWorkbenchItem(item) &&
      isIntakeReader(actor, item.repairWorkflow)
    )
      await this.intakeQueueReader(userId, entityId);
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
        if (task.kind.startsWith('INTAKE_') && !can(actor, 'mailroom:read'))
          await this.intakeQueueReader(userId, entityId);
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
      productId: item.productId,
      sku: item.sku,
      barcode: item.barcode,
      serialNumber: item.serialNumber,
      status: item.status,
      matchResult: item.matchResult,
      grade: item.grade,
      disposition: item.disposition,
      location: dispatchedLocation(item),
      storageLocationId: item.storageLocationId,
      custodianId: item.custodianId,
      nextUserId: item.nextUserId,
      quantity: 1,
      evidenceCount: Array.isArray(item.evidence) ? item.evidence.length : 0,
      returnInspection: item.returnInspection,
      outboundShipment: outboundShipment(item.repairWorkflow),
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
          caseIntake: caseIntakeSummary(item.repairWorkflow),
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
      const intake = caseIntake(item.repairWorkflow);
      if (intake && intake.status !== 'RESOLVED')
        recipients.set(
          intake.status === 'ACCEPTED' ? intake.ownerId! : intake.sentToUserId,
          intake.status === 'ACCEPTED' ? 'INTAKE_ACCEPTED' : 'INTAKE_SENT',
        );
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
            kind === 'CUSTOMER_ACCEPTED' ||
            kind.startsWith('INTAKE_')) &&
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
                kind === 'INTAKE_SENT'
                  ? '待補建售後案件，請本人接手'
                  : kind === 'INTAKE_ACCEPTED'
                    ? '客服已接手補建案件'
                    : kind === 'RETURN_REVIEW'
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
                targetPath: kind.startsWith('INTAKE_')
                  ? '/operations/after-sales/workbench?entityId=' +
                    encodeURIComponent(item.entityId) +
                    '&intakeItemId=' +
                    encodeURIComponent(item.id)
                  : '/my/inbox?itemId=' +
                    encodeURIComponent(item.id) +
                    '&entityId=' +
                    encodeURIComponent(item.entityId),
              },
            },
          }),
        );
      }
    }
    // Source/AI consumers do not yet accept DISPATCHED or the outbound schema.
    // The immutable native action and shipment retain the pending operation;
    // do not enqueue an unsupported event or claim a successful external sync.
    if (
      item.receipt.sourceCaseId &&
      action !== 'dispatch' &&
      item.status !== 'DISPATCHED'
    ) {
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
  /** One native row is one physical piece; the external line quantity is only its total capacity. */
  async reserveSourceCapacity(
    tx: Prisma.TransactionClient,
    entityId: string,
    baseline: SourceCase,
    incomingLineIds: (string | undefined)[],
    excludeNativeId?: string,
    fixedSnapshot?: SourceCase,
  ): Promise<SourceCase> {
    const incoming = new Map<string, number>();
    for (const id of incomingLineIds) {
      if (!id || !baseline.items.some((item) => item.id === id))
        throw new BadRequestException('請將每件物件關聯到來源申報品項');
      incoming.set(id, (incoming.get(id) || 0) + 1);
    }
    // Use the same sorted line keys for separate clerks and identification of unknown parcels.
    const lineIds = [...incoming.keys()].sort();
    for (const lineId of lineIds)
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${entityId + ':mailroom-source-line:' + baseline.id + ':' + lineId}))`,
      );
    // Do not rely on asynchronously projected remainingQuantity. Read the signed source
    // after the local capacity lock, then count every existing physical native row.
    // Intake binding has a separately validated signed snapshot read immediately before this
    // transaction; it preserves its Source version without HTTP under local row locks.
    const source =
      fixedSnapshot ||
      (await this.sync.cases(entityId, '', baseline.id)).items[0];
    if (
      !source ||
      source.id !== baseline.id ||
      (fixedSnapshot && source.version !== baseline.version) ||
      source.type !== baseline.type ||
      ['CANCELLED', 'CLOSED', 'COMPLETED'].includes(source.status)
    )
      throw new ConflictException('來源案件已變動，請重新核對');
    for (const lineId of lineIds) {
      const declared = source.items.find((item) => item.id === lineId);
      if (
        !declared ||
        !Number.isSafeInteger(declared.quantity) ||
        declared.quantity < 1
      )
        throw new ConflictException('來源申報數量須為正整數，請重新核對');
      const rows = await tx.$queryRaw<{ received: bigint }[]>(
        Prisma.sql`SELECT COUNT(*)::bigint AS received FROM mailroom_items mi JOIN mailroom_receipts mr ON mr.id=mi.receipt_id WHERE mi.entity_id=${entityId} AND mr.entity_id=${entityId} AND mr.source_case_id=${source.id} AND mi.declared->>'id'=${lineId}${excludeNativeId ? Prisma.sql` AND mi.id<>${excludeNativeId}` : Prisma.empty}`,
      );
      if (
        rows.length !== 1 ||
        BigInt(rows[0].received) + BigInt(incoming.get(lineId)!) >
          BigInt(declared.quantity)
      )
        throw new ConflictException(
          '本次實物數量超過來源申報數量，請核對已收件物件',
        );
    }
    return source;
  }
  async create(userId: string, input: CreateReceiptDto) {
    this.enabled();
    const actor = await this.actor(userId);
    requirePermission(actor, 'mailroom:create');
    requireEntity(actor, input.entityId);
    validateReceiptPayload(input);
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
        source.id !== input.sourceCaseId ||
        source.type !== input.category ||
        ['CANCELLED', 'CLOSED', 'COMPLETED'].includes(source.status)
      )
        throw new BadRequestException('售後案件類別不符');
      requireReceiptSourceVersion(source, input.sourceVersion);
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
      const freshActor = await this.actor(userId, tx);
      requirePermission(freshActor, 'mailroom:create');
      requireEntity(freshActor, input.entityId);
      if (source)
        source = await this.reserveSourceCapacity(
          tx,
          input.entityId,
          source,
          input.items.map((item) => item.sourceItemId),
        );
      if (source) requireReceiptSourceVersion(source, input.sourceVersion);
      const storage = await resolveReceiptLocation(tx, input);
      // Lock each selected product in a stable order across multi-item receipts.
      for (const row of [...input.items].sort((left, right) =>
        (left.productId || '').localeCompare(right.productId || ''),
      ))
        await validateReceiptProduct(tx, input.entityId, row);
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
            productId: row.productId || null,
            sku: row.sku?.trim() || null,
            barcode: row.barcode?.trim() || null,
            serialNumber: row.serialNumber?.trim() || null,
            evidence: row.evidence?.length ? json(row.evidence) : undefined,
            declared: declared ? json(declared) : undefined,
            status: input.recipientId ? 'WAITING_PICKUP' : 'RECEIVED',
            ...storage,
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
            freshActor,
            item,
            'receive',
            input.requestId + ':' + i,
            hash,
            null,
            undefined,
            true,
            Boolean(row.evidence?.length),
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
        identifiedSource = (
          await this.sync.cases(input.entityId, '', input.sourceCaseId)
        ).items[0];
        if (
          !identifiedSource ||
          identifiedSource.id !== input.sourceCaseId ||
          identifiedSource.type !== input.targetCategory ||
          ['CANCELLED', 'CLOSED', 'COMPLETED'].includes(
            identifiedSource.status,
          ) ||
          !identifiedSource.items.some((x) => x.id === input.sourceItemId)
        )
          throw new BadRequestException('來源案件或申報品項不符');
      }
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
      if (input.action === 'dispatch')
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':mailroom-dispatch-action:' + userId + ':' + input.requestId}))`,
        );
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
      let dispatchEmployeeId: string | undefined;
      if (input.action === 'dispatch') {
        // Replays still require current permissions and a current company employee.
        requirePermission(freshActor, 'mailroom:update');
        const employee = await tx.employee.findFirst({
          where: { userId, entityId: input.entityId, isActive: true },
          select: { id: true },
        });
        if (!employee)
          throw new ForbiddenException(
            '寄出人必須是此公司已綁定帳號的在職員工',
          );
        dispatchEmployeeId = employee.id;
      }
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
        input.action === 'identify' &&
        caseIntake(item.repairWorkflow)?.status !== undefined &&
        caseIntake(item.repairWorkflow)?.status !== 'RESOLVED'
      )
        throw new ConflictException('已交客服補建，須由受理客服綁回案件');
      if (identifiedSource)
        identifiedSource = await this.reserveSourceCapacity(
          tx,
          input.entityId,
          identifiedSource,
          [input.sourceItemId],
          item.id,
        );
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
      if (input.action === 'dispatch') {
        let reservation: unknown;
        let product: unknown;
        const release = workflow.release;
        const replacement =
          release?.purpose === 'REPLACED' ||
          (item.repairReport as { data?: { outcome?: string } } | null)?.data
            ?.outcome === 'REPLACED';
        if (replacement && release?.stock?.reservationId) {
          // Read the same formal OUT referenced by repair completion; no new stock posting.
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM after_sales_stock_reservations WHERE id=${release.stock.reservationId} AND entity_id=${item.entityId} FOR SHARE`,
          );
          const posted = await tx.afterSalesStockReservation.findFirst({
            where: {
              id: release.stock.reservationId,
              entityId: item.entityId,
              itemId: item.id,
              status: 'POSTED',
            },
            include: {
              unit: true,
              outTransaction: {
                select: {
                  id: true,
                  entityId: true,
                  productId: true,
                  warehouseId: true,
                  direction: true,
                  quantity: true,
                  referenceType: true,
                  referenceId: true,
                },
              },
            },
          });
          reservation = posted;
          if (posted)
            product = await tx.product.findFirst({
              where: { id: posted.unit.productId, entityId: item.entityId },
              select: { id: true, entityId: true, name: true, sku: true },
            });
        }
        const physicalItem = dispatchedPhysicalItem(item, reservation, product);
        const shipment: OutboundShipment = {
          schema: 1,
          status: 'HANDED_TO_CARRIER',
          entityId: item.entityId,
          itemId: item.id,
          sourceCaseId: item.receipt.sourceCaseId!,
          requestId: input.requestId,
          fromVersion: item.version,
          version: item.version + 1,
          carrier: dispatchText(input.carrier, '寄回物流公司'),
          trackingNumber: dispatchText(input.trackingNumber, '寄回物流單號'),
          dispatchedAt: new Date().toISOString(),
          dispatchedById: freshActor.id,
          dispatchedByName: freshActor.name,
          dispatchedByEmployeeId: dispatchEmployeeId!,
          note: input.note?.trim() || null,
          physicalItem,
          sourceSync: {
            status: 'PENDING_COMPATIBILITY',
            reason: 'DISPATCH_CONSUMER_NOT_CONFIGURED',
          },
        };
        changes.repairWorkflow = json({
          ...workflow,
          outboundShipment: shipment,
        });
      }
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
          ...receiptLinkChanges(item, changes, input.action),
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
    // Dispatch is persisted locally while external consumers remain unsupported.
    if (input.action !== 'dispatch') this.publish(result.notifications);
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
        outboundShipment: outboundShipment(item.repairWorkflow),
        physicalCustody: isRepairWorkbenchItem(item)
          ? physicalCustody(item)
          : undefined,
        declared: item.declared,
        productName: item.productName,
        sku: item.sku,
        serialNumber: item.serialNumber,
        location: dispatchedLocation(item),
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
