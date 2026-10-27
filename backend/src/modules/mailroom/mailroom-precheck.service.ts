import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  HttpException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NotificationGateway } from '../notification/notification.gateway';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailroomService } from './mailroom.service';
import { CreateReceiptDto } from './mailroom.dto';
import {
  can,
  fingerprint,
  requireEntity,
  requirePermission,
  isRepairWorkbenchItem,
} from './mailroom.contract';
import { physicalCustody } from './repair-workflow.contract';
import { repairWorkflow } from './repair-workflow.contract';
import { caseIntake } from './mailroom-intake.contract';
import { repairPhoto } from './repair-list.contract';
import { recordedPrecheckPhoto } from './mailroom-precheck-record.contract';
import {
  precheckContext,
  savePrecheckContext,
} from './mailroom-precheck-context.contract';
import {
  precheckIdentityHash,
  precheckContentHash,
  precheckItemBlocker,
  precheckSummary,
  requirePrecheckVersion,
  validatePrecheckData,
  type PrecheckDocument,
  type PrecheckItem,
  type PrecheckHandoffResult,
} from './mailroom-precheck.contract';
import {
  resolvePrecheckTemplate,
  type PrecheckTemplateBinding,
} from './mailroom-precheck.templates';
import {
  PrecheckQueryDto,
  SavePrecheckDto,
  StartPrechecksDto,
  HandoffPrechecksDto,
} from './mailroom-precheck.dto';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const binding = (value: unknown): PrecheckTemplateBinding | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as PrecheckTemplateBinding;
  return { id: v.id, revision: v.revision, contentHash: v.contentHash };
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requireUuid = (value: unknown) => {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new BadRequestException('操作或實物識別碼格式不符');
};
export type PrecheckRead = Awaited<ReturnType<MailroomPrecheckService['read']>>;
export type StartPrecheckResult = {
  batchId: string;
  requestId: string;
  duplicate: boolean;
  items: (PrecheckRead & { requestId: string })[];
};
export type SavePrecheckResult = PrecheckRead & {
  requestId: string;
  duplicate: boolean;
};
export type HandoffPrecheckResult = {
  batchId: string;
  requestId: string;
  items: PrecheckHandoffResult[];
  notificationRecipientCount: number;
};

