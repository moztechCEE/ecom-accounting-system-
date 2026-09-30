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
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  B2bGuestListDto,
  B2bGuestConvertDto,
  B2bGuestMatchDto,
  B2bGuestRejectDto,
  B2bGuestSubmitDto,
} from './b2b-guest.dto';

const WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMITS = { ip: 20, email: 6, entity: 100 } as const;
const ORDER_LOOKUP_LIMIT = 60;
const ORDER_LINK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_REFERENCE = /^G-[0-9A-F]{24}$/;
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

  private async limitOrderLookup(secret: string, ip: string | undefined) {
    // Use only Express req.ip after the trusted-proxy deployment check.
    if (!ip || ip.length > 128)
      throw new ServiceUnavailableException('無法確認來源位址');
    const windowStart = new Date(
      Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS,
    );
    const keyHash = createHmac('sha256', secret)
      .update(`order-lookup-ip\0${ip}\0${windowStart.toISOString()}`)
      .digest('hex');
    const bucket = await this.db.b2bGuestRateBucket.upsert({
      where: { keyHash },
      create: { keyHash, windowStart, attempts: 1 },
      update: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    await this.cleanupExpiredRateBuckets();
    if (bucket.attempts > ORDER_LOOKUP_LIMIT)
      throw new HttpException(
        '目前查詢次數較多，請稍後再試',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private response(row: { reference: string }) {
    return {
      accepted: true,
      reference: row.reference,
      orderUrl: `/b2b/order/${row.reference}`,
    };
  }

  // Bearer-link view: valid for 30 days after submission. Rejected inquiries
  // and expired links are indistinguishable from unknown references.
  async publicOrder(reference: string, ip: string | undefined) {
    const secret = this.publicConfig();
    await this.limitOrderLookup(secret, ip);
    if (!PUBLIC_REFERENCE.test(reference))
      throw new NotFoundException('找不到採購需求');
    const cutoff = new Date(Date.now() - ORDER_LINK_LIFETIME_MS);
    const row = await this.db.b2bGuestInquiry.findFirst({
      where: {
        reference,
        status: { in: ['NEW', 'MATCHED'] },
        createdAt: { gte: cutoff },
        entity: { isActive: true },
      },
      select: {
        reference: true,
        status: true,
        createdAt: true,
        items: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            sku: true,
            name: true,
            quantity: true,
            msrp: true,
            currency: true,
            taxBasis: true,
            lineTotal: true,
          },
        },
      },
    });
    if (
      !row ||
      !['NEW', 'MATCHED'].includes(row.status) ||
      row.createdAt < cutoff
    )
      throw new NotFoundException('找不到採購需求');
    return {
      reference: row.reference,
      createdAt: row.createdAt,
      status: row.status,
      items: row.items.map((item) => ({
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
          purchaseRequest: { select: { id: true, requestNumber: true, status: true } },
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
        convertedRequestId: row.purchaseRequest?.id || null,
        convertedRequestNumber: row.purchaseRequest?.requestNumber || null,
        convertedRequestStatus: row.purchaseRequest?.status || null,
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
        purchaseRequest: { select: { id: true, requestNumber: true, status: true } },
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
      convertedRequestId: row.purchaseRequest?.id || null,
      convertedRequestNumber: row.purchaseRequest?.requestNumber || null,
      convertedRequestStatus: row.purchaseRequest?.status || null,
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

  async convert(id: string, dto: B2bGuestConvertDto, actorId: string) {
    await this.company(dto.entityId);
    if (!Array.isArray(dto.items) || dto.items.length < 1 || dto.items.length > 100)
      throw new BadRequestException('請逐項填寫未稅採購單價');
    const selected = new Map<string, { quantity: number; price: Prisma.Decimal }>();
    for (const item of dto.items) {
      if (!item || typeof item.id !== 'string' || selected.has(item.id))
        throw new BadRequestException('採購品項重複或無效');
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000)
        throw new BadRequestException('採購數量無效');
      if (typeof item.netUnitPrice !== 'number' || !Number.isFinite(item.netUnitPrice))
        throw new BadRequestException('未稅採購單價應大於零且最多兩位小數');
      const price = new Prisma.Decimal(item.netUnitPrice);
      if (!price.isFinite() || price.lt('0.01') || price.gt(100000000) ||
          price.decimalPlaces() > 2)
        throw new BadRequestException('未稅採購單價應大於零且最多兩位小數');
      selected.set(item.id, { quantity: item.quantity, price });
    }
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM b2b_guest_inquiries WHERE id=${id} AND entity_id=${dto.entityId} FOR UPDATE`;
        const guest = await tx.b2bGuestInquiry.findFirst({
          where: { id, entityId: dto.entityId },
          include: { items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
        });
        if (!guest) throw new NotFoundException('找不到採購需求');
        if (guest.status !== 'MATCHED' || !guest.matchedCustomerId ||
            !guest.matchedAt || !guest.matchedBy || !guest.matchReason)
          throw new ConflictException('須先由人員核實並配對客戶');
        const sourceItems = new Map(guest.items.map((item) => [item.id, item]));
        if (selected.size > guest.items.length ||
            [...selected].some(([itemId, chosen]) => {
              const source = sourceItems.get(itemId);
              return !source || chosen.quantity > source.quantity;
            }))
          throw new BadRequestException('品項或數量不可超過原始採購需求');

        const sourceHash = createHash('sha256').update(JSON.stringify({
          guestId: guest.id,
          payloadHash: guest.payloadHash,
          customerId: guest.matchedCustomerId,
          selectedLines: [...selected].sort(([a], [b]) => a.localeCompare(b))
            .map(([itemId, chosen]) => [itemId, chosen.quantity, chosen.price.toFixed(2)]),
        })).digest('hex');
        const existing = await tx.b2bPurchaseRequest.findUnique({
          where: { sourceGuestInquiryId: id },
          select: { id: true, requestNumber: true, sourceHash: true },
        });
        if (existing) {
          if (existing.sourceHash !== sourceHash)
            throw new ConflictException('此採購需求已轉入內部，請在正式報價中修訂價格');
          return { requestId: existing.id, requestNumber: existing.requestNumber,
            alreadyConverted: true };
        }
        const customer = await tx.customer.findFirst({
          where: { id: guest.matchedCustomerId, entityId: dto.entityId, isActive: true },
          select: { id: true },
        });
        if (!customer) throw new ConflictException('配對客戶已停用，請人工查核');
        const chosenItems = guest.items.filter((item) => selected.has(item.id));
        const productIds = chosenItems.map((item) => item.productId);
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, entityId: dto.entityId,
            isActive: true, type: ProductType.SIMPLE },
          select: { id: true },
        });
        if (products.length !== productIds.length)
          throw new ConflictException('需求中的商品已停用或不屬於此公司，請人工查核');

        // Staff prices are tax-exclusive. Guest MSRP may include tax and must
        // never be copied into a customer-specific quote or order.
        const lines = chosenItems.map((item, sortOrder) => {
          const chosen = selected.get(item.id)!;
          const unitPrice = chosen.price;
          return {
            productId: item.productId,
            sku: item.sku,
            name: item.name,
            quantity: chosen.quantity,
            unitPrice,
            lineTotal: unitPrice.mul(chosen.quantity),
            sortOrder,
          };
        });
        const subtotal = lines.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0));
        const tax = subtotal.mul('0.05').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const requestId = randomUUID();
        const request = await tx.b2bPurchaseRequest.create({
          data: {
            id: requestId,
            entityId: dto.entityId,
            customerId: customer.id,
            accountId: null,
            requestId: randomUUID(),
            sourceHash,
            sourceKind: 'GUEST',
            sourceGuestInquiryId: guest.id,
            requestNumber: `B2B-${requestId.toUpperCase()}`,
            customerPoNumber: guest.customerPoNumber,
            note: guest.note,
            currency: 'TWD',
            subtotal,
            tax,
            total: subtotal.add(tax),
            items: { create: lines },
          },
          select: { id: true, requestNumber: true },
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            tableName: 'b2b_purchase_requests',
            recordId: request.id,
            action: 'CONVERT_GUEST_INQUIRY',
            oldData: { guestInquiryId: guest.id, guestReference: guest.reference },
            newData: {
              sourceKind: 'GUEST', customerId: customer.id,
              guestInquiryId: guest.id, requestNumber: request.requestNumber,
              selectedLines: chosenItems.map((item) => ({
                guestItemId: item.id,
                quantity: selected.get(item.id)!.quantity,
                netUnitPrice: selected.get(item.id)!.price.toFixed(2),
              })),
            },
          },
        });
        return { requestId: request.id, requestNumber: request.requestNumber,
          alreadyConverted: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034')
        throw new ConflictException('採購需求剛更新，請重新載入後再試');
      throw error;
    }
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
