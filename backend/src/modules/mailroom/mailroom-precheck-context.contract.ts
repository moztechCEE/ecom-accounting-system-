import { BadRequestException } from '@nestjs/common';

export const WARRANTY_REVIEW_STATUSES = [
  'CHECKED',
  'NEEDS_CORRECTION',
  'CORRECTED_EXTERNALLY',
] as const;
export type WarrantyReviewStatus = (typeof WARRANTY_REVIEW_STATUSES)[number];
export type WarrantyReviewInput = {
  status: WarrantyReviewStatus;
  note?: string | null;
  warrantyNumber?: string | null;
};
export type MailroomIssueInput = {
  symptom?: string | null;
  preliminaryReason?: string | null;
};
export type ManualWarrantyReview = {
  schema: 1;
  method: 'MANUAL_EXTERNAL';
  status: WarrantyReviewStatus;
  note: string | null;
  warrantyNumber: string | null;
  recordedById: string;
  recordedByName: string;
  recordedAt: string;
};
export type MailroomIssue = {
  schema: 1;
  symptom: string | null;
  preliminaryReason: string | null;
};
export type PrecheckContext = {
  warrantyReview?: ManualWarrantyReview | null;
  mailroomIssue?: MailroomIssue | null;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('收發核對紀錄格式不符');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new BadRequestException('收發核對紀錄包含未定義欄位');
}
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > 2000)
    throw new BadRequestException('收發核對說明格式不符或過長');
  return value.trim() || null;
}
function reviewInput(
  value: unknown,
  previousNumber: string | null = null,
): {
  status: WarrantyReviewStatus;
  note: string | null;
  warrantyNumber: string | null;
} {
  const row = object(value);
  keys(row, ['status', 'note', 'warrantyNumber']);
  if (!WARRANTY_REVIEW_STATUSES.includes(row.status as WarrantyReviewStatus))
    throw new BadRequestException('請選擇人工保固核對結果');
  const warrantyNumber =
    row.warrantyNumber === undefined
      ? previousNumber
      : text(row.warrantyNumber);
  if (warrantyNumber && warrantyNumber.length > 200)
    throw new BadRequestException('保固編號過長');
  return {
    status: row.status as WarrantyReviewStatus,
    note: text(row.note),
    warrantyNumber,
  };
}
function issueInput(value: unknown): MailroomIssue | null {
  const row = object(value);
  keys(row, ['symptom', 'preliminaryReason']);
  const symptom = text(row.symptom),
    preliminaryReason = text(row.preliminaryReason);
  return symptom || preliminaryReason
    ? { schema: 1, symptom, preliminaryReason }
    : null;
}

/** Optional, explicitly defined document fields. Legacy documents stay legacy. */
export function precheckContext(data: unknown): PrecheckContext {
  const row = object(data),
    result: PrecheckContext = {};
  if (row.warrantyReview !== undefined) {
    if (row.warrantyReview === null) result.warrantyReview = null;
    else {
      const review = object(row.warrantyReview);
      keys(review, [
        'schema',
        'method',
        'status',
        'note',
        'warrantyNumber',
        'recordedById',
        'recordedByName',
        'recordedAt',
      ]);
      const normalized = reviewInput({
        status: review.status,
        note: review.note,
        warrantyNumber: review.warrantyNumber,
      });
      if (
        review.schema !== 1 ||
        review.method !== 'MANUAL_EXTERNAL' ||
        typeof review.recordedById !== 'string' ||
        !review.recordedById.trim() ||
        typeof review.recordedByName !== 'string' ||
        !review.recordedByName.trim() ||
        typeof review.recordedAt !== 'string' ||
        !Number.isFinite(Date.parse(review.recordedAt))
      )
        throw new BadRequestException('人工保固核對紀錄格式不符');
      result.warrantyReview = {
        schema: 1,
        method: 'MANUAL_EXTERNAL',
        ...normalized,
        recordedById: review.recordedById,
        recordedByName: review.recordedByName,
        recordedAt: review.recordedAt,
      };
    }
  }
  if (row.mailroomIssue !== undefined) {
    if (row.mailroomIssue === null) result.mailroomIssue = null;
    else {
      const issue = object(row.mailroomIssue);
      keys(issue, ['schema', 'symptom', 'preliminaryReason']);
      if (issue.schema !== 1)
        throw new BadRequestException('收發問題紀錄版本不符');
      result.mailroomIssue = issueInput({
        symptom: issue.symptom,
        preliminaryReason: issue.preliminaryReason,
      });
    }
  }
  return result;
}

/** Caller cannot claim a warranty-system write or choose its audit identity. */
export function savePrecheckContext(
  input: {
    warrantyReview?: WarrantyReviewInput | null;
    mailroomIssue?: MailroomIssueInput | null;
  },
  previous: unknown,
  actor: { id: string; name: string },
  now: Date,
): PrecheckContext {
  const result = precheckContext(previous);
  if (input.warrantyReview !== undefined) {
    if (input.warrantyReview === null) result.warrantyReview = null;
    else {
      const old = result.warrantyReview,
        next = reviewInput(input.warrantyReview, old?.warrantyNumber);
      if (
        !old ||
        old.status !== next.status ||
        old.note !== next.note ||
        old.warrantyNumber !== next.warrantyNumber
      )
        result.warrantyReview = {
          schema: 1,
          method: 'MANUAL_EXTERNAL',
          ...next,
          recordedById: actor.id,
          recordedByName: actor.name,
          recordedAt: now.toISOString(),
        };
    }
  }
  if (input.mailroomIssue !== undefined)
    result.mailroomIssue =
      input.mailroomIssue === null ? null : issueInput(input.mailroomIssue);
  return result;
}