@Injectable()
export class MailroomPrecheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    @Optional() private readonly gateway?: NotificationGateway,
  ) {}

  receiveReceipt(userId: string, input: CreateReceiptDto) {
    return this.mailroom.createForPrecheck(userId, input);
  }

  private async actor(
    userId: string,
    entityId: string,
    write: boolean,
    tx?: Prisma.TransactionClient,
  ) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId, tx);
    requireEntity(actor, entityId);
    if (write) requirePermission(actor, 'mailroom:update');
    else if (
      !can(actor, 'mailroom:read') &&
      !can(actor, 'mailroom:review') &&
      !can(actor, 'repair_workbench:read')
    )
      throw new ForbiddenException('沒有初檢讀取權限');
    const employee = await (tx ?? this.prisma).employee.findFirst({
      where: { entityId, userId, isActive: true },
      select: { id: true },
    });
    if (write && !employee)
      throw new ForbiddenException('初檢人員必須是此公司的在職員工');
    return { actor, writable: !!employee && can(actor, 'mailroom:update') };
  }
  private async item(
    db: Prisma.TransactionClient,
    entityId: string,
    id: string,
  ): Promise<PrecheckItem> {
    requireUuid(id);
    const row = await db.mailroomItem.findFirst({
      where: { id, entityId, receipt: { entityId } },
      include: { receipt: true },
    });
    if (
      !row ||
      row.entityId !== entityId ||
      row.receipt.entityId !== entityId ||
      !['REPAIR', 'RETURN'].includes(row.receipt.category)
    )
      throw new NotFoundException('找不到售後實物');
    return row;
  }
  private requireItemRead(
    actor: Awaited<ReturnType<MailroomService['actor']>>,
    item: PrecheckItem,
  ) {
    if (
      can(actor, 'mailroom:read') ||
      (isRepairWorkbenchItem(item) &&
        (can(actor, 'repair_workbench:read') || can(actor, 'mailroom:review')))
    )
      return;
    throw new ForbiddenException('沒有此實物的初檢讀取權限');
  }
  private async resolution(
    db: Prisma.TransactionClient,
    item: PrecheckItem,
    templateId?: string | null,
  ) {
    const product = item.productId
      ? await db.product.findFirst({
          where: {
            id: item.productId,
            entityId: item.entityId,
            isActive: true,
          },
        })
      : null;
    return resolvePrecheckTemplate(item, product, templateId);
  }
  private documentView(doc: PrecheckDocument | null) {
    if (!doc) return null;
    const data = doc.data as {
      checks: unknown[];
      evidence: string[];
      notRequiredReason: string | null;
    };
    return {
      id: doc.id,
      itemId: doc.itemId,
      revision: doc.revision,
      status: doc.status,
      identityHash: doc.identityHash,
      contentHash: precheckContentHash(doc),
      templateBinding: binding(doc.template),
      checks: data.checks,
      evidence: data.evidence,
      notRequiredReason: data.notRequiredReason,
      ...precheckContext(data),
      savedById: doc.savedById,
      savedByName: doc.savedByName,
      savedAt: new Date(doc.savedAt).toISOString(),
      submittedById: doc.submittedById,
      submittedAt: doc.submittedAt
        ? new Date(doc.submittedAt).toISOString()
        : null,
    };
  }
  private async view(
    db: Prisma.TransactionClient,
    item: PrecheckItem,
    doc: PrecheckDocument | null,
    writable: boolean,
    actorId?: string,
  ) {
    const selected = binding(doc?.template)?.id;
    const resolution = await this.resolution(db, item, selected);
    const stale = !!doc && doc.identityHash !== precheckIdentityHash(item);
    const templateStale =
      !!doc &&
      fingerprint(binding(doc.template)) !==
        fingerprint(binding(resolution.template));
    const blocker = !writable
      ? '沒有初檢編輯權限'
      : precheckItemBlocker(item) ||
        (doc?.status === 'SUBMITTED' ? '初檢已交辦' : null);
    const canSave = !blocker && !!doc && !stale;
    return {
      itemId: item.id,
      itemVersion: item.version,
      label: item.label,
      category: item.receipt.category,
      productName: item.productName,
      productId: item.productId,
      sku: item.sku,
      serialNumber: item.serialNumber,
      stage: precheckSummary(doc, item).stage,
      document: writable ? this.documentView(doc) : null,
      template: resolution,
      availableTemplates: resolution.availableTemplates,
      selectedTemplate: resolution.template,
      capabilities: {
        canStart: !blocker,
        canSave,
        canMarkReady:
          canSave && !templateStale && resolution.state !== 'PRODUCT_UNBOUND',
        canHandoff:
          canSave &&
          !templateStale &&
          doc?.status === 'READY' &&
          item.receipt.category === 'REPAIR' &&
          item.custodianId === actorId &&
          !item.nextUserId &&
          (item as PrecheckItem & { matchResult?: string }).matchResult !==
            'CONFIRMED_ACTUAL' &&
          !repairWorkflow(item.repairWorkflow).csr &&
          (!caseIntake(item.repairWorkflow) ||
            caseIntake(item.repairWorkflow)?.status === 'RESOLVED'),
        reason:
          blocker ||
          (stale
            ? '實收身份已更新，請重新開始初檢'
            : templateStale
              ? '產品初檢表已更新，請重新選擇並保存草稿'
              : null),
      },
      custody: {
        custodianId: item.custodianId,
        location: item.location,
        storageLocationId: item.storageLocationId,
        physicalCustody: physicalCustody(item),
      },
      evidenceThumbnailUrl: repairPhoto(item.evidence)
        ? `/mailroom/prechecks/items/${encodeURIComponent(item.id)}/photo`
        : null,
    };
  }
  async read(userId: string, entityId: string, id: string) {
    const auth = await this.actor(userId, entityId, false);
    const item = await this.item(this.prisma, entityId, id);
    this.requireItemRead(auth.actor, item);
    const doc = await this.prisma.mailroomPrecheckDocument.findUnique({
      where: { entityId_itemId: { entityId, itemId: id } },
    });
    return this.view(this.prisma, item, doc, auth.writable, auth.actor.id);
  }
  async photo(userId: string, entityId: string, id: string) {
    requireUuid(id);
    return this.mailroom.nativeReceiptPhoto(userId, entityId, id);
  }
  async recordedPhoto(
    userId: string,
    entityId: string,
    id: string,
    revision: number,
    photoId: string,
  ) {
    requireUuid(id);
    const item = await this.mailroom.precheckPhotoItem(userId, entityId, id);
    const doc = await this.prisma.mailroomPrecheckDocument.findUnique({
      where: { entityId_itemId: { entityId, itemId: id } },
    });
    const photo = recordedPrecheckPhoto(item, doc, revision, photoId);
    if (!photo) throw new NotFoundException('找不到此版初檢照片');
    return photo;
  }
  async list(userId: string, query: PrecheckQueryDto) {
    const auth = await this.actor(userId, query.entityId, false);
    requirePermission(auth.actor, 'mailroom:read');
    const stage =
      query.stage === 'NOT_STARTED'
        ? Prisma.sql`AND d.id IS NULL`
        : query.stage
          ? Prisma.sql`AND d.status=${query.stage}`
          : Prisma.empty;
    const search = query.search?.trim()
      ? Prisma.sql`AND (position(lower(${query.search.trim()}) in lower(i.product_name))>0 OR position(lower(${query.search.trim()}) in lower(i.label))>0 OR position(lower(${query.search.trim()}) in lower(COALESCE(i.sku,'')))>0 OR position(lower(${query.search.trim()}) in lower(COALESCE(r.source_number,'')))>0)`
      : Prisma.empty;
    const from = Prisma.sql`FROM mailroom_items i JOIN mailroom_receipts r ON r.id=i.receipt_id AND r.entity_id=i.entity_id LEFT JOIN mailroom_precheck_documents d ON d.item_id=i.id AND d.entity_id=i.entity_id WHERE i.entity_id=${query.entityId} AND r.category IN ('REPAIR','RETURN') ${stage} ${search}`;
    const [ids, count] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT i.id ${from} ORDER BY i.created_at DESC,i.id DESC LIMIT 50 OFFSET ${((query.page ?? 1) - 1) * 50}`,
      ),
      this.prisma.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT COUNT(*)::bigint AS total ${from}`,
      ),
    ]);
    const [items, docs] = await Promise.all([
      this.prisma.mailroomItem.findMany({
        where: {
          entityId: query.entityId,
          id: { in: ids.map((row) => row.id) },
          receipt: { entityId: query.entityId },
        },
        include: { receipt: true },
      }),
      this.prisma.mailroomPrecheckDocument.findMany({
        where: {
          entityId: query.entityId,
          itemId: { in: ids.map((row) => row.id) },
        },
      }),
    ]);
    const byItem = new Map(items.map((item) => [item.id, item])),
      byDoc = new Map(docs.map((doc) => [doc.itemId, doc]));
    return {
      items: await Promise.all(
        ids.map((row) =>
          this.view(
            this.prisma,
            byItem.get(row.id)!,
            byDoc.get(row.id) ?? null,
            auth.writable,
            auth.actor.id,
          ),
        ),
      ),
      total: Number(count[0]?.total ?? 0),
      page: query.page ?? 1,
    };
  }
  async start(
    userId: string,
    input: StartPrechecksDto,
  ): Promise<StartPrecheckResult> {
    requireUuid(input.requestId);
    if (
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 50
    )
      throw new BadRequestException('請選擇 1 至 50 件實物');
    for (const part of input.items) {
      requireUuid(part.itemId);
      requireUuid(part.requestId);
    }
    if (
      new Set(input.items.map((part) => part.itemId)).size !==
        input.items.length ||
      new Set(input.items.map((part) => part.requestId)).size !==
        input.items.length
    )
      throw new BadRequestException('實物或操作識別碼不可重複');
    await this.actor(userId, input.entityId, true);
    const hash = fingerprint({ operation: 'START', ...input });
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':mailroom-precheck-batch:' + userId + ':' + input.requestId}))`,
      );
      const replayAuth = await this.actor(userId, input.entityId, true, tx);
      const key = {
        entityId: input.entityId,
        actorId: userId,
        requestId: input.requestId,
      };
      const previous = await tx.mailroomPrecheckBatch.findUnique({
        where: { entityId_actorId_requestId: key },
      });
      if (previous) {
        if (previous.requestHash !== hash || previous.operation !== 'START')
          throw new ConflictException('同一批次識別碼的內容不同');
        // Immutable receipts do not freeze permission. Do not recheck stale
        // versions/custody, but authorize every current native item before replay.
        for (const part of input.items)
          this.requireItemRead(
            replayAuth.actor,
            await this.item(tx, input.entityId, part.itemId),
          );
        return {
          ...(previous.result as unknown as StartPrecheckResult),
          duplicate: true,
        };
      }
      for (const requestId of input.items.map((part) => part.requestId).sort())
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':mailroom-precheck-request:' + userId + ':' + requestId}))`,
        );
      for (const part of [...input.items].sort((a, b) =>
        a.itemId.localeCompare(b.itemId),
      ))
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM mailroom_items WHERE id=${part.itemId} AND entity_id=${input.entityId} FOR UPDATE`,
        );
      const fresh = await this.actor(userId, input.entityId, true, tx);
      const plans: {
        item: PrecheckItem;
        doc: PrecheckDocument;
        create: boolean;
        requestId: string;
        requestHash: string;
      }[] = [];
      for (const part of [...input.items].sort((a, b) =>
        a.itemId.localeCompare(b.itemId),
      )) {
        const item = await this.item(tx, input.entityId, part.itemId);
        this.requireItemRead(fresh.actor, item);
        requirePrecheckVersion(item, part.expectedVersion);
        const existing = await tx.mailroomPrecheckDocument.findUnique({
          where: {
            entityId_itemId: { entityId: input.entityId, itemId: item.id },
          },
        });
        if (existing?.status === 'SUBMITTED')
          throw new ConflictException('初檢已交辦');
        const childKey = {
          entityId: input.entityId,
          actorId: userId,
          requestId: part.requestId,
        };
        if (
          await tx.mailroomPrecheckRequest.findUnique({
            where: { entityId_actorId_requestId: childKey },
          })
        )
          throw new ConflictException('逐件操作識別碼已用於其他批次');
        const identityHash = precheckIdentityHash(item),
          reset = !existing || existing.identityHash !== identityHash;
        const resolution = await this.resolution(tx, item);
        const now = new Date();
        const doc: PrecheckDocument = reset
          ? {
              id: existing?.id ?? randomUUID(),
              entityId: input.entityId,
              itemId: item.id,
              revision: (existing?.revision ?? 0) + 1,
              status: 'DRAFT',
              identityHash,
              template: resolution.template,
              data: { checks: [], evidence: [], notRequiredReason: null },
              savedById: fresh.actor.id,
              savedByName: fresh.actor.name,
              savedAt: now,
              submittedById: null,
              submittedAt: null,
            }
          : existing;
        plans.push({
          item,
          doc,
          create: reset,
          requestId: part.requestId,
          requestHash: fingerprint({
            operation: 'START',
            batchRequestId: input.requestId,
            entityId: input.entityId,
            ...part,
          }),
        });
      }
      const batchId = randomUUID();
      const ordered = input.items.map(
        (part) => plans.find((plan) => plan.item.id === part.itemId)!,
      );
      const result = {
        batchId,
        requestId: input.requestId,
        duplicate: false,
        items: await Promise.all(
          ordered.map(async (plan) => ({
            requestId: plan.requestId,
            ...(await this.view(tx, plan.item, plan.doc, true, fresh.actor.id)),
          })),
        ),
      };
      await tx.mailroomPrecheckBatch.create({
        data: {
          id: batchId,
          ...key,
          requestHash: hash,
          operation: 'START',
          result: json(result),
        },
      });
      for (const plan of plans) {
        if (plan.create) {
          const data = {
            ...plan.doc,
            template: plan.doc.template
              ? json(plan.doc.template)
              : Prisma.DbNull,
            data: json(plan.doc.data),
          };
          await tx.mailroomPrecheckDocument.upsert({
            where: {
              entityId_itemId: {
                entityId: input.entityId,
                itemId: plan.item.id,
              },
            },
            create: data,
            update: data,
          });
        }
        await tx.mailroomPrecheckRequest.create({
          data: {
            entityId: input.entityId,
            actorId: userId,
            requestId: plan.requestId,
            requestHash: plan.requestHash,
            operation: 'START',
            itemId: plan.item.id,
            batchId,
            result: json(
              result.items.find((part) => part.itemId === plan.item.id),
            ),
          },
        });
      }
      return result;
    });
  }
  async save(
    userId: string,
    id: string,
    input: SavePrecheckDto,
  ): Promise<SavePrecheckResult> {
    requireUuid(id);
    requireUuid(input.requestId);
    if (input.templateBinding === undefined || !Array.isArray(input.checks))
      throw new BadRequestException('初檢文件格式不符');
    await this.actor(userId, input.entityId, true);
    const hash = fingerprint({ operation: 'SAVE', itemId: id, ...input });
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':mailroom-precheck-request:' + userId + ':' + input.requestId}))`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_items WHERE id=${id} AND entity_id=${input.entityId} FOR UPDATE`,
      );
      const auth = await this.actor(userId, input.entityId, true, tx);
      const key = {
        entityId: input.entityId,
        actorId: userId,
        requestId: input.requestId,
      };
      const previous = await tx.mailroomPrecheckRequest.findUnique({
        where: { entityId_actorId_requestId: key },
      });
      if (previous) {
        if (
          previous.requestHash !== hash ||
          previous.itemId !== id ||
          previous.operation !== 'SAVE'
        )
          throw new ConflictException('同一操作識別碼的內容不同');
        this.requireItemRead(
          auth.actor,
          await this.item(tx, input.entityId, id),
        );
        return {
          ...(previous.result as unknown as SavePrecheckResult),
          duplicate: true,
        };
      }
      const item = await this.item(tx, input.entityId, id);
      this.requireItemRead(auth.actor, item);
      requirePrecheckVersion(item, input.expectedVersion);
      const doc = await tx.mailroomPrecheckDocument.findUnique({
        where: { entityId_itemId: { entityId: input.entityId, itemId: id } },
      });
      if (!doc) throw new ConflictException('請先開始初檢');
      if (doc.status === 'SUBMITTED' || doc.revision !== input.expectedRevision)
        throw new ConflictException('初檢版本已更新，請重新讀取');
      if (doc.identityHash !== precheckIdentityHash(item))
        throw new ConflictException('實收身份已更新，請重新開始初檢');
      const resolution = await this.resolution(
        tx,
        item,
        input.templateBinding?.id ?? null,
      );
      const changedTemplate =
        fingerprint(binding(doc.template)) !==
        fingerprint(input.templateBinding);
      if (doc.template && input.templateBinding === null)
        throw new BadRequestException(
          '已選初檢表不能以不需初檢原因略過必要項目',
        );
      if (changedTemplate && (input.status !== 'DRAFT' || input.checks.length))
        throw new BadRequestException('更換初檢表時請先清空檢查結果並保存草稿');
      const data = {
        ...validatePrecheckData(input, resolution),
        ...savePrecheckContext(input, doc.data, auth.actor, new Date()),
      };
      const updated = await tx.mailroomPrecheckDocument.update({
        where: { id: doc.id, revision: doc.revision },
        data: {
          revision: { increment: 1 },
          status: input.status,
          template: resolution.template
            ? json(resolution.template)
            : Prisma.DbNull,
          data: json(data),
          savedById: auth.actor.id,
          savedByName: auth.actor.name,
          savedAt: new Date(),
        },
      });
      const result = {
        requestId: input.requestId,
        duplicate: false,
        ...(await this.view(tx, item, updated, true, auth.actor.id)),
      };
      await tx.mailroomPrecheckRequest.create({
        data: {
          ...key,
          requestHash: hash,
          operation: 'SAVE',
          itemId: id,
          result: json(result),
        },
      });
      return result;
    });
  }

  async handoff(
    userId: string,
    input: HandoffPrechecksDto,
  ): Promise<HandoffPrecheckResult> {
    requireUuid(input.requestId);
    if (
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 50
    )
      throw new BadRequestException('請選擇 1 至 50 件實物');
    for (const part of input.items) {
      requireUuid(part.itemId);
      requireUuid(part.requestId);
    }
    if (
      new Set(input.items.map((part) => part.itemId)).size !==
        input.items.length ||
      new Set(input.items.map((part) => part.requestId)).size !==
        input.items.length
    )
      throw new BadRequestException('實物或操作識別碼不可重複');
    const initial = await this.actor(userId, input.entityId, true);
    requirePermission(initial.actor, 'mailroom:read');
    const requestHash = fingerprint({ operation: 'HANDOFF', ...input });
    const batch = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':mailroom-precheck-batch:' + userId + ':' + input.requestId}))`,
      );
      const fresh = await this.actor(userId, input.entityId, true, tx);
      requirePermission(fresh.actor, 'mailroom:read');
      const key = {
        entityId: input.entityId,
        actorId: userId,
        requestId: input.requestId,
      };
      const old = await tx.mailroomPrecheckBatch.findUnique({
        where: { entityId_actorId_requestId: key },
      });
      if (old) {
        if (old.operation !== 'HANDOFF' || old.requestHash !== requestHash)
          throw new ConflictException('同一批次識別碼的內容不同');
        return old;
      }
      return tx.mailroomPrecheckBatch.create({
        data: {
          ...key,
          requestHash,
          operation: 'HANDOFF',
          result: json({ input, items: [] }),
        },
      });
    });
    const items: PrecheckHandoffResult[] = [];
    for (const part of input.items) {
      try {
        items.push(
          await this.prisma.$transaction(
            (tx) =>
              this.mailroom.completePrecheckHandoff(tx, userId, batch, part),
            { timeout: 30000 },
          ),
        );
      } catch (error) {
        const response =
          error instanceof HttpException ? error.getResponse() : null;
        const details =
          response && typeof response === 'object'
            ? (response as { code?: string; message?: string })
            : null;
        items.push({
          itemId: part.itemId,
          requestId: part.requestId,
          status:
            error instanceof HttpException && error.getStatus() < 500
              ? 'FAILED'
              : 'UNKNOWN',
          code:
            details?.code ??
            (error instanceof HttpException && error.getStatus() < 500
              ? 'HANDOFF_REJECTED'
              : 'RESULT_UNKNOWN'),
          message:
            error instanceof HttpException && error.getStatus() < 500
              ? (details?.message ?? error.message)
              : '結果尚未確認，請保留原操作識別碼重試',
        });
      }
    }
    const notifications = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':mailroom-precheck-batch:' + userId + ':' + input.requestId}))`,
      );
      const fresh = await this.actor(userId, input.entityId, true, tx);
      requirePermission(fresh.actor, 'mailroom:read');
      // A concurrent exact retry may have committed a child whose first response was lost.
      const committed = await tx.mailroomPrecheckRequest.findMany({
        where: {
          batchId: batch.id,
          entityId: input.entityId,
          actorId: userId,
          operation: 'HANDOFF',
        },
      });
      const successes = new Map(
        committed.map((row) => [
          row.requestId,
          row.result as unknown as PrecheckHandoffResult,
        ]),
      );
      const resolved = items.map(
        (part) => successes.get(part.requestId) ?? part,
      );
      const currentBatch = await tx.mailroomPrecheckBatch.findUnique({
        where: { id: batch.id },
      });
      if (
        !currentBatch ||
        currentBatch.entityId !== input.entityId ||
        currentBatch.actorId !== userId ||
        currentBatch.requestHash !== requestHash
      )
        throw new ConflictException('交辦批次內容不符');
      await tx.mailroomPrecheckBatch.update({
        where: { id: batch.id },
        data: { result: json({ input, items: resolved }) },
      });
      const applied = resolved.filter((part) => part.status === 'APPLIED');
      const created: Awaited<ReturnType<typeof tx.notification.create>>[] = [];
      if (applied.length) {
        let recipientIds: string[];
        if (currentBatch.recipientSnapshot === null) {
          const users = await tx.user.findMany({
            where: {
              isActive: true,
              mustChangePassword: false,
              employee: { entityId: input.entityId, isActive: true },
            },
            select: { id: true },
          });
          recipientIds = [];
          for (const user of users)
            if (await this.currentRepairRecipient(tx, input.entityId, user.id))
              recipientIds.push(user.id);
          recipientIds = [...new Set(recipientIds)].sort();
          // Empty is a completed snapshot too. Exact retry must never expand it.
          await tx.mailroomPrecheckBatch.update({
            where: { id: batch.id },
            data: { recipientSnapshot: json(recipientIds) },
          });
        } else {
          if (
            !Array.isArray(currentBatch.recipientSnapshot) ||
            currentBatch.recipientSnapshot.some(
              (id) =>
                typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(id),
            )
          )
            throw new ConflictException('交辦通知名單格式不符');
          recipientIds = currentBatch.recipientSnapshot as string[];
        }
        for (const recipientId of recipientIds) {
          // Membership is fixed, eligibility is not: revoked people never receive
          // a newly created or updated notification, even from an old snapshot.
          if (
            !(await this.currentRepairRecipient(
              tx,
              input.entityId,
              recipientId,
            ))
          )
            continue;
          const old = await tx.mailroomPrecheckBatchRecipient.findUnique({
            where: {
              batchId_userId: { batchId: batch.id, userId: recipientId },
            },
          });
          const message = `本批 ${applied.length} 件初檢已完成，請至維修待認領清單查看；本人簽收前保管人不變。`;
          if (old) {
            await tx.notification.updateMany({
              where: {
                id: old.notificationId,
                userId: recipientId,
                NOT: { message },
              },
              data: { message },
            });
            continue;
          }
          const notification = await tx.notification.create({
            data: {
              userId: recipientId,
              title: '收發初檢完成，維修待認領',
              message,
              type: 'info',
              category: 'mailroom',
              data: {
                entityId: input.entityId,
                precheckBatchId: batch.id,
                targetPath:
                  '/operations/repair?queue=acceptance&entityId=' +
                  encodeURIComponent(input.entityId),
              },
            },
          });
          await tx.mailroomPrecheckBatchRecipient.create({
            data: {
              entityId: input.entityId,
              batchId: batch.id,
              userId: recipientId,
              notificationId: notification.id,
            },
          });
          created.push(notification);
        }
      }
      const count = await tx.mailroomPrecheckBatchRecipient.count({
        where: { batchId: batch.id, entityId: input.entityId },
      });
      return { created, count, items: resolved };
    });
    // Pure socket delivery only; never drains mailroom/AI/Source outboxes.
    for (const notification of notifications.created) {
      try {
        this.gateway?.sendToUser(notification.userId, notification);
      } catch {
        /* persisted unread notification remains available */
      }
    }
    return {
      batchId: batch.id,
      requestId: input.requestId,
      items: notifications.items,
      notificationRecipientCount: notifications.count,
    };
  }

  private async currentRepairRecipient(
    tx: Prisma.TransactionClient,
    entityId: string,
    userId: string,
  ) {
    const receiver = await this.mailroom.actor(userId, tx).catch(() => null);
    if (
      !receiver ||
      !receiver.permissions.has('repair_workbench:read') ||
      !receiver.permissions.has('repair_workbench:update') ||
      (receiver.entityIds !== null && !receiver.entityIds.includes(entityId))
    )
      return false;
    // This exact-company/current-status recheck follows the fresh grant read;
    // an old candidate row or wildcard role is never sufficient.
    const current = await tx.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        mustChangePassword: false,
        employee: { entityId, isActive: true },
      },
      select: { id: true },
    });
    return !!current;
  }

  async batch(userId: string, entityId: string, id: string) {
    requireUuid(id);
    const auth = await this.actor(userId, entityId, false);
    requirePermission(auth.actor, 'mailroom:read');
    const row = await this.prisma.mailroomPrecheckBatch.findFirst({
      where: { id, entityId, actorId: userId, operation: 'HANDOFF' },
    });
    if (!row) throw new NotFoundException('找不到本人交辦批次');
    const result = row.result as unknown as {
      input: HandoffPrechecksDto;
      items?: PrecheckHandoffResult[];
    };
    const requests = await this.prisma.mailroomPrecheckRequest.findMany({
      where: { batchId: id, entityId, actorId: userId, operation: 'HANDOFF' },
    });
    const byRequest = new Map(
      requests.map((request) => [
        request.requestId,
        request.result as unknown as PrecheckHandoffResult,
      ]),
    );
    const count = await this.prisma.mailroomPrecheckBatchRecipient.count({
      where: { batchId: id, entityId },
    });
    return {
      batchId: row.id,
      requestId: row.requestId,
      items: result.input.items.map(
        (part) =>
          byRequest.get(part.requestId) ??
          result.items?.find((old) => old.requestId === part.requestId) ?? {
            itemId: part.itemId,
            requestId: part.requestId,
            status: 'UNKNOWN',
            code: 'RESULT_UNKNOWN',
            message: '結果尚未確認，請保留原操作識別碼重試',
          },
      ),
      notificationRecipientCount: count,
    };
  }
}
