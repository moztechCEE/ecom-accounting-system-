import {
  assessmentReleaseForItem,
  requireAssessmentRelease,
} from './repair-assessment-release';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { evidenceDatabase } from './repair-evidence.persistence';
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
  type InspectionData,
  type InspectionDocument,
  inspectionPlanHash,
  validateFactoryCompletion,
  validateInspectionData,
  validateInspectionSubmission,
  validateRepairData,
  validateDocumentV2,
  validateDocumentMediaReferences,
  verifiedDocumentTemplateBinding,
} from './repair-document.contract';
import { materialReadiness } from './repair-material.contract';
import { repairSourceCaseBrand } from './repair-source-brand.contract';
import { RepairPrerequisitesService } from './repair-prerequisites.service';
import { RepairMediaService } from './repair-media.service';
import {
  accidentalDamageFromAssessment,
  validateAssessmentReview,
  validateInspectionAssessmentShape,
  validateSubmittedInspectionAssessment,
} from './repair-assessment.contract';
import { requireRefurbishmentWorkStart } from './repair-work-start.contract';
import { RepairLookupQuery } from './repair-lookup.dto';
import { repairConditions } from './repair-list.contract';
import {
  REPAIR_LOOKUP_LIMIT,
  repairCustomerContext,
  repairLookupCode,
  repairLookupResult,
} from './repair-lookup.contract';
import {
  RepairCustomerQueueQuery,
  RepairWorkflowDto,
} from './repair-workflow.dto';
import { repairSourceBindingForItem } from './repair-proposal.contract';
import { requireSourceDisposition } from './repair-disposition-source.contract';
import type { RepairDispositionDecision } from './repair-disposition.contract';
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
    @Optional() private readonly prerequisites?: RepairPrerequisitesService,
    @Optional() private readonly media?: RepairMediaService,
  ) {}
  async lookup(userId: string, query: RepairLookupQuery) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, query.entityId);
    requirePermission(actor, 'repair_workbench:read');
    const code = repairLookupCode(query.code);
    const rows = await this.prisma.mailroomItem.findMany({
      where: {
        entityId: query.entityId,
        receipt: { entityId: query.entityId, sourceNumber: code },
        AND: repairConditions('all', userId),
      },
      select: {
        id: true,
        entityId: true,
        receiptId: true,
        productName: true,
        label: true,
        status: true,
        repairOwnerId: true,
        receipt: {
          select: {
            id: true,
            entityId: true,
            number: true,
            category: true,
            sourceCaseId: true,
            sourceNumber: true,
            sourceSnapshot: true,
          },
        },
      },
      orderBy: [{ receiptId: 'asc' }, { id: 'asc' }],
      take: REPAIR_LOOKUP_LIMIT + 1,
    });
    return repairLookupResult(query.entityId, code, rows);
  }
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
    const csrAction = [
      'claim_customer',
      'review_assessment',
      'resolve_customer',
    ].includes(input.action);
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
      // Read signed Source authority after the row lock and replay check.
      let source: SourceCase | undefined;
      const needsSource =
        ['send_factory', 'complete_factory'].includes(input.action) ||
        (input.action === 'resolve_customer' && input.decision === 'APPROVE') ||
        (row.receipt.category === 'REPAIR' &&
          [
            'resolve_customer',
            'return_original',
            'record_scrap_authorization',
          ].includes(input.action));
      if (needsSource) {
        if (!row.receipt.sourceCaseId)
          throw new ConflictException('沒有售後來源案件，不能放行');
        const sources = (
          await this.sync.cases(input.entityId, '', row.receipt.sourceCaseId)
        ).items;
        source = sources.length === 1 ? sources[0] : undefined;
        if (
          !source ||
          source.id !== row.receipt.sourceCaseId ||
          source.type !== row.receipt.category
        )
          throw new ConflictException('來源案件不存在或類別不符');
        const finalActor = await this.mailroom.actor(userId, tx);
        requireEntity(finalActor, input.entityId);
        requirePermission(finalActor, permission);
      }
      if (
        ['start_refurbishment', 'send_factory', 'complete_factory'].includes(
          input.action,
        ) ||
        (input.action === 'resolve_customer' && input.decision === 'APPROVE')
      )
        await requireAssessmentRelease(row, tx, { source });
      const now = new Date().toISOString();
      const note = ['claim_customer', 'start_refurbishment'].includes(
        input.action,
      )
        ? input.note?.trim()
        : requireWorkflowText(input.note, '處理說明');
      const changes: Prisma.MailroomItemUpdateInput = {};
      let recordActor = fresh;
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
      } else if (input.action === 'review_assessment') {
        const doc = validateInspectionSubmission(row.repairInspection);
        const planHash = inspectionPlanHash(doc);
        const policy = workflow.assessmentPolicy;
        if (
          row.status !== 'WAITING_CUSTOMER' ||
          workflow.csr?.status !== 'ACCEPTED' ||
          workflow.csr.ownerId !== userId ||
          (input.decision !== 'APPROVE' && input.decision !== 'DECLINE') ||
          input.inspectionRevision !== doc.revision ||
          workflow.csr.inspectionRevision !== doc.revision ||
          workflow.csr.estimateRevision !== doc.revision ||
          workflow.csr.planHash !== planHash ||
          policy?.schema !== 1 ||
          policy.inspectionRevision !== doc.revision ||
          policy.planHash !== planHash
        )
          throw new ConflictException('請先接手並確認目前檢修原因版本');
        if (
          !row.repairOwnerId ||
          doc.authorId === userId ||
          row.repairOwnerId === userId
        )
          throw new ForbiddenException('原因判定須由另一位客服覆核');
        const repairOwnerId = row.repairOwnerId;
        const shape = validateInspectionAssessmentShape(doc.data.assessment);
        if (shape.conclusion !== 'USER_CAUSED')
          throw new ConflictException('此件沒有待覆核的使用或外力原因判定');
        if (shape.causalExplanation !== doc.data.diagnosis)
          throw new BadRequestException('因果說明與檢修診斷不一致');
        if (!this.prerequisites)
          throw new ConflictException('檢修證據服務尚未就緒');
        const resolution = await this.prerequisites.recordValidation(
          row,
          'inspection',
          doc.data,
          tx,
        );
        const finalized = doc.data.mediaRefs?.length
          ? await this.media?.attach(
              tx,
              row,
              'inspection',
              doc.revision,
              doc.data.mediaRefs,
            )
          : [];
        validateDocumentMediaReferences(
          doc.data.mediaRefs,
          {
            entityId: row.entityId,
            itemId: row.id,
            kind: 'inspection',
            documentRevision: doc.revision,
          },
          finalized || [],
        );
        validateSubmittedInspectionAssessment(shape, {
          causeStatus: doc.data.causeStatus,
          checks: doc.data.checks,
          mediaRefs: doc.data.mediaRefs,
          isAccidentalDamage: doc.data.isAccidentalDamage,
          template: resolution.template,
          templateContext: resolution.context,
          calibrations: resolution.calibrations,
          now: new Date(now),
        });
        const employeeSelect = {
          id: true,
          userId: true,
          entityId: true,
          isActive: true,
        } as const;
        const [authorEmployee, ownerEmployee] = await Promise.all([
          tx.employee.findFirst({
            where: { userId: doc.authorId, entityId: row.entityId },
            select: employeeSelect,
          }),
          tx.employee.findFirst({
            where: { userId: repairOwnerId, entityId: row.entityId },
            select: employeeSelect,
          }),
        ]);
        const finalActor = await this.mailroom.actor(userId, tx);
        requireEntity(finalActor, row.entityId);
        requirePermission(finalActor, 'mailroom:review');
        const reviewerEmployee = await tx.employee.findFirst({
          where: { userId, entityId: row.entityId, isActive: true },
          select: employeeSelect,
        });
        if (
          !authorEmployee ||
          authorEmployee.userId !== doc.authorId ||
          authorEmployee.entityId !== row.entityId ||
          !ownerEmployee ||
          ownerEmployee.userId !== repairOwnerId ||
          ownerEmployee.entityId !== row.entityId ||
          !reviewerEmployee ||
          reviewerEmployee.userId !== userId ||
          reviewerEmployee.entityId !== row.entityId ||
          reviewerEmployee.isActive !== true
        )
          throw new ForbiddenException('原因覆核人員身份尚未確認');
        recordActor = finalActor;
        const reviewedAt = new Date().toISOString();
        workflow.assessmentReview = validateAssessmentReview(
          {
            schema: 1,
            inspectionRevision: doc.revision,
            planHash,
            reviewerId: userId,
            reviewerName: finalActor.name,
            reviewedAt,
            decision: input.decision === 'APPROVE' ? 'APPROVE' : 'REVISE',
            note,
          },
          {
            entityId: row.entityId,
            inspectionRevision: doc.revision,
            planHash,
            authorId: doc.authorId,
            repairOwnerId,
            reviewer: {
              id: finalActor.id,
              entityId: reviewerEmployee.entityId,
              isActiveEmployee: reviewerEmployee.isActive,
              canReview: can(finalActor, 'mailroom:review'),
            },
            reviewerEmployeeId: reviewerEmployee.id,
            authorEmployeeId: authorEmployee.id,
            repairOwnerEmployeeId: ownerEmployee.id,
            now: new Date(reviewedAt),
          },
        );
        if (input.decision === 'DECLINE') {
          await evidenceDatabase(tx).repairCustomerReport.updateMany({
            where: {
              entityId: row.entityId,
              itemId: row.id,
              inspectionRevision: doc.revision,
              status: 'PUBLISHED',
            },
            data: {
              status: 'REVOKED',
              revokedAt: new Date(reviewedAt),
              revokedById: userId,
            },
          });
          changes.status = 'INSPECTING';
          changes.nextUserId = repairOwnerId;
        }
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
        let quoteRevision = workflow.csr!.quoteRevision;
        if (
          source?.type === 'REPAIR' &&
          (input.decision === 'DECLINE' ||
            ['RETURN', 'SCRAP'].includes(doc.data.plan))
        ) {
          const decision =
            doc.data.plan === 'SCRAP'
              ? 'SCRAP'
              : doc.data.plan === 'RETURN'
                ? 'RETURN_ORIGINAL'
                : undefined;
          quoteRevision = this.disposition(source, row, decision).quoteRevision;
        } else if (input.decision === 'APPROVE' && doc.data.plan !== 'RETURN') {
          quoteRevision = requireSourceConsent(
            source!,
            null,
            false,
            source!.type === 'REPAIR'
              ? repairSourceBindingForItem(row, source!)
              : undefined,
          );
        }
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
          [
            'return_original',
            'record_scrap_authorization',
            'send_factory',
            'complete_factory',
          ].includes(input.action)
        )
          requireTechnicianCustody(fresh, row);
        if (input.action === 'start_refurbishment') {
          requireTechnicianCustody(fresh, row);
          const doc = currentCsrReview(row);
          if (
            row.receipt.category !== 'RETURN' ||
            doc.data.plan !== 'REPAIR' ||
            workflow.csr?.decision !== 'APPROVE' ||
            workflow.csr.quoteRevision !== null ||
            doc.review?.quoteRevision !== null
          )
            throw new ConflictException('此件尚未核准本版整新方案');
          if (
            !(await tx.employee.findFirst({
              where: { userId, entityId: input.entityId, isActive: true },
              select: { id: true },
            }))
          )
            throw new ForbiddenException('請由此公司在職維修師本人確認');
          if (!this.prerequisites)
            throw new ConflictException('檢修證據服務尚未就緒');
          await this.prerequisites.require(row, 'START', tx);
          workflow.workStart = {
            schema: 'corely.repair.work-start.v1',
            kind: 'REFURBISHMENT',
            entityId: row.entityId,
            itemId: row.id,
            inspectionRevision: doc.revision,
            planHash: inspectionPlanHash(doc),
            ownerId: userId,
            custodianId: userId,
            startedById: userId,
            startedAt: now,
          };
          changes.status = 'REFURBISHING';
          changes.nextUserId = userId;
        } else if (input.action === 'return_original') {
          const doc = currentCsrReview(row);
          if (
            workflow.csr!.decision !== 'DECLINE' &&
            doc.data.plan !== 'RETURN'
          )
            throw new ConflictException('原件未修退回須先由客服確認顧客決定');
          if (row.receipt.category === 'REPAIR') {
            const proof = this.disposition(source!, row, 'RETURN_ORIGINAL');
            if (proof.quoteRevision !== workflow.csr!.quoteRevision)
              throw new ConflictException('顧客原件處置與客服確認版本不符');
            workflow.dispositionAuthorization = proof;
          }
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
        } else if (input.action === 'record_scrap_authorization') {
          const doc = currentCsrReview(row);
          if (
            row.receipt.category !== 'REPAIR' ||
            (doc.data.plan !== 'SCRAP' && workflow.csr?.decision !== 'DECLINE')
          )
            throw new ConflictException('此案件尚未確認報廢處置');
          const proof = this.disposition(source!, row, 'SCRAP');
          if (proof.quoteRevision !== workflow.csr!.quoteRevision)
            throw new ConflictException('顧客原件處置與客服確認版本不符');
          if (
            workflow.dispositionAuthorization &&
            fingerprint(workflow.dispositionAuthorization) ===
              fingerprint(proof)
          )
            throw new ConflictException('本版報廢授權已記錄');
          workflow.dispositionAuthorization = proof;
          // No physical disposal, stock OUT or terminal state is implied.
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
          requireSourceConsent(
            source,
            workflow.csr!.quoteRevision,
            true,
            source.type === 'REPAIR'
              ? repairSourceBindingForItem(row, source)
              : undefined,
          );
          if (!this.prerequisites)
            throw new ConflictException('檢修證據服務尚未就緒');
          await this.prerequisites.require(row, 'START', tx);
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
          const inspection = currentCsrReview(row);
          if (
            inspection.data.plan !== 'FACTORY' ||
            workflow.csr?.decision !== 'APPROVE'
          )
            throw new ConflictException('客服尚未同意目前原廠處理方案');
          if (
            !source ||
            source.id !== row.receipt.sourceCaseId ||
            source.type !== row.receipt.category
          )
            throw new ConflictException('售後來源目前無法確認放行');
          requireSourceConsent(
            source,
            workflow.csr.quoteRevision,
            true,
            source.type === 'REPAIR'
              ? repairSourceBindingForItem(row, source)
              : undefined,
          );
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
          if (!this.prerequisites)
            throw new ConflictException('檢修證據服務尚未就緒');
          await this.prerequisites.require(row, 'COMPLETION', tx);
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
        recordActor,
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
  private disposition(
    source: SourceCase,
    item: Parameters<typeof requireSourceDisposition>[1],
    decision?: RepairDispositionDecision,
  ) {
    const policy = {
      entityId: item.entityId,
      allowDevStub: process.env.REPAIR_DISPOSITION_DEV_STUB_ENABLED === 'true',
    };
    if (decision)
      return requireSourceDisposition(source, item, decision, policy);
    const proofs = (['RETURN_ORIGINAL', 'SCRAP'] as const).flatMap((kind) => {
      try {
        return [requireSourceDisposition(source, item, kind, policy)];
      } catch {
        return [];
      }
    });
    if (proofs.length !== 1)
      throw new ConflictException('當版顧客原件處置尚未確認');
    return proofs[0];
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
    const evidenceRow = await this.prisma.mailroomItem.findUnique({
      where: { id },
      include: { receipt: true },
    });
    if (
      !evidenceRow ||
      evidenceRow.entityId !== entityId ||
      !isRepairWorkbenchItem(evidenceRow)
    )
      throw new NotFoundException('找不到維修物件');
    if (evidenceRow.version !== detail.version)
      throw new ConflictException('案件已更新，請重新載入');
    const catalog = await Promise.all([
      this.prisma.product.findMany({
        where: { entityId, isActive: true, hasSerialNumbers: false },
        select: { id: true, sku: true, name: true },
        orderBy: { sku: 'asc' },
        take: 1000,
      }),
      this.prisma.warehouse.findMany({
        where: { entityId, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
    ]);
    const sourceId = detail.receipt.sourceCaseId;
    let repairProposalBinding: ReturnType<
      typeof repairSourceBindingForItem
    > | null = null;
    let disposition = {
      returnOriginal: { state: 'UNKNOWN', reason: 'SOURCE_UNAVAILABLE' },
      scrapAuthorization: { state: 'UNKNOWN', reason: 'SOURCE_UNAVAILABLE' },
      authorization:
        repairWorkflow(detail.repairWorkflow).dispositionAuthorization || null,
    };
    let release: {
      available: boolean;
      repairAllowed?: boolean;
      sourceCaseId?: string;
      caseBrand?: string | null;
      sourceStatus?: string;
      sourceStatusLabel?: string;
      releaseInfo?: SourceCase['releaseInfo'];
      message?: string;
    } = { available: false, message: '沒有售後來源案件' };
    let assessmentSource: SourceCase | undefined;
    if (sourceId) {
      try {
        const sources = (await this.sync.cases(entityId, '', sourceId)).items;
        const source = sources.length === 1 ? sources[0] : undefined;
        release =
          source &&
          source.id === sourceId &&
          source.type === detail.receipt.category
            ? {
                available: true,
                sourceCaseId: source.id,
                caseBrand: (() => {
                  try {
                    return repairSourceCaseBrand(source);
                  } catch {
                    return null;
                  }
                })(),
                repairAllowed: source.repairAllowed,
                sourceStatus: source.status,
                releaseInfo: source.releaseInfo || null,
                ...(typeof source.statusLabel === 'string'
                  ? { sourceStatusLabel: source.statusLabel }
                  : {}),
              }
            : { available: false, message: '來源案件不存在或不在授權範圍' };
        if (release.available) assessmentSource = source;
        if (release.available && source?.type === 'REPAIR') {
          try {
            repairProposalBinding = repairSourceBindingForItem(detail, source);
          } catch {
            repairProposalBinding = null;
          }
          const readiness = (decision: RepairDispositionDecision) => {
            try {
              const doc = currentCsrReview(detail);
              const workflow = repairWorkflow(detail.repairWorkflow);
              if (
                decision === 'SCRAP'
                  ? doc.data.plan !== 'SCRAP' &&
                    workflow.csr?.decision !== 'DECLINE'
                  : doc.data.plan !== 'RETURN' &&
                    workflow.csr?.decision !== 'DECLINE'
              )
                return { state: 'BLOCKED', reason: 'DECISION_MISMATCH' };
              const proof = this.disposition(source, detail, decision);
              if (proof.quoteRevision !== workflow.csr?.quoteRevision)
                return { state: 'BLOCKED', reason: 'QUOTE_MISMATCH' };
              if (
                decision === 'SCRAP' &&
                workflow.dispositionAuthorization &&
                fingerprint(workflow.dispositionAuthorization) ===
                  fingerprint(proof)
              )
                return { state: 'BLOCKED', reason: 'ALREADY_RECORDED' };
              return { state: 'READY', reason: 'CURRENT_APPROVED_PROOF' };
            } catch {
              return { state: 'BLOCKED', reason: 'PROOF_UNAVAILABLE' };
            }
          };
          disposition = {
            ...disposition,
            returnOriginal: readiness('RETURN_ORIGINAL'),
            scrapAuthorization: readiness('SCRAP'),
          };
        }
      } catch {
        release = {
          available: false,
          message: '目前無法取得售後同意與收款狀態',
        };
      }
    }
    const inspection =
      detail.repairInspection as RepairDocument<InspectionData> | null;
    const context = {
      entityId,
      itemId: id,
      inspectionRevision: inspection?.revision || 0,
      planHash: inspection ? inspectionPlanHash(inspection) : '',
      requiredReceiverId: detail.custodianId,
    };
    const receipt = repairWorkflow(detail.repairWorkflow).materialsReceipt;
    let evidence = {
      materials: {
        start: materialReadiness(
          context,
          inspection?.data.materialPlan,
          receipt,
          'START',
        ),
        completion: materialReadiness(
          context,
          inspection?.data.materialPlan,
          receipt,
          'COMPLETION',
        ),
      },
      template: null as Awaited<
        ReturnType<RepairPrerequisitesService['forItem']>
      >['template'],
      completionTemplate: null as Awaited<
        ReturnType<RepairPrerequisitesService['forItem']>
      >['completionTemplate'],
      repairTemplate: null as Awaited<
        ReturnType<RepairPrerequisitesService['forItem']>
      >['repairTemplate'],
      templateChecks: { inspection: 'UNKNOWN', completion: 'UNKNOWN' },
      calibrationRecords: [] as Awaited<
        ReturnType<RepairPrerequisitesService['forItem']>
      >['calibrationRecords'],
      completionCalibrationRecords: [] as Awaited<
        ReturnType<RepairPrerequisitesService['forItem']>
      >['completionCalibrationRecords'],
    };
    if (this.prerequisites) {
      try {
        evidence = await this.prerequisites.forItem(evidenceRow);
      } catch {
        evidence = {
          ...evidence,
          materials: {
            start: {
              state: 'UNKNOWN',
              reason: 'RECEIPT_UNKNOWN',
              requiredCount: 0,
            },
            completion: {
              state: 'UNKNOWN',
              reason: 'RECEIPT_UNKNOWN',
              requiredCount: 0,
            },
          },
        };
      }
    }
    let mediaAssets: Awaited<ReturnType<RepairMediaService['list']>>['items'] =
      [];
    if (this.media) {
      try {
        mediaAssets = (await this.media.list(userId, entityId, id)).items;
      } catch {
        mediaAssets = [];
      }
    }
    const assessmentRelease = await assessmentReleaseForItem(
      evidenceRow,
      this.prisma,
      { source: assessmentSource },
    );
    return {
      ...detail,
      customerContext: repairCustomerContext(
        sourceId,
        detail.receipt.category,
        assessmentSource,
      ),
      release,
      repairProposalBinding,
      repairPrerequisites: {
        assessmentRelease,
        workStart: (() => {
          if (evidenceRow.receipt.category !== 'RETURN')
            return { state: 'UNKNOWN', reason: 'NOT_APPLICABLE' };
          try {
            requireRefurbishmentWorkStart(evidenceRow);
            return { state: 'READY', reason: 'CURRENT_STARTED_PROOF' };
          } catch {
            return { state: 'BLOCKED', reason: 'NOT_STARTED' };
          }
        })(),
        materialCatalog: { products: catalog[0], warehouses: catalog[1] },
        ...evidence,
        mediaAssets,
        disposition,
      },
      allowedWorkflowActions: allowedWorkflowActions(actor, detail).filter(
        (action) =>
          !['start_refurbishment', 'send_factory', 'complete_factory'].includes(
            action,
          ) || assessmentRelease.state === 'READY',
      ),
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
      validateDocumentV2(input.data, kind);
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
      const newAssessment =
        kind === 'inspection'
          ? validateInspectionAssessmentShape(
              (input.data as InspectionData).assessment,
            )
          : undefined;
      let resolution:
        | Awaited<ReturnType<RepairPrerequisitesService['recordValidation']>>
        | undefined;
      if (input.status === 'SUBMITTED') {
        if (!this.prerequisites)
          throw new ConflictException('檢修證據服務尚未就緒');
        resolution = await this.prerequisites.recordValidation(
          row,
          kind,
          input.data,
          tx,
        );
      } else if (
        input.data.templateBinding ||
        verifiedDocumentTemplateBinding(
          kind === 'inspection' ? row.repairInspection : row.repairReport,
        )
      ) {
        if (!this.prerequisites)
          throw new ConflictException('檢修證據服務尚未就緒');
        resolution = await this.prerequisites.bindingValidation(
          row,
          kind,
          input.data,
          tx,
        );
      }
      if (input.status === 'SUBMITTED' && kind === 'inspection') {
        for (const line of (input as SaveInspectionDto).data.materialPlan
          ?.lines || []) {
          const [product, warehouse] = await Promise.all([
            tx.product.findFirst({
              where: {
                id: line.productId,
                entityId: row.entityId,
                isActive: true,
                hasSerialNumbers: false,
              },
              select: { id: true, sku: true, name: true },
            }),
            tx.warehouse.findFirst({
              where: {
                id: line.warehouseId,
                entityId: row.entityId,
                isActive: true,
              },
              select: { id: true },
            }),
          ]);
          if (
            !product ||
            !warehouse ||
            (line.sku !== undefined && line.sku !== product.sku) ||
            (line.name !== undefined && line.name !== product.name)
          )
            throw new ConflictException('材料品項或倉位已變更，請重新選擇');
        }
      }
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
      // Media IDs alone cannot prove a finalized, scoped upload. The unified
      // media resolver must supply its verified records before media is accepted.
      const finalized = input.data.mediaRefs?.length
        ? await this.media?.attach(
            tx,
            row,
            kind,
            (old?.revision || 0) + 1,
            input.data.mediaRefs,
          )
        : [];
      validateDocumentMediaReferences(
        input.data.mediaRefs,
        {
          entityId: row.entityId,
          itemId: id,
          kind,
          documentRevision: (old?.revision || 0) + 1,
        },
        finalized || [],
      );
      const now = new Date().toISOString();
      let documentData = input.data;
      if (kind === 'inspection' && newAssessment) {
        const inspectionData = input.data as InspectionData;
        if (input.status === 'SUBMITTED') {
          if (!resolution || !inspectionData.templateBinding)
            throw new ConflictException('請先確認此機種的檢測標準');
          if (newAssessment.causalExplanation !== inspectionData.diagnosis)
            throw new BadRequestException('因果說明與檢修診斷不一致');
          validateSubmittedInspectionAssessment(newAssessment, {
            causeStatus: inspectionData.causeStatus,
            checks: inspectionData.checks,
            mediaRefs: inspectionData.mediaRefs,
            isAccidentalDamage: inspectionData.isAccidentalDamage,
            template: resolution.template,
            templateContext: resolution.context,
            calibrations: resolution.calibrations,
            now: new Date(now),
          });
        }
        documentData = {
          ...inspectionData,
          assessment: newAssessment,
          isAccidentalDamage: accidentalDamageFromAssessment(newAssessment),
        };
      }
      const doc = {
        number: (kind === 'inspection' ? 'INS-' : 'REP-') + row.label,
        revision: (old?.revision || 0) + 1,
        status: input.status,
        authorId: userId,
        authorName: fresh.name,
        updatedAt: now,
        ...(input.status === 'SUBMITTED' ? { submittedAt: now } : {}),
        ...(resolution
          ? {
              templateBasis: {
                schema: 1,
                binding: resolution.context.binding,
                verifiedAt: now,
              },
            }
          : {}),
        ...(kind === 'repair'
          ? {
              inspectionRevision:
                inspection?.revision ||
                (row.repairInspection as RepairDocument | null)?.revision,
            }
          : {}),
        data: documentData,
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
                    assessmentPolicy: {
                      schema: 1,
                      inspectionRevision: doc.revision,
                      planHash: inspectionPlanHash(doc as InspectionDocument),
                    },
                    assessmentReview: undefined,
                    csr: undefined,
                    release: undefined,
                    dispositionAuthorization: undefined,
                    workStart: undefined,
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
