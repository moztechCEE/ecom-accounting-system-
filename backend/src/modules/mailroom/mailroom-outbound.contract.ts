import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type MailroomOutboundOrder as SourceOrder } from './mailroom-workflow-event.contract';
import {
  type CreateOutboundDto,
  type OutboundCommandDto,
} from './mailroom-outbound.dto';
export type OutboundUnit = {
  unitId: string;
  sourceCaseItemId: string;
  productName: string;
  sku: string;
  quantity: 1;
  productId?: string;
  warehouseId?: string;
  serialNumber?: string | null;
  postingId?: string;
  referenceType?: string;
  referenceId?: string;
  externalInventoryPosted?: false;
};
export function validateOutboundCommand(input: OutboundCommandDto) {
  const extra: Record<OutboundCommandDto['action'], string[]> = {
    prepare: ['confirmedItems', 'location', 'nextUserId', 'items'],
    accept: ['confirmedItems', 'location'],
    dispatch: ['confirmedItems', 'carrier', 'trackingNumber'],
    cancel: [],
    retry_sync: [],
    refresh_source: [],
  };
  if (!extra[input.action]) throw new BadRequestException('寄件動作不支援');
  const allowed = new Set([
    'entityId',
    'requestId',
    'expectedVersion',
    'action',
    ...extra[input.action],
  ]);
  if (
    Object.entries(input).some(
      ([key, value]) => value !== undefined && !allowed.has(key),
    )
  )
    throw new BadRequestException('此動作不能修改其他寄件欄位');
}
export function outboundUnits(value: unknown): OutboundUnit[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200)
    throw new ConflictException('寄件品項記錄不完整');
  const ids = new Set<string>();
  const units = value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new ConflictException('寄件品項記錄不完整');
    const unit = entry as OutboundUnit;
    if (
      ![unit.unitId, unit.sourceCaseItemId, unit.productName, unit.sku].every(
        (v) => typeof v === 'string' && !!v.trim(),
      ) ||
      unit.quantity !== 1 ||
      ids.has(unit.unitId)
    )
      throw new ConflictException('寄件品項記錄不完整');
    ids.add(unit.unitId);
    return structuredClone(unit);
  });
  return units;
}
export function requireOutboundSource(
  source: SourceOrder | undefined,
  caseId: string,
  version: string,
) {
  if (!source || source.id !== caseId || source.version !== version)
    throw new ConflictException('售後案件已更新，請重新確認寄件內容');
  if (!source.dispatchAllowed)
    throw new ConflictException(source.blockReason || '售後案件尚未放行出貨');
  return source;
}
/** Union explicit physical IDs; do not add the same ACKed unit twice across databases. */
export function allocateOutboundUnits(
  source: SourceOrder,
  request: CreateOutboundDto,
  existing: OutboundUnit[],
) {
  requireOutboundSource(source, request.sourceCaseId, request.sourceVersion);
  if (
    !Array.isArray(request.lines) ||
    request.lines.length < 1 ||
    request.lines.length > 100
  )
    throw new BadRequestException('請選擇寄出品項');
  const selected = new Set<string>();
  const result: OutboundUnit[] = [];
  for (const line of request.lines) {
    const declared = source.items.find(
      (item) => item.id === line.sourceCaseItemId,
    );
    if (
      !declared ||
      selected.has(line.sourceCaseItemId) ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1
    )
      throw new BadRequestException('寄出品項或數量不符');
    if (!declared.sku?.trim())
      throw new BadRequestException('售後商品缺少 SKU，請先由客服確認商品');
    selected.add(line.sourceCaseItemId);
    const allocatedIds = new Set([
      ...declared.dispatchedUnitIds,
      ...existing
        .filter((unit) => unit.sourceCaseItemId === declared.id)
        .map((unit) => unit.unitId),
    ]);
    const legacyQuantity =
      declared.dispatchedQuantity - declared.dispatchedUnitIds.length;
    if (line.quantity + allocatedIds.size + legacyQuantity > declared.quantity)
      throw new ConflictException('品項已安排寄出或數量已變動，請重新整理');
    for (let i = 0; i < line.quantity; i++)
      result.push({
        unitId: randomUUID(),
        sourceCaseItemId: declared.id,
        productName: declared.name,
        sku: declared.sku,
        quantity: 1,
      });
    if (result.length > 200)
      throw new BadRequestException('每張寄件單最多 200 件');
  }
  return result;
}
export function requireSourceUnits(source: SourceOrder, units: OutboundUnit[]) {
  for (const unit of units) {
    const declared = source.items.find(
      (line) => line.id === unit.sourceCaseItemId,
    );
    if (
      !declared ||
      declared.sku !== unit.sku ||
      declared.name !== unit.productName
    )
      throw new ConflictException('售後申報品項已變動，請重新確認');
  }
}
