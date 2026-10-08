import type { Prisma } from '@prisma/client';
import { REPAIR_RETURN_STATUSES } from './mailroom.contract';

export const REPAIR_LIST_SCOPES = [
  'all',
  'acceptance',
  'mine',
  'waiting',
  'delivery',
  'records',
] as const;
export type RepairListScope = (typeof REPAIR_LIST_SCOPES)[number];

/** Every invocation owns its nested arrays; search and pagination cannot mutate counts. */
export function repairConditions(
  scope: RepairListScope = 'all',
  userId: string,
): Prisma.MailroomItemWhereInput[] {
  const conditions: Prisma.MailroomItemWhereInput[] = [
    {
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
    },
  ];
  switch (scope) {
    case 'mine':
      conditions.push({
        OR: [{ nextUserId: userId }, { repairOwnerId: userId }],
      });
      break;
    case 'acceptance':
      conditions.push({
        status: { in: ['WAITING_REPAIR_ACCEPTANCE', 'PENDING_REFURBISH'] },
      });
      break;
    case 'waiting':
      conditions.push({
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
      conditions.push({ status: 'WAITING_RETURN_ACCEPTANCE' });
      break;
    case 'records':
      conditions.push({
        status: {
          in: ['READY_FOR_DISPATCH', 'DISPATCHED', 'PENDING_WELFARE_STOCK'],
        },
      });
      break;
  }
  return conditions;
}

export type RepairPhoto = {
  buffer: Buffer;
  type: 'image/png' | 'image/jpeg' | 'image/webp';
};
export const REPAIR_PHOTO_MAX_BYTES = 1024 * 1024;

/** Native evidence only: no external URL, SVG, attachment or document fallback. */
export function repairPhoto(evidence: unknown): RepairPhoto | null {
  if (!Array.isArray(evidence) || typeof evidence[0] !== 'string') return null;
  const value = evidence[0];
  if (value.length > Math.ceil(REPAIR_PHOTO_MAX_BYTES / 3) * 4 + 64)
    return null;
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > REPAIR_PHOTO_MAX_BYTES) return null;
  const valid =
    match[1] === 'png'
      ? buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : match[1] === 'jpeg'
        ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
        : buffer.toString('ascii', 0, 4) === 'RIFF' &&
          buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) return null;
  return { buffer, type: `image/${match[1]}` as RepairPhoto['type'] };
}

type OverviewItem = {
  id: string;
  entityId: string;
  evidence?: unknown;
  receipt: {
    entityId: string;
    category: string;
    sourceCaseId: string | null;
    sourceSnapshot?: unknown;
  };
};
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/** The caller opts in only for the authorized repair list. */
export function repairOverview(item: OverviewItem) {
  const snapshot = item.receipt.sourceSnapshot;
  const source =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : null;
  const native =
    item.receipt.entityId === item.entityId &&
    ['REPAIR', 'RETURN'].includes(item.receipt.category);
  const matched =
    native &&
    !!item.receipt.sourceCaseId &&
    source?.id === item.receipt.sourceCaseId &&
    source.type === item.receipt.category;
  return {
    customerName: matched ? text(source.customerLabel, 200) : null,
    customerPhone: matched ? text(source.customerPhone, 100) : null,
    photoUrl:
      native && repairPhoto(item.evidence)
        ? `/mailroom/items/${encodeURIComponent(item.id)}/repair-photo`
        : null,
  };
}
