import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validatePhotos, type SourceCase } from './mailroom.contract';
import type { CreateReceiptDto, ReceiptItemDto } from './mailroom.dto';

const MB = 1024 * 1024;

export function validateReceiptPayload(input: CreateReceiptDto) {
  if (
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 50
  )
    throw new BadRequestException('每次收件須有 1 至 50 件物品');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 50 * MB)
    throw new BadRequestException('收件資料超過 50 MB');
  const photosRequired = ['REPAIR', 'RETURN', 'UNMATCHED'].includes(
    input.category,
  );
  let total = 0;
  for (const item of input.items) {
    if (typeof item.productName !== 'string' || !item.productName.trim())
      throw new BadRequestException('請填寫實收物品名稱');
    if (
      item.evidence !== undefined &&
      (!Array.isArray(item.evidence) ||
        item.evidence.some((photo) => typeof photo !== 'string'))
    )
      throw new BadRequestException('照片資料格式不符');
    if (photosRequired && !item.evidence?.length)
      throw new BadRequestException('請先拍照留底，再登記售後或待確認收件');
    validatePhotos(item.evidence);
    for (const photo of item.evidence || [])
      total += Buffer.from(
        photo.slice(photo.indexOf(',') + 1),
        'base64',
      ).length;
    if (total > 12 * MB)
      throw new BadRequestException('本次收件照片合計不可超過 12 MB');
  }
  if (['REPAIR', 'RETURN'].includes(input.category) && !input.sourceVersion)
    throw new BadRequestException('請重新選擇售後案件');
  if (
    !['REPAIR', 'RETURN'].includes(input.category) &&
    input.sourceVersion !== undefined
  )
    throw new BadRequestException('一般或待確認收件不可附售後案件版本');
  if (
    !input.storageLocationId &&
    (typeof input.location !== 'string' || !input.location.trim())
  )
    throw new BadRequestException('請填寫收件存放位置');
}

export function requireReceiptSourceVersion(
  source: SourceCase,
  expected: string | undefined,
) {
  if (!expected || source.version !== expected)
    throw new ConflictException('售後案件已更新，請重新選擇並核對');
}

export async function resolveReceiptLocation(
  tx: Prisma.TransactionClient,
  input: Pick<CreateReceiptDto, 'entityId' | 'storageLocationId' | 'location'>,
) {
  if (!input.storageLocationId)
    return { storageLocationId: null, location: input.location?.trim() || '' };
  const candidate = await tx.mailroomStorageLocation.findFirst({
    where: { id: input.storageLocationId, entityId: input.entityId },
    select: { id: true, rackId: true },
  });
  if (!candidate) throw new NotFoundException('找不到此公司的儲位');
  // Same rack-before-bin order as storage move/disable; both remain locked until receipt commit.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM mailroom_storage_racks WHERE id=${candidate.rackId} AND entity_id=${input.entityId} FOR UPDATE`,
  );
  const rack = await tx.mailroomStorageRack.findFirst({
    where: { id: candidate.rackId, entityId: input.entityId },
    select: { isActive: true },
  });
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM mailroom_storage_locations WHERE id=${candidate.id} AND entity_id=${input.entityId} FOR UPDATE`,
  );
  const location = await tx.mailroomStorageLocation.findFirst({
    where: { id: candidate.id, entityId: input.entityId },
    select: { id: true, code: true, rackId: true, isActive: true },
  });
  if (
    !rack?.isActive ||
    !location?.isActive ||
    location.rackId !== candidate.rackId
  )
    throw new ConflictException('儲位或貨架已停用，請重新選擇');
  return { storageLocationId: location.id, location: location.code };
}

export async function validateReceiptProduct(
  tx: Prisma.TransactionClient,
  entityId: string,
  row: ReceiptItemDto,
) {
  if (!row.productId) return;
  // SHARE also blocks product deactivation or a snapshot edit while this receipt commits.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM products WHERE id=${row.productId} AND entity_id=${entityId} FOR SHARE`,
  );
  const product = await tx.product.findFirst({
    where: { id: row.productId, entityId, isActive: true },
    select: { name: true, sku: true, barcode: true },
  });
  if (
    !product ||
    product.name !== row.productName.trim() ||
    product.sku !== (row.sku?.trim() || '') ||
    (product.barcode || null) !== (row.barcode?.trim() || null)
  )
    throw new ConflictException('產品資料已更新或不符，請重新選擇');
}

/** Old commands use free-text locations/product corrections; never retain a stale structured link. */
export function receiptLinkChanges(
  item: { productName: string; sku: string | null; custodianId: string },
  changes: Record<string, unknown>,
  action: string,
) {
  const links: { storageLocationId?: null; productId?: null; barcode?: null } =
    {};
  if (
    changes.location !== undefined ||
    (changes.custodianId !== undefined &&
      changes.custodianId !== item.custodianId) ||
    ['accept', 'accept_return', 'dispatch'].includes(action) ||
    ['COLLECTED', 'DISPATCHED'].includes(String(changes.status))
  )
    links.storageLocationId = null;
  if (
    action === 'correct' ||
    (changes.productName !== undefined &&
      changes.productName !== item.productName) ||
    (changes.sku !== undefined && changes.sku !== item.sku)
  ) {
    links.productId = null;
    links.barcode = null;
  }
  return links;
}
