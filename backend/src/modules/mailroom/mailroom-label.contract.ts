import {
  BadRequestException,
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';

export type MailroomLabel = {
  id: string;
  unit: string;
  caseNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerIssue: string | null;
  productName: string;
  qrLink: string;
  version: number;
};

export type LabelItem = {
  id: string;
  entityId: string;
  label: string;
  productName: string;
  version: number;
  receiptId: string;
  receipt: {
    entityId: string;
    category: string;
    sourceCaseId: string | null;
    sourceNumber: string | null;
  };
};

const ITEM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export function requireLabelItemId(id: string) {
  if (typeof id !== 'string' || !ITEM_ID.test(id))
    throw new BadRequestException('物件代碼格式不符');
}

export function labelOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured =
    env.ERP_PUBLIC_FRONTEND_URL || env.FRONTEND_PUBLIC_URL || env.FRONTEND_URL;
  if (!configured)
    throw new ServiceUnavailableException(
      '尚未設定標籤掃碼網址（ERP_PUBLIC_FRONTEND_URL）',
    );
  try {
    const url = new URL(configured);
    const local =
      env.MAILROOM_ALLOW_LOCAL === 'true' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      configured !== configured.trim()
    )
      throw new Error('invalid origin');
    return url.origin;
  } catch {
    throw new ServiceUnavailableException(
      '標籤掃碼網址必須是可信任的 HTTPS origin',
    );
  }
}

export function labelQrLink(origin: string, item: LabelItem): string {
  requireLabelItemId(item.id);
  if (!ENTITY_ID.test(item.entityId))
    throw new BadRequestException('物件公司代碼格式不符');
  const repair = ['REPAIR', 'RETURN'].includes(item.receipt.category);
  const query = new URLSearchParams({
    entityId: item.entityId,
    itemId: item.id,
  });
  if (repair) query.set('queue', 'all');
  return new URL(
    (repair ? '/operations/repair?' : '/operations/mailroom?') +
      query.toString(),
    origin,
  ).href;
}

/** The Source response is authoritative; no sender, internal note or financial fallback. */
export function labelCustomer(source: unknown, item: LabelItem) {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new BadGatewayException('售後標籤來源格式不符');
  const value = source as Record<string, unknown>;
  if (
    value.id !== item.receipt.sourceCaseId ||
    value.type !== item.receipt.category
  )
    throw new BadGatewayException('售後標籤案件識別不符');
  const text = (raw: unknown, max: number, preserve = false): string | null => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string' || Array.from(raw).length > max)
      throw new BadGatewayException('售後標籤欄位格式不符');
    if (preserve) return raw.trim() ? raw : null;
    return raw.replace(/\p{Cc}/gu, ' ').trim() || null;
  };
  return {
    caseNumber: text(value.number, 200),
    customerName: text(value.customerLabel, 200),
    customerPhone: text(value.customerPhone, 100),
    // The signed Source response is already capped at 1 MiB. Keep its original
    // customer wording; only the small-label renderer may shorten the display.
    customerIssue: text(value.customerIssue, 1024 * 1024, true),
  };
}
