import { BadRequestException, ConflictException } from '@nestjs/common';
import type { MailroomLabel } from '../mailroom-label.contract';
import { requireUuid } from './mailroom-print.contract';

export const LABEL_EDIT_LIMITS = {
  caseNumber: 64,
  customerName: 80,
  customerPhone: 40,
  productName: 120,
  customerIssue: 300,
} as const;
export type LabelEditField = keyof typeof LABEL_EDIT_LIMITS;
export type PrintLabelEdit = {
  itemId: string;
  expectedVersion?: number;
} & Partial<Record<LabelEditField, string>>;
const FIELDS = Object.keys(LABEL_EDIT_LIMITS) as LabelEditField[];
const ALLOWED = new Set<string>(['itemId', 'expectedVersion', ...FIELDS]);
const CONTROL = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;
export const labelVersionConflict = () =>
  new ConflictException({
    code: 'LABEL_VERSION_CHANGED',
    message: '物件已更新，請重新載入標籤',
  });

/** Display-only input: identity, source data and QR can never enter this allowlist. */
export function normalizeLabelEdit(
  raw: unknown,
  outerItemId?: string,
): PrintLabelEdit {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException('標籤文字格式不符');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !ALLOWED.has(key)))
    throw new BadRequestException('標籤只能修改顯示文字');
  const itemId = value.itemId === undefined ? outerItemId : value.itemId;
  requireUuid(itemId);
  const normalizedId = itemId.toLowerCase();
  if (outerItemId !== undefined && normalizedId !== outerItemId.toLowerCase())
    throw new BadRequestException('標籤物件與選取物件不符');
  const edit: PrintLabelEdit = { itemId: normalizedId };
  if (value.expectedVersion !== undefined) {
    if (
      !Number.isSafeInteger(value.expectedVersion) ||
      Number(value.expectedVersion) < 1
    )
      throw new BadRequestException('標籤版本格式不符');
    edit.expectedVersion = value.expectedVersion as number;
  }
  for (const field of FIELDS) {
    const text = value[field];
    if (text === undefined) continue;
    if (
      typeof text !== 'string' ||
      Array.from(text).length > LABEL_EDIT_LIMITS[field] ||
      CONTROL.test(text)
    )
      throw new BadRequestException('標籤文字格式或長度不符');
    edit[field] = text.replace(/\s+/gu, ' ').trim();
  }
  if (
    FIELDS.some((field) => edit[field] !== undefined) &&
    edit.expectedVersion === undefined
  )
    throw new BadRequestException('編輯標籤前請重新載入物件版本');
  return edit;
}

export function normalizeLabelEdits(
  raw: unknown,
  itemIds: readonly string[],
): PrintLabelEdit[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 50)
    throw new BadRequestException('標籤文字格式不符');
  const selected = new Set(itemIds);
  const seen = new Set<string>();
  const edits: PrintLabelEdit[] = [];
  for (const value of raw) {
    const edit = normalizeLabelEdit(value);
    if (!selected.has(edit.itemId) || seen.has(edit.itemId))
      throw new BadRequestException('標籤物件未選取或重複');
    seen.add(edit.itemId);
    // An itemId-only edit changes nothing and retains legacy request fingerprints.
    if (FIELDS.some((field) => edit[field] !== undefined)) edits.push(edit);
  }
  return edits.sort((left, right) => left.itemId.localeCompare(right.itemId));
}

export function editedLabel(
  label: MailroomLabel,
  edit?: PrintLabelEdit,
): MailroomLabel {
  if (!edit) return label;
  if (edit.itemId !== label.id.toLowerCase())
    throw new BadRequestException('標籤物件與選取物件不符');
  if (
    FIELDS.some((field) => edit[field] !== undefined) &&
    edit.expectedVersion !== label.version
  )
    throw labelVersionConflict();
  const result = { ...label };
  for (const field of FIELDS)
    if (edit[field] !== undefined) result[field] = edit[field];
  return result;
}
