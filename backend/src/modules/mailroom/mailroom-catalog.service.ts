import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailroomService } from './mailroom.service';
import { can, requireEntity } from './mailroom.contract';

// Explicit receipt picker projection: prices, costs, stock and serial identities are excluded.
export const receiptProductSelect = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  modelNumber: true,
  hasSerialNumbers: true,
} satisfies Prisma.ProductSelect;

@Injectable()
export class MailroomCatalogService {
  constructor(
    private readonly db: PrismaService,
    private readonly mailroom: MailroomService,
  ) {}

  async options(userId: string, entityId: string, search = '') {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, entityId);
    if (
      !['mailroom:read', 'mailroom:create', 'mailroom:update'].some((grant) =>
        can(actor, grant),
      )
    )
      throw new ForbiddenException('沒有收發產品查詢權限');
    if (typeof search !== 'string' || search.length > 100)
      throw new BadRequestException('搜尋內容不可超過 100 字');
    const term = search.trim();
    const base = { entityId, isActive: true };
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [
      { name: 'asc' },
      { sku: 'asc' },
      { id: 'asc' },
    ];
    const exact = term
      ? await this.db.product.findMany({
          where: {
            ...base,
            OR: ['name', 'sku', 'barcode'].map((field) => ({
              [field]: { equals: term, mode: 'insensitive' },
            })),
          },
          select: receiptProductSelect,
          orderBy,
          take: 30,
        })
      : [];
    if (exact.length === 30) return { items: exact };
    const matches = await this.db.product.findMany({
      where: {
        ...base,
        ...(term
          ? {
              OR: ['name', 'sku', 'barcode'].map((field) => ({
                [field]: { contains: term, mode: 'insensitive' },
              })),
              ...(exact.length
                ? { id: { notIn: exact.map((row) => row.id) } }
                : {}),
            }
          : {}),
      },
      select: receiptProductSelect,
      orderBy,
      take: 30 - exact.length,
    });
    return { items: [...exact, ...matches] };
  }
}
