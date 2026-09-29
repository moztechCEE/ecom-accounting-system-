import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  B2bGuestListDto,
  B2bGuestMatchDto,
  B2bGuestRejectDto,
  B2bGuestSubmitDto,
} from './b2b-guest.dto';

const WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMITS = { ip: 20, email: 6, entity: 100 } as const;
const money = (amount: Prisma.Decimal) => amount.toFixed(2);

function clean(value: string | undefined) {
  return value?.trim() || null;
}

function rejectUnsafeText(value: string | null, field: string) {
  if (
    value &&
    [...value].some((character) => {
      const code = character.codePointAt(0) || 0;
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    throw new BadRequestException(`${field} 包含無效字元`);
}

@Injectable()
export class B2bGuestService {
  private readonly logger = new Logger(B2bGuestService.name);
  private lastRateCleanupAt = 0;
  constructor(private readonly db: PrismaService) {}

  private async cleanupExpiredRateBuckets() {
    const now = Date.now();
    if (now - this.lastRateCleanupAt < 60 * 60 * 1000) return;
    this.lastRateCleanupAt = now;
    const cutoff = new Date(now - 24 * 60 * 60 * 1000);
    try {
      await this.db.$executeRaw`
        DELETE FROM b2b_guest_rate_buckets
        WHERE key_hash IN (
          SELECT key_hash FROM b2b_guest_rate_buckets
          WHERE window_start < ${cutoff}
          ORDER BY window_start ASC LIMIT 5000
        )`;
    } catch {
      this.logger.warn('B2B guest rate-bucket cleanup failed');
    }
  }

  private publicConfig() {
    if (
      process.env.B2B_PUBLIC_ORDER_ENABLED !== 'true' ||
      process.env.B2B_PUBLIC_CATALOG_ENABLED !== 'true'
    )
      throw new ServiceUnavailableException('公開採購需求入口尚未啟用');
    const secret = process.env.B2B_PUBLIC_ORDER_RATE_SECRET;
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException('公開採購需求防濫用設定未完成');
    return secret;
  }

  private async company(entityId: string) {
    const company = await this.db.entity.findFirst({
      where: { id: entityId, isActive: true },
      select: { id: true, baseCurrency: true },
    });
    if (!company) throw new NotFoundException('公司不存在或已停用');
    if (company.baseCurrency !== 'TWD')
      throw new BadRequestException('目前採購需求僅支援台幣公司');
    return company;
  }

  private normalize(dto: B2bGuestSubmitDto) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        dto.requestId,
      )
    )
      throw new BadRequestException('requestId 必須是 UUID v4');
    const companyName = clean(dto.companyName);
    const contactName = clean(dto.contactName);
    const contactEmail = clean(dto.contactEmail)?.toLowerCase();
    const contactPhone = clean(dto.contactPhone);
    const customerPoNumber = clean(dto.customerPoNumber);
    const note = clean(dto.note);
    if (
      !companyName ||
      companyName.length > 120 ||
      !contactName ||
      contactName.length > 100 ||
      !contactEmail ||
      contactEmail.length > 254 ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail) ||
      (contactPhone && contactPhone.length > 50) ||
      (customerPoNumber && customerPoNumber.length > 100) ||
      (note && note.length > 2000)
    )
      throw new BadRequestException('聯絡資訊不完整或過長');
    for (const [field, value] of Object.entries({
      companyName,
      contactName,
      contactEmail,
      contactPhone,
      customerPoNumber,
      note,
    }))
      rejectUnsafeText(value, field);
    if (
      !Array.isArray(dto.items) ||
      dto.items.length < 1 ||
      dto.items.length > 100
    )
      throw new BadRequestException('採購品項數量無效');
    const items = dto.items.map((item) => {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          item.productId,
        ) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 1000
      )
        throw new BadRequestException('採購品項或數量無效');
      return { productId: item.productId, quantity: item.quantity };
    });
    if (new Set(items.map((item) => item.productId)).size !== items.length)
      throw new BadRequestException('同一商品不可重複列入');
    const canonical = {
      entityId: dto.entityId,
      requestId: dto.requestId,
      companyName,
      contactName,
      contactEmail,
      contactPhone,
      customerPoNumber,
      note,
      items: [...items].sort((a, b) => a.productId.localeCompare(b.productId)),
    };
    return {
      ...canonical,
      payloadHash: createHash('sha256')
        .update(JSON.stringify(canonical))
        .digest('hex'),
    };
  }

  private async limitAttempt(
    secret: string,
    ip: string | undefined,
    email: string,
    entityId: string,
  ) {
    // Express req.ip must be populated by a deployment-verified trusted proxy.
    // Never parse caller-supplied X-Forwarded-For here.
    if (!ip || ip.length > 128)
      throw new ServiceUnavailableException('無法確認來源位址');
    const windowStart = new Date(
      Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS,
    );
    // Check the IP bucket first so one denied source cannot exhaust the
    // shared entity quota. Later dimensions must not create fresh rows for
    // traffic that is already rejected.
    const dimensions = [
      ['ip', ip, RATE_LIMITS.ip],
      ['entity', entityId, RATE_LIMITS.entity],
      ['email', email, RATE_LIMITS.email],
    ] as const;
    const limited = await this.db.$transaction(async (tx) => {
      for (const [kind, value, limit] of dimensions) {
        const keyHash = createHmac('sha256', secret)
          .update(`${kind}\0${value}\0${windowStart.toISOString()}`)
          .digest('hex');
        const bucket = await tx.b2bGuestRateBucket.upsert({
          where: { keyHash },
          create: { keyHash, windowStart, attempts: 1 },
          update: { attempts: { increment: 1 } },
          select: { attempts: true },
        });
        if (bucket.attempts > limit) return true;
      }
      return false;
    });
    await this.cleanupExpiredRateBuckets();
    // Check after committing increments so rejected attempts also count.
    if (limited)
      throw new HttpException(
        '目前提交次數較多，請稍後再試',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private response(row: { reference: string }) {
    return { accepted: true, reference: row.reference };
  }

  async submit(dto: B2bGuestSubmitDto, ip: string | undefined) {
    const secret = this.publicConfig();
    const input = this.normalize(dto);
    await this.limitAttempt(secret, ip, input.contactEmail, input.entityId);
    await this.company(input.entityId);
    const key = { entityId: input.entityId, requestId: input.requestId };
    const existing = await this.db.b2bGuestInquiry.findUnique({
      where: { entityId_requestId: key },
      select: { payloadHash: true, reference: true },
    });
    if (existing) {
      if (existing.payloadHash !== input.payloadHash)
        throw new ConflictException('此提交識別碼已用於其他內容');
      return this.response(existing);
    }

    try {
      const created = await this.db.$transaction(
        async (tx) => {
          const productIds = input.items.map((item) => item.productId);
          const books = await tx.b2bProductPriceBook.findMany({
            where: {
              entityId: input.entityId,
              isPublic: true,
              productId: { in: productIds },
              product: {
                entityId: input.entityId,
                isActive: true,
                type: ProductType.SIMPLE,
                b2bCatalog: {
                  some: { entityId: input.entityId, isPublished: true },
                },
              },
            },
            select: {
              productId: true,
              msrp: true,
              currency: true,
              taxBasis: true,
              product: { select: { sku: true, name: true } },
            },
          });
          if (books.length !== productIds.length)
            throw new BadRequestException(
              '部分商品尚未公開上架，請重新整理商品頁',
            );
          const bookByProduct = new Map(
            books.map((book) => [book.productId, book]),
          );
          const snapshots = input.items.map((item, sortOrder) => {
            const book = bookByProduct.get(item.productId)!;
            return {
              productId: item.productId,
              sku: book.product.sku,
              name: book.product.name,
              quantity: item.quantity,
              msrp: book.msrp,
              currency: book.currency,
              taxBasis: book.taxBasis,
              lineTotal: book.msrp.mul(item.quantity),
              sortOrder,
            };
          });
          return tx.b2bGuestInquiry.create({
            data: {
              entityId: input.entityId,
              requestId: input.requestId,
              payloadHash: input.payloadHash,
              reference: `G-${randomBytes(12).toString('hex').toUpperCase()}`,
              companyName: input.companyName,
              contactName: input.contactName,
              contactEmail: input.contactEmail,
              contactPhone: input.contactPhone,
              customerPoNumber: input.customerPoNumber,
              note: input.note,
              items: { create: snapshots },
            },
            select: { reference: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.response(created);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2002' && code !== 'P2034') throw error;
      const raced = await this.db.b2bGuestInquiry.findUnique({
        where: { entityId_requestId: key },
        select: { payloadHash: true, reference: true },
      });
      if (raced && raced.payloadHash === input.payloadHash)
        return this.response(raced);
      if (code === 'P2034')
        throw new ConflictException('商品資訊剛更新，請重試提交');
      throw new ConflictException('此提交識別碼已用於其他內容，請重新提交');
    }
  }

  async list(query: B2bGuestListDto) {
    await this.company(query.entityId);
    const limit = query.limit ? Number(query.limit) : 50;
    const offset = query.offset ? Number(query.offset) : 0;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 999999
    )
      throw new BadRequestException('分頁參數無效');
    if (query.status && !['NEW', 'MATCHED', 'REJECTED'].includes(query.status))
      throw new BadRequestException('狀態無效');
    const search = query.search?.trim();
    if (search && search.length > 200)
      throw new BadRequestException('搜尋字串過長');
    const where: Prisma.B2bGuestInquiryWhereInput = {
      entityId: query.entityId,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' } },
              { companyName: { contains: search, mode: 'insensitive' } },
              { contactName: { contains: search, mode: 'insensitive' } },
              { contactEmail: { contains: search, mode: 'insensitive' } },
              { customerPoNumber: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.b2bGuestInquiry.findMany({
        where,
        select: {
          id: true,
          reference: true,
          status: true,
          companyName: true,
          contactName: true,
          contactEmail: true,
          customerPoNumber: true,
          createdAt: true,
          matchedCustomerId: true,
          matchedCustomer: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.db.b2bGuestInquiry.count({ where }),
    ]);
    return {
      rows: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        companyName: row.companyName,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        customerPoNumber: row.customerPoNumber,
        itemCount: row._count.items,
        createdAt: row.createdAt,
        matchedCustomerId: row.matchedCustomerId,
        matchedCustomerName: row.matchedCustomer?.name || null,
      })),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }

  async detail(entityId: string, id: string) {
    await this.company(entityId);
    const row = await this.db.b2bGuestInquiry.findFirst({
      where: { id, entityId },
      include: {
        matchedCustomer: { select: { name: true } },
        items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!row) throw new NotFoundException('找不到採購需求');
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      companyName: row.companyName,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      customerPoNumber: row.customerPoNumber,
      note: row.note,
      createdAt: row.createdAt,
      matchedCustomerId: row.matchedCustomerId,
      matchedCustomerName: row.matchedCustomer?.name || null,
      matchedAt: row.matchedAt,
      matchedBy: row.matchedBy,
      matchReason: row.matchReason,
      rejectedAt: row.rejectedAt,
      rejectedBy: row.rejectedBy,
      rejectionReason: row.rejectionReason,
      items: row.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        msrp: money(item.msrp),
        currency: item.currency,
        taxBasis: item.taxBasis,
        lineTotal: money(item.lineTotal),
      })),
    };
  }

  async match(id: string, dto: B2bGuestMatchDto, actorId: string) {
    await this.company(dto.entityId);
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 10 || reason.length > 1000)
      throw new BadRequestException('請記錄至少十字的客戶核實依據');
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM b2b_guest_inquiries WHERE id=${id} AND entity_id=${dto.entityId} FOR UPDATE`;
      const [before, customer] = await Promise.all([
        tx.b2bGuestInquiry.findFirst({ where: { id, entityId: dto.entityId } }),
        tx.customer.findFirst({
          where: { id: dto.customerId, entityId: dto.entityId, isActive: true },
          select: { id: true },
        }),
      ]);
      if (!before) throw new NotFoundException('找不到採購需求');
      if (before.status !== 'NEW')
        throw new ConflictException('此需求已完成處理；更正需另行審核');
      if (!customer) throw new NotFoundException('客戶不存在或已停用');
      const matchedAt = new Date();
      const saved = await tx.b2bGuestInquiry.update({
        where: { id },
        data: {
          status: 'MATCHED',
          matchedCustomerId: customer.id,
          matchedAt,
          matchedBy: actorId,
          matchReason: reason,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          tableName: 'b2b_guest_inquiries',
          recordId: id,
          action: 'MATCH_CUSTOMER',
          oldData: {
            status: before.status,
            matchedCustomerId: before.matchedCustomerId,
            matchedAt: before.matchedAt?.toISOString() || null,
            matchedBy: before.matchedBy,
            matchReason: before.matchReason,
          },
          newData: {
            status: saved.status,
            matchedCustomerId: saved.matchedCustomerId,
            matchedAt: saved.matchedAt?.toISOString() || null,
            matchedBy: saved.matchedBy,
            matchReason: saved.matchReason,
          },
        },
      });
    });
    return this.detail(dto.entityId, id);
  }

  async reject(id: string, dto: B2bGuestRejectDto, actorId: string) {
    await this.company(dto.entityId);
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 10 || reason.length > 1000)
      throw new BadRequestException('請記錄至少十字的駁回原因');
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM b2b_guest_inquiries WHERE id=${id} AND entity_id=${dto.entityId} FOR UPDATE`;
      const before = await tx.b2bGuestInquiry.findFirst({
        where: { id, entityId: dto.entityId },
      });
      if (!before) throw new NotFoundException('找不到採購需求');
      if (before.status !== 'NEW')
        throw new ConflictException('此需求已完成處理');
      const rejectedAt = new Date();
      const saved = await tx.b2bGuestInquiry.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedAt,
          rejectedBy: actorId,
          rejectionReason: reason,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          tableName: 'b2b_guest_inquiries',
          recordId: id,
          action: 'REJECT',
          oldData: {
            status: before.status,
            rejectedAt: before.rejectedAt?.toISOString() || null,
            rejectedBy: before.rejectedBy,
            rejectionReason: before.rejectionReason,
          },
          newData: {
            status: saved.status,
            rejectedAt: saved.rejectedAt?.toISOString() || null,
            rejectedBy: saved.rejectedBy,
            rejectionReason: saved.rejectionReason,
          },
        },
      });
    });
    return this.detail(dto.entityId, id);
  }
}
