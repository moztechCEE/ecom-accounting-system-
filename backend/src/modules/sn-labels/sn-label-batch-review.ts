import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

type Tx = Prisma.TransactionClient;
type Batch = {
  id: string;
  quantity: number;
  revision: string;
  retired_at: Date | null;
  data: { orderDate: string; productId: string; sku: string };
};
type State = 'pending' | 'approved' | 'rejected' | 'blocked';
type Review = {
  id: string;
  state: State;
  requested_by: string;
  request_reason: string;
  requested_at: Date;
  batch_snapshot: { revision: string };
  reviewed_by: string | null;
  reviewed_at: Date | null;
  evidence: { blocker?: string } | null;
  replacement_draft_ids: string[];
};
type Decision = 'approve' | 'reject' | 'received' | 'used';

const getRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('請填寫完整覆核資料');
  }
  return value as Record<string, unknown>;
};
const field = (value: unknown, name: string, max = 200) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new BadRequestException(`請填寫有效的${name}`);
  }
  return value.trim();
};
const date = (value: unknown, name: string) => {
  const day = field(value, name, 10);
  const parsed = new Date(day + 'T00:00:00Z');
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  ) {
    throw new BadRequestException(`請填寫有效的${name}`);
  }
  return day;
};
const lookupTime = (value: unknown, now: Date, requestedAt?: Date) => {
  const stamp = field(value, '核對時間', 35);
  const checked = new Date(stamp);
  if (
    !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
      stamp,
    ) ||
    !Number.isFinite(checked.getTime()) ||
    checked.getTime() > now.getTime() ||
    (requestedAt && checked.getTime() < requestedAt.getTime())
  ) {
    throw new BadRequestException('請填寫本次申請後的實際核對時間');
  }
  return checked.toISOString();
};
const taipeiDate = (value: Date) =>
  new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Human ECOUNT lookup evidence, never an automated response or a local stock guess.
export function validateReceiptEvidence(
  value: unknown,
  batchDate: string,
  now: Date,
  requestedAt?: Date,
) {
  const input = getRecord(value);
  const checkedAt = lookupTime(input.checkedAt, now, requestedAt);
  const company = field(input.company, 'ECOUNT 公司');
  const warehouses = field(input.warehouses, 'ECOUNT 查詢倉庫');
  const purchaseSource = field(input.purchaseSource, '採購來源單號');
  const itemCode = field(input.itemCode, 'ECOUNT 品號');
  const bindingReference = field(
    input.bindingReference,
    '批次與採購來源對照紀錄',
  );
  const reportReference = field(
    input.reportReference,
    'ECOUNT 進貨查詢結果紀錄',
  );
  const from = date(input.from, '進貨查詢起日');
  const to = date(input.to, '進貨查詢迄日');
  if (from > to || to > taipeiDate(now)) {
    throw new BadRequestException('請核對 ECOUNT 進貨查詢日期');
  }
  const receivedQuantity = input.receivedQuantity;
  if (
    typeof receivedQuantity !== 'number' ||
    !Number.isFinite(receivedQuantity) ||
    receivedQuantity < 0 ||
    receivedQuantity > 1_000_000_000
  ) {
    throw new BadRequestException('請輸入 ECOUNT 已收數量');
  }
  if (
    receivedQuantity === 0 &&
    (input.fullScope !== true ||
      from > batchDate ||
      to !== taipeiDate(now) ||
      to !== taipeiDate(new Date(checkedAt)))
  ) {
    throw new BadRequestException(
      '零收貨需有涵蓋全部關聯採購與倉庫、截至核對日的 ECOUNT 查詢紀錄',
    );
  }
  return {
    method: 'manual-ecount-purchase-query' as const,
    checkedAt,
    company,
    warehouses,
    purchaseSource,
    itemCode,
    bindingReference,
    reportReference,
    from,
    to,
    receivedQuantity,
    fullScope: input.fullScope === true,
    receiptReference:
      receivedQuantity > 0
        ? field(input.receiptReference, '已入庫 ECOUNT 進貨單號')
        : null,
  };
}

