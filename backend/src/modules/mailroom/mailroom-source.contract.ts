import { BadGatewayException } from '@nestjs/common';

export const SOURCE_CASE_TYPES = [
  'RESHIPMENT',
  'PRIVATE_PURCHASE',
  'REPAIR',
  'EXCHANGE_RETURN',
  'REFUND_PICKUP',
  'CUSTOMER_ISSUE',
] as const;
export type SourceChangeEvent = {
  id: string;
  caseId: string;
  caseNumber: string;
  caseType: (typeof SOURCE_CASE_TYPES)[number];
  change: 'UPDATED' | 'DELETED';
  occurredAt: string;
  sourceChannel: string;
  initial: boolean;
};
export type SourceChanges = {
  events: SourceChangeEvent[];
  nextCursor: string;
  hasMore: boolean;
};
export function validSourceCursor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(0|[1-9]\d{0,18})$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}
export function validateSourceChanges(
  value: unknown,
  cursor: string,
): SourceChanges {
  const result = value as SourceChanges;
  if (
    !validSourceCursor(cursor) ||
    !result ||
    !Array.isArray(result.events) ||
    result.events.length > 100 ||
    !validSourceCursor(result.nextCursor) ||
    typeof result.hasMore !== 'boolean'
  )
    throw new BadGatewayException('售後來源事件分頁格式不符');
  let previous = BigInt(cursor);
  for (const event of result.events) {
    if (
      !event ||
      !validSourceCursor(event.id) ||
      BigInt(event.id) <= previous ||
      ![event.caseId, event.caseNumber, event.sourceChannel].every(
        (s) => typeof s === 'string' && s.length > 0 && s.length <= 128,
      ) ||
      !SOURCE_CASE_TYPES.includes(event.caseType) ||
      !['UPDATED', 'DELETED'].includes(event.change) ||
      (event.initial !== undefined && typeof event.initial !== 'boolean') ||
      typeof event.occurredAt !== 'string' ||
      !Number.isFinite(Date.parse(event.occurredAt))
    )
      throw new BadGatewayException('售後來源事件內容或順序不符');
    previous = BigInt(event.id);
  }
  if (
    BigInt(result.nextCursor) < previous ||
    (result.hasMore && BigInt(result.nextCursor) <= BigInt(cursor))
  )
    throw new BadGatewayException('售後來源游標未前進或跳過已返回事件');
  return {
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
    events: result.events.map((event) => ({
      id: event.id,
      caseId: event.caseId,
      caseNumber: event.caseNumber,
      caseType: event.caseType,
      change: event.change,
      occurredAt: event.occurredAt,
      sourceChannel: event.sourceChannel,
      initial: event.initial ?? false,
    })),
  };
}
export const isPhysicalSourceCase = (event: SourceChangeEvent) =>
  ['REPAIR', 'EXCHANGE_RETURN', 'REFUND_PICKUP'].includes(event.caseType);

// Expose only the delivery marker, never the source snapshot or customer/financial fields.
export function sourceSyncSummary(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null;
  const value = (snapshot as { sourceSync?: unknown }).sourceSync;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const marker = value as Record<string, unknown>;
  if (
    !validSourceCursor(marker.eventId) ||
    typeof marker.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(marker.occurredAt)) ||
    !['UPDATED', 'DELETED'].includes(String(marker.change)) ||
    !['AVAILABLE', 'DELETED', 'NOT_FOUND'].includes(
      String(marker.availability),
    ) ||
    typeof marker.sourceChannel !== 'string' ||
    marker.sourceChannel.length > 128
  )
    return null;
  return {
    eventId: marker.eventId,
    occurredAt: marker.occurredAt,
    change: marker.change as 'UPDATED' | 'DELETED',
    availability: marker.availability as 'AVAILABLE' | 'DELETED' | 'NOT_FOUND',
    sourceChannel: marker.sourceChannel,
    initial: marker.initial === true,
  };
}
