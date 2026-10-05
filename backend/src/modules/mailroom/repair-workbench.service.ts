import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import {
  can,
  fingerprint,
  isRepairWorkbenchItem,
  requireEntity,
  requirePermission,
  SourceCase,
} from './mailroom.contract';
import { SaveInspectionDto, SaveRepairDto } from './repair-document.dto';
import {
  RepairDocument,
  inspectionPlanHash,
  validateFactoryCompletion,
  validateInspectionData,
  validateInspectionSubmission,
  validateRepairData,
} from './repair-document.contract';
import {
  RepairCustomerQueueQuery,
  RepairWorkflowDto,
} from './repair-workflow.dto';
import {
  allowedWorkflowActions,
  currentCsrReview,
  physicalCustody,
  repairWorkflow,
  requireTechnicianCustody,
  requireSourceConsent,
  requireWorkflowText,
} from './repair-workflow.contract';

@Injectable()
export class RepairWorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
  ) {}
  async customerQueue(userId: string, q: RepairCustomerQueueQuery) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, q.entityId);
    requirePermission(actor, 'mailroom:review');
    const search = q.search?.trim();
    const rows = await this.prisma.mailroomItem.findMany({
      where: {
        entityId: q.entityId,
        status: 'WAITING_CUSTOMER',
        OR: [
          { receipt: { category: 'REPAIR' } },
          { receipt: { category: 'RETURN' }, repairOwnerId: { not: null } },
        ],
        ...(search
          ? {
              AND: [
                {
                  OR: [
                    {
                      label: { contains: search, mode: 'insensitive' as const },
                    },
                    {
                      productName: {
                        contains: search,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      serialNumber: {
                        contains: search,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      receipt: {
                        sourceNumber: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
      },
      include: { receipt: true },
      orderBy: { updatedAt: 'asc' },
    });
    const visible = rows.filter((row) => {
      const csr = repairWorkflow(row.repairWorkflow).csr;
      return (
        !!csr &&
        ((csr.status === 'SENT' &&
          (!csr.sentToUserId ||
            csr.sentToUserId === userId ||
            can(actor, '*'))) ||
          (csr.status === 'ACCEPTED' &&
            (csr.ownerId === userId || can(actor, '*'))))
      );
    });
    const page = q.page || 1;
    const pageSize = q.pageSize || 30;
    const pageRows = visible.slice((page - 1) * pageSize, page * pageSize);
    const items = (await this.mailroom.views(pageRows, userId, actor)).map(
      (row) => ({
        ...row,
        allowedWorkflowActions: allowedWorkflowActions(actor, row),
        physicalCustody: physicalCustody(row),
        editable: false,
      }),
    );
    return { items, total: visible.length, page, pageSize };
  }
  async workflow(userId: string, id: string, input: RepairWorkflowDto) {
    this.mailroom.enabled();
    const csrAction = ['claim_customer', 'resolve_customer'].includes(
      input.action,
    );
    const permission = csrAction
      ? 'mailroom:review'
      : 'repair_workbench:update';
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, input.entityId);
    requirePermission(actor, permission);
    const hash = fingerprint({ kind: 'workflow', ...input });
    const operationKey = {
      entityId: input.entityId,
      actorId: userId,
      requestId: input.requestId,
    };
    const committed = await this.prisma.mailroomAction.findUnique({
      where: { entityId_actorId_requestId: operationKey },
    });
    let source: SourceCase | undefined;
    if (
      !committed &&
      (['send_factory', 'complete_factory'].includes(input.action) ||
        (input.action === 'resolve_customer' && input.decision === 'APPROVE'))
    ) {
      const current = await this.prisma.mailroomItem.findUnique({
        where: { id },
        include: { receipt: true },
      });
      if (
        !current ||
        current.entityId !== input.entityId ||
        !isRepairWorkbenchItem(current)
      )
        throw new NotFoundException('找不到維修物件');
      if (!current.receipt.sourceCaseId)
        throw new ConflictException('沒有售後來源案件，不能放行');
      source = (
        await this.sync.cases(input.entityId, '', current.receipt.sourceCaseId)
      ).items[0];
      if (
        !source ||
        source.id !== current.receipt.sourceCaseId ||
        source.type !== current.receipt.category
      )
        throw new ConflictException('來源案件不存在或類別不符');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_items WHERE id=${id} FOR UPDATE`,
      );
      const fresh = await this.mailroom.actor(userId, tx);
      requireEntity(fresh, input.entityId);
      requirePermission(fresh, permission);
      if (
        csrAction &&
        !(await tx.employee.findFirst({
          where: { userId, entityId: input.entityId, isActive: true },
          select: { id: true },
        }))
      )
        throw new ForbiddenException('客服接手人必須是此公司的在職員工');
      const row = await tx.mailroomItem.findUnique({
        where: { id },
        include: { receipt: true },
      });
      if (
        !row ||
        row.entityId !== input.entityId ||
        !isRepairWorkbenchItem(row)
      )
        throw new NotFoundException('找不到維修物件');
      const previous = await tx.mailroomAction.findUnique({
        where: { entityId_actorId_requestId: operationKey },
      });
      if (previous) {
        if (previous.requestHash !== hash || previous.itemId !== id)
          throw new ConflictException('同一操作識別碼的內容不同');
        return { duplicate: true, notifications: [] };
      }
      if (row.version !== input.expectedVersion)
        throw new ConflictException('案件已更新，請重新載入');
      const workflow = repairWorkflow(row.repairWorkflow);
      if (!allowedWorkflowActions(fresh, row).includes(input.action))
        throw new ForbiddenException(
          '目前交辦階段、接手人或實物保管不允許此操作',
        );
      const now = new Date().toISOString();
      const note =
        input.action === 'claim_customer'
          ? input.note?.trim()
          : requireWorkflowText(input.note, '處理說明');
      const changes: Prisma.MailroomItemUpdateInput = {};
      if (input.action === 'claim_customer') {
        const doc = validateInspectionSubmission(row.repairInspection);
        if (
          workflow.csr!.inspectionRevision !== doc.revision ||
          workflow.csr!.planHash !== inspectionPlanHash(doc)
        )
          throw new ConflictException('檢修單已改版，請重新交辦客服');
        workflow.csr = {
          ...workflow.csr!,
          status: 'ACCEPTED',
          ownerId: userId,
          acceptedAt: now,
        };
        // An ACK changes the responsible CSR, never the physical holder.
        changes.nextUserId = userId;
      } else if (input.action === 'resolve_customer') {
        const doc = validateInspectionSubmission(row.repairInspection);
        if (
          !input.decision ||
          input.inspectionRevision !== doc.revision ||
          workflow.csr!.inspectionRevision !== doc.revision ||
          workflow.csr!.planHash !== inspectionPlanHash(doc)
        )
          throw new ConflictException('請確認目前檢修與報價版本及顧客決定');
        if (
          input.decision === 'APPROVE' &&
          (!source ||
            source.id !== row.receipt.sourceCaseId ||
            source.type !== row.receipt.category)
        )
          throw new ConflictException('來源案件不存在或類別不符');
        const quoteRevision =
          input.decision === 'APPROVE' && doc.data.plan !== 'RETURN'
            ? requireSourceConsent(source!, null, false)
            : workflow.csr!.quoteRevision;
        workflow.csr = {
          ...workflow.csr!,
          quoteRevision,
          status: 'RESOLVED',
          decision: input.decision,
          resolvedAt: now,
          note,
          ...(source ? { sourceVersion: source.version } : {}),
        };
        changes.repairInspection = JSON.parse(
          JSON.stringify({
            ...doc,
            review: {
              inspectionRevision: doc.revision,
              actorId: userId,
              name: fresh.name,
              confirmedAt: now,
              decision: input.decision,
              planHash: inspectionPlanHash(doc),
              quoteRevision,
            },
          }),
        ) as Prisma.InputJsonValue;
        changes.status = 'INSPECTING';
        changes.nextUserId = row.repairOwnerId;
      } else {
        if (row.repairOwnerId !== userId || row.custodianId !== userId)
          throw new ForbiddenException('僅本人的維修交辦可更新');
        if (
          ['return_original', 'send_factory', 'complete_factory'].includes(
            input.action,
          )
        )
          requireTechnicianCustody(fresh, row);
        if (input.action === 'return_original') {
          const doc = currentCsrReview(row);
          if (
            workflow.csr!.decision !== 'DECLINE' &&
            doc.data.plan !== 'RETURN'
          )
            throw new ConflictException('原件未修退回須先由客服確認顧客決定');
          this.confirmPhysical(input);
          workflow.release = {
            purpose: 'RETURN_UNREPAIRED',
            inspectionRevision: doc.revision,
            releasedAt: now,
            releasedBy: userId,
            note: note!,
          };
          changes.status = 'WAITING_RETURN_ACCEPTANCE';
          changes.nextUserId = row.receipt.receivedById;
          changes.location = input.location!.trim();
        } else if (input.action === 'send_factory') {
          const doc = currentCsrReview(row);
          if (
            !source ||
            source.id !== row.receipt.sourceCaseId ||
            source.type !== row.receipt.category ||
            !source.repairAllowed
          )
            throw new ConflictException(
              '售後同意或足額收款尚未放行，不能外送原廠',
            );
          requireSourceConsent(source, workflow.csr!.quoteRevision, true);
          this.confirmPhysical(input);
          workflow.factory = {
            stage: 'SENT',
            physicalCustody: 'FACTORY_CARRIER',
            inspectionRevision: doc.revision,
            planHash: inspectionPlanHash(doc),
            factoryName: requireWorkflowText(input.factoryName, '原廠名稱'),
            reference: requireWorkflowText(input.reference, '原廠交辦單號'),
            carrier: requireWorkflowText(input.carrier, '外送物流'),
            trackingNumber: requireWorkflowText(
              input.trackingNumber,
              '外送物流單號',
            ),
            sentAt: now,
            sentBy: userId,
            sourceVersion: source.version,
          };
          changes.status = 'FACTORY_OUTBOUND';
          changes.location = input.location!.trim();
          changes.nextUserId = null;
        } else if (input.action === 'accept_factory') {
          workflow.factory = {
            ...workflow.factory!,
            stage: 'ACCEPTED',
            physicalCustody: 'FACTORY',
            acceptedAt: now,
            acceptanceNote: note,
          };
          changes.status = 'FACTORY_RECEIVED';
        } else if (input.action === 'cancel_factory') {
          workflow.factory = {
            ...workflow.factory!,
            cancelled: true,
            cancelledAt: now,
            cancelledBy: userId,
            cancellationNote: note,
          };
        } else if (input.action === 'request_factory_return') {
          workflow.factory = {
            ...workflow.factory!,
            stage: 'RETURNING',
            physicalCustody: 'FACTORY_CARRIER',
            returnRequestedAt: now,
            returnNote: note,
            carrier: requireWorkflowText(input.carrier, '返還物流'),
            trackingNumber: requireWorkflowText(
              input.trackingNumber,
              '返還物流單號',
            ),
          };
          changes.status = 'FACTORY_RETURNING';
        } else if (input.action === 'receive_factory') {
          this.confirmPhysical(input);
          workflow.factory = {
            ...workflow.factory!,
            stage: 'RETURNED',
            physicalCustody: 'TECHNICIAN',
            returnedAt: now,
            returnedBy: userId,
            returnLocation: input.location!.trim(),
            receiptNote: note,
          };
          changes.status = 'INSPECTING';
          changes.location = input.location!.trim();
          changes.nextUserId = userId;
        } else if (input.action === 'complete_factory') {
          if (
            !source ||
            source.id !== row.receipt.sourceCaseId ||
            source.type !== row.receipt.category
          )
            throw new ConflictException('售後來源目前無法確認放行');
          requireSourceConsent(source, workflow.csr!.quoteRevision, true);
          const report = validateFactoryCompletion(
            row.repairInspection,
            row.repairReport,
            workflow.factory!.reference,
          );
          if (
            workflow.factory!.inspectionRevision !==
              report.inspectionRevision ||
            workflow.factory!.planHash !==
              inspectionPlanHash(
                validateInspectionSubmission(row.repairInspection),
              )
          )
            throw new ConflictException('原廠交辦版本已變更，請重新由客服確認');
          workflow.release = {
            purpose: 'FACTORY_REPAIRED',
            inspectionRevision: report.inspectionRevision,
            releasedAt: now,
            releasedBy: userId,
            note: note!,
          };
          changes.status = 'WAITING_RETURN_ACCEPTANCE';
          changes.nextUserId = row.receipt.receivedById;
        }
        changes.conditionNote = note;
      }
      changes.repairWorkflow = JSON.parse(
        JSON.stringify(workflow),
      ) as Prisma.InputJsonValue;
      changes.version = { increment: 1 };
      const updated = await tx.mailroomItem.update({
        where: { id },
        data: changes,
        include: { receipt: true },
      });
      const notifications = await this.mailroom.record(
        tx,
        fresh,
        updated,
        input.action,
        input.requestId,
        hash,
        row.status,
        note,
        true,
      );
      return { duplicate: false, notifications };
    });
    this.mailroom.publish(result.notifications);
    return { id, duplicate: result.duplicate };
  }
  private confirmPhysical(input: RepairWorkflowDto) {
    if (input.confirmedItems !== true)
      throw new BadRequestException('請本人核對實物並確認交接');
    requireWorkflowText(input.location, '實物交接位置');
  }
  async documents(userId: string, entityId: string, id: string) {
    const detail = await this.mailroom.detail(userId, entityId, id);
    const actor = await this.mailroom.actor(userId);
    if (
      !actor.permissions.has('*') &&
      !actor.permissions.has('repair_workbench:read') &&
      !actor.permissions.has('mailroom:review')
    )
      throw new ForbiddenException('無檢修文件存取權限');
    requireEntity(actor, entityId);
    const sourceId = detail.receipt.sourceCaseId;
    let release: {
      available: boolean;
      repairAllowed?: boolean;
      sourceStatus?: string;
      sourceStatusLabel?: string;
      releaseInfo?: SourceCase['releaseInfo'];
      message?: string;
    } = { available: false, message: '沒有售後來源案件' };
    if (sourceId) {
      try {
        const source = (await this.sync.cases(entityId, '', sourceId)).items[0];
        release =
          source &&
          source.id === sourceId &&
          source.type === detail.receipt.category
            ? {
                available: true,
                repairAllowed: source.repairAllowed,
                sourceStatus: source.status,
                releaseInfo: source.releaseInfo || null,
                ...(typeof source.statusLabel === 'string'
                  ? { sourceStatusLabel: source.statusLabel }
                  : {}),
              }
            : { available: false, message: '來源案件不存在或不在授權範圍' };
      } catch {
        release = {
          available: false,
          message: '目前無法取得售後同意與收款狀態',
        };
      }
    }
    return {
      ...detail,
      release,
      allowedWorkflowActions: allowedWorkflowActions(actor, detail),
      physicalCustody: physicalCustody(detail),
      editable:
        (actor.permissions.has('*') ||
          actor.permissions.has('repair_workbench:update')) &&
        detail.repairOwnerId === userId &&
        detail.custodianId === userId &&
        physicalCustody(detail) === 'TECHNICIAN',
    };
  }
  async save(
    userId: string,
    id: string,
    kind: 'inspection' | 'repair',
    input: SaveInspectionDto | SaveRepairDto,
  ) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, input.entityId);
    requirePermission(actor, 'repair_workbench:update');
    if (input.status === 'SUBMITTED') {
      if (kind === 'inspection')
        validateInspectionData((input as SaveInspectionDto).data, true);
      else validateRepairData((input as SaveRepairDto).data);
    }
    const hash = fingerprint({ kind, ...input });
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_items WHERE id=${id} FOR UPDATE`,
      );
      const fresh = await this.mailroom.actor(userId, tx);
      requireEntity(fresh, input.entityId);
      requirePermission(fresh, 'repair_workbench:update');
      const row = await tx.mailroomItem.findUnique({
        where: { id },
        include: { receipt: true },
      });
      if (!row || row.entityId !== input.entityId)
        throw new NotFoundException('找不到維修物件');
      if (
        row.repairOwnerId !== userId ||
        row.custodianId !== userId ||
        !['REPAIR', 'RETURN'].includes(row.receipt.category)
      )
        throw new ForbiddenException('只有實物已簽收的維修師能填寫工作單');
      const previous = await tx.mailroomAction.findUnique({
        where: {
          entityId_actorId_requestId: {
            entityId: input.entityId,
            actorId: userId,
            requestId: input.requestId,
          },
        },
      });
      if (previous) {
        if (previous.requestHash !== hash || previous.itemId !== id)
          throw new ConflictException('同一操作識別碼的內容不同');
        return { duplicate: true, notifications: [] };
      }
      if (row.version !== input.expectedVersion)
        throw new ConflictException('案件已更新，請重新載入後再儲存');
      requireTechnicianCustody(fresh, row);
      const stages =
        kind === 'inspection'
          ? ['REPAIR_RECEIVED', 'INSPECTING', 'REPAIRING', 'REFURBISHING']
          : ['INSPECTING', 'REPAIRING', 'REFURBISHING'];
      if (!stages.includes(row.status))
        throw new ConflictException(
          '此階段不能修改工作單，請先確認目前交辦進度',
        );
      if (kind === 'repair' && input.status === 'SUBMITTED') {
        const report = (input as SaveRepairDto).data;
        if (
          report.outcome === 'REPLACED' &&
          row.serialNumber &&
          report.replacementSerial?.trim() === row.serialNumber.trim()
        )
          throw new ConflictException(
            '替換件序號與原件相同，請核對實物；原機維修應記為維修',
          );
        if (
          report.outcome === 'REPLACED' &&
          !report.replacementSerial?.trim()
        ) {
          const product = await tx.product.findFirst({
            where: { entityId: row.entityId, sku: report.replacementSku },
            select: { hasSerialNumbers: true },
          });
          if (!product || product.hasSerialNumbers || row.serialNumber)
            throw new ConflictException(
              '有序號或尚未確認商品品項的換機，請填寫替換 SN',
            );
        }
      }
      const inspection =
        kind === 'repair' && input.status === 'SUBMITTED'
          ? validateInspectionSubmission(row.repairInspection)
          : null;
      if (
        kind === 'repair' &&
        input.status === 'SUBMITTED' &&
        (input as SaveRepairDto).data.outcome === 'REPLACED' &&
        inspection &&
        ((inspection.data.replacementSku &&
          inspection.data.replacementSku !==
            (input as SaveRepairDto).data.replacementSku) ||
          (inspection.data.replacementCondition &&
            inspection.data.replacementCondition !==
              (input as SaveRepairDto).data.replacementCondition))
      )
        throw new ConflictException(
          '替換 SKU／品況與檢修方案不同，請先交客服確認改版',
        );
      if (
        kind === 'repair' &&
        input.status === 'SUBMITTED' &&
        (input as SaveRepairDto).data.outcome === 'FACTORY_REPAIRED'
      ) {
        const factory = repairWorkflow(row.repairWorkflow).factory;
        if (
          !factory ||
          factory.stage !== 'RETURNED' ||
          factory.cancelled ||
          (input as SaveRepairDto).data.factoryReference?.trim() !==
            factory.reference ||
          inspection?.data.plan !== 'FACTORY' ||
          factory.inspectionRevision !== inspection.revision ||
          factory.planHash !== inspectionPlanHash(inspection)
        )
          throw new ConflictException(
            '原廠件須由本人簽收返還，且對應本次交辦版本與單號',
          );
      }
      const key = kind === 'inspection' ? 'repairInspection' : 'repairReport';
      const old = row[key] as RepairDocument | null;
      const now = new Date().toISOString();
      const doc = {
        number: (kind === 'inspection' ? 'INS-' : 'REP-') + row.label,
        revision: (old?.revision || 0) + 1,
        status: input.status,
        authorId: userId,
        authorName: fresh.name,
        updatedAt: now,
        ...(input.status === 'SUBMITTED' ? { submittedAt: now } : {}),
        ...(kind === 'repair'
          ? {
              inspectionRevision:
                inspection?.revision ||
                (row.repairInspection as RepairDocument | null)?.revision,
            }
          : {}),
        data: input.data,
      };
      const updated = await tx.mailroomItem.update({
        where: { id },
        data: {
          [key]: JSON.parse(JSON.stringify(doc)) as Prisma.InputJsonValue,
          ...(kind === 'inspection'
            ? {
                repairWorkflow: JSON.parse(
                  JSON.stringify({
                    ...repairWorkflow(row.repairWorkflow),
                    csr: undefined,
                    release: undefined,
                  }),
                ) as Prisma.InputJsonValue,
                ...(row.status === 'REPAIRING'
                  ? { status: 'INSPECTING', nextUserId: userId }
                  : {}),
              }
            : {}),
          version: { increment: 1 },
        },
        include: { receipt: true },
      });
      const notifications = await this.mailroom.record(
        tx,
        fresh,
        updated,
        (input.status === 'SUBMITTED' ? 'submit_' : 'save_') + 'repair_' + kind,
        input.requestId,
        hash,
        row.status,
        JSON.stringify({
          documentNumber: doc.number,
          revision: doc.revision,
          status: doc.status,
        }),
        kind === 'inspection' && row.status === 'REPAIRING',
      );
      // record() retains complete documents in immutable history and queues the existing compatible event.
      return { duplicate: false, notifications };
    });
    this.mailroom.publish(result.notifications);
    return { id, duplicate: result.duplicate };
  }
}