export function validateUsageEvidence(
  value: unknown,
  issued: boolean,
  now: Date,
  requestedAt?: Date,
) {
  const input = getRecord(value);
  const checkedAt = lookupTime(input.checkedAt, now, requestedAt);
  const wmsReference = field(input.wmsReference, 'WMS 箱號核對紀錄');
  if (input.wmsState === 'used') {
    return { checkedAt, wmsReference, wmsState: 'used' as const };
  }
  if (
    (input.wmsState !== 'not-found' && input.wmsState !== 'draft-cleared') ||
    (input.labelsState !== 'not-issued' &&
      input.labelsState !== 'verified-unused') ||
    (issued && input.labelsState !== 'verified-unused') ||
    input.holdConfirmed !== true
  ) {
    throw new BadRequestException(
      '請確認 WMS 未使用或草稿已解除、已輸出檔案與貼紙未使用，並暫停收貨及使用',
    );
  }
  return {
    checkedAt,
    wmsReference,
    wmsState: input.wmsState,
    labelsState: input.labelsState,
    physicalReference: field(input.physicalReference, '貼紙與匯出檔處理紀錄'),
    holdConfirmed: true,
  };
}

export async function lockSnLabelAllocation(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(726220926)`;
}
async function batchFor(tx: Tx, entity: string, id: string) {
  const [batch] = await tx.$queryRaw<Batch[]>`
    SELECT id, quantity, data, retired_at, updated_at::text AS revision
    FROM sn_label_batches WHERE id=${id} AND entity_id=${entity} FOR UPDATE`;
  if (!batch) throw new NotFoundException('找不到已啟用批次');
  return batch;
}
function requireActive(batch: Batch) {
  if (batch.retired_at)
    throw new ConflictException('此批次已退回，原序號與箱號保留作查核');
}
async function latestReview(tx: Tx | PrismaService, id: string) {
  const [review] = await tx.$queryRaw<Review[]>`
    SELECT * FROM sn_label_batch_reversions WHERE batch_id=${id}
    ORDER BY requested_at DESC, id DESC LIMIT 1`;
  return review;
}
function summarize(review?: Review) {
  return review
    ? {
        id: review.id,
        state: review.state,
        requestedBy: review.requested_by,
        reason: review.request_reason,
        requestedAt: review.requested_at,
        reviewedBy: review.reviewed_by,
        reviewedAt: review.reviewed_at,
        blocker: review.evidence?.blocker || null,
        replacementDraftIds: review.replacement_draft_ids,
      }
    : null;
}
async function event(
  tx: Tx,
  entity: string,
  actor: string,
  batch: string,
  action: string,
  data: Record<string, unknown>,
) {
  await tx.$executeRaw`
    INSERT INTO sn_label_events (id,entity_id,batch_id,actor_id,action,data)
    VALUES (${randomUUID()},${entity},${batch},${actor},${action},${JSON.stringify(data)}::jsonb)`;
}

@Injectable()
export class SnLabelBatchReviewService {
  constructor(private readonly db: PrismaService) {}

  async read(id: string) {
    return summarize(await latestReview(this.db, id));
  }

  async request(entity: string, actor: string, id: string, body: unknown) {
    const input = getRecord(body);
    const reason = field(input.reason, '退回原因', 400);
    const revision = field(input.batchRevision, '批次版本', 100);
    return this.db.$transaction(async (tx) => {
      await lockSnLabelAllocation(tx);
      const batch = await batchFor(tx, entity, id);
      requireActive(batch);
      const current = await latestReview(tx, id);
      if (current?.state === 'pending') {
        if (
          current.requested_by === actor &&
          current.request_reason === reason &&
          current.batch_snapshot.revision === revision
        )
          return summarize(current);
        throw new ConflictException('此批次已有待覆核申請');
      }
      if (current?.state === 'blocked') {
        throw new ConflictException('此批次已有收貨或使用紀錄，不可退回');
      }
      if (revision !== batch.revision)
        throw new ConflictException('批次已更新，請重新載入');
      const reviewId = randomUUID();
      const snapshot = { revision, quantity: batch.quantity, data: batch.data };
      const [review] = await tx.$queryRaw<Review[]>`
        INSERT INTO sn_label_batch_reversions (id,batch_id,requested_by,request_reason,batch_snapshot)
        VALUES (${reviewId},${id},${actor},${reason},${JSON.stringify(snapshot)}::jsonb) RETURNING *`;
      await event(tx, entity, actor, id, 'REVERT_REQUESTED', {
        reviewId,
        reason,
      });
      return summarize(review);
    });
  }

  async decide(
    entity: string,
    actor: string,
    id: string,
    reviewId: string,
    body: unknown,
  ) {
    const input = getRecord(body);
    const decision = input.decision as Decision;
    if (!['approve', 'reject', 'received', 'used'].includes(decision)) {
      throw new BadRequestException('請選擇覆核結果');
    }
    const reason = field(input.reason, '覆核說明', 400);
    return this.db.$transaction(async (tx) => {
      await lockSnLabelAllocation(tx);
      const batch = await batchFor(tx, entity, id);
      const [review] = await tx.$queryRaw<Review[]>`
        SELECT * FROM sn_label_batch_reversions WHERE id=${reviewId} AND batch_id=${id} FOR UPDATE`;
      if (!review) throw new NotFoundException('找不到退回申請');
      if (review.requested_by === actor)
        throw new ForbiddenException('申請人不得覆核自己的申請');
      if (review.state !== 'pending') {
        throw new ConflictException('此申請已覆核，請重新載入');
      }
      requireActive(batch);
      if (review.batch_snapshot.revision !== batch.revision) {
        throw new ConflictException('批次已更新，請重新載入');
      }

      const now = new Date();
      const evidence: Record<string, unknown> = { reason, decision };
      let state: State = 'rejected';
      const replacementDraftIds: string[] = [];
      if (decision !== 'reject') {
        if (decision !== 'used') {
          const receipt = validateReceiptEvidence(
            input.receipt,
            batch.data.orderDate,
            now,
            review.requested_at,
          );
          if (decision === 'received' && receipt.receivedQuantity === 0) {
            throw new BadRequestException(
              '已有收貨需填寫大於零的實際數量與進貨單號',
            );
          }
          evidence.receipt = receipt;
          if (receipt.receivedQuantity > 0)
            evidence.blocker = 'ECOUNT_RECEIVED';
        }
        if (!evidence.blocker) {
          const [local] = await tx.$queryRaw<
            { present: boolean }[]
          >`SELECT EXISTS (
            SELECT 1 FROM sn_label_serials s
            JOIN inventory_serial_numbers n ON n.serial_number=s.sn AND n.entity_id=${entity}
              AND n.product_id=${batch.data.productId}
            WHERE s.batch_id=${id}
          ) AS present`;
          if (local.present) evidence.blocker = 'ERP_SERIAL_IN_USE';
        }
        if (!evidence.blocker) {
          const [output] = await tx.$queryRaw<
            { present: boolean }[]
          >`SELECT EXISTS (
            SELECT 1 FROM sn_label_events WHERE batch_id=${id} AND action='EXPORT'
          ) AS present`;
          const usage = validateUsageEvidence(
            input.usage,
            output.present,
            now,
            review.requested_at,
          );
          evidence.usage = usage;
          if (usage.wmsState === 'used') evidence.blocker = 'WMS_USED';
          if (decision === 'used' && !evidence.blocker) {
            throw new BadRequestException('請填寫已使用的 WMS 紀錄');
          }
        }
        if (evidence.blocker) state = 'blocked';
        else {
          const sources = await tx.$queryRaw<{ data: unknown; id: string }[]>`
            SELECT id, data FROM sn_label_drafts WHERE entity_id=${entity} AND batch_id=${id}
            ORDER BY updated_at, id FOR UPDATE`;
          if (!sources.length)
            throw new ConflictException('找不到原始草稿，請人工核對批次');
          for (const source of sources) {
            const newId = randomUUID();
            await tx.$executeRaw`
              INSERT INTO sn_label_drafts (id,entity_id,data,created_by)
              VALUES (${newId},${entity},${JSON.stringify(source.data)}::jsonb,${actor})`;
            replacementDraftIds.push(newId);
            await event(tx, entity, actor, id, 'REVERT_DRAFT_CREATED', {
              reviewId,
              sourceDraftId: source.id,
              newDraftId: newId,
            });
          }
          await tx.$executeRaw`UPDATE sn_label_batches SET retired_at=now(),updated_at=now() WHERE id=${id}`;
          state = 'approved';
        }
      }
      const [result] = await tx.$queryRaw<Review[]>`
        UPDATE sn_label_batch_reversions
        SET state=${state},reviewed_by=${actor},reviewed_at=now(),evidence=${JSON.stringify(evidence)}::jsonb,
            replacement_draft_ids=${JSON.stringify(replacementDraftIds)}::jsonb
        WHERE id=${reviewId} AND state='pending' RETURNING *`;
      await event(tx, entity, actor, id, 'REVERT_REVIEWED', {
        reviewId,
        state,
        reason,
        blocker: evidence.blocker || null,
        replacementDraftIds,
      });
      return summarize(result);
    });
  }

  async recordOutput(
    entity: string,
    actor: string,
    id: string,
    data: Record<string, unknown>,
  ) {
    return this.db.$transaction(async (tx) => {
      await lockSnLabelAllocation(tx);
      const batch = await batchFor(tx, entity, id);
      requireActive(batch);
      if ((await latestReview(tx, id))?.state === 'pending') {
        throw new ConflictException('批次退回覆核中，暫停輸出');
      }
      await event(tx, entity, actor, id, 'EXPORT', data);
    });
  }
}
