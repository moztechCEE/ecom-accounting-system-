import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  B2bCustomerDiscountDto,
  B2bDiscountPreviewDto,
  B2bOfferPreviewDto,
  B2bPriceBookListDto,
  B2bPutPriceBookDto,
  B2bUpsertOfferDto,
} from './b2b-pricebook.dto';

const asMoney = (amount: Prisma.Decimal) => amount.toFixed(2);
const decimal = (value: number) => new Prisma.Decimal(value);
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function instant(input: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input))
    throw new BadRequestException(`${field} 必須包含時區`);
  const date = new Date(input);
  if (Number.isNaN(date.valueOf()))
    throw new BadRequestException(`${field} 日期無效`);
  return date;
}

function window(
  start: string,
  end: string,
  startField: string,
  endField: string,
) {
  const from = instant(start, startField);
  const until = instant(end, endField);
  if (from >= until) throw new BadRequestException('結束時間必須晚於開始時間');
  return { from, until };
}

function audienceCode(input?: string | null) {
  return input?.trim().toUpperCase() || null;
}

function publicCatalogWhere(
  entityId: string,
  search?: string,
  brand?: string,
  category?: string,
): Prisma.B2bProductPriceBookWhereInput {
  return {
    entityId,
    isPublic: true,
    ...(brand ? { brand } : {}),
    product: {
      entityId,
      isActive: true,
      type: ProductType.SIMPLE,
      b2bCatalog: { some: { entityId, isPublished: true } },
      ...(category ? { category } : {}),
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
  };
}

function checkMoney(value: number, field: string) {
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 100000000 ||
    !decimal(value).mul(100).isInteger()
  )
    throw new BadRequestException(`${field} 必須是大於零的兩位小數金額`);
  return decimal(value);
}

function pricePreview(
  unitPrice: Prisma.Decimal | null,
  quantity: number,
  currency: string,
  taxBasis: string,
  priceType: string,
  reason?: string,
) {
  const selectedUnitPrice = unitPrice ? asMoney(unitPrice) : null;
  const selectedLineTotal = unitPrice ? asMoney(unitPrice.mul(quantity)) : null;
  const quoteUnitPrice =
    unitPrice && taxBasis === 'TAX_EXCLUDED' ? selectedUnitPrice : null;
  return {
    priceType,
    currency,
    taxBasis,
    quantity,
    eligible: !!unitPrice,
    unitPrice: selectedUnitPrice,
    lineTotal: selectedLineTotal,
    quoteUnitPrice,
    quoteLineTotal: quoteUnitPrice ? selectedLineTotal : null,
    reason:
      reason ||
      (unitPrice && !quoteUnitPrice ? 'tax_conversion_policy_required' : null),
  };
}

@Injectable()
export class B2bPriceBookService {
  constructor(private readonly db: PrismaService) {}

  private async company(entityId: string) {
    const entity = await this.db.entity.findFirst({
      where: { id: entityId, isActive: true },
      select: { id: true, baseCurrency: true },
    });
    if (!entity) throw new NotFoundException('公司不存在或已停用');
    if (entity.baseCurrency !== 'TWD')
      throw new BadRequestException('目前價格表僅支援台幣公司');
    return entity;
  }

  private async product(entityId: string, productId: string) {
    const product = await this.db.product.findFirst({
      where: {
        id: productId,
        entityId,
        isActive: true,
        type: ProductType.SIMPLE,
      },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('商品不存在或不適用價格表');
    return product;
  }

  private async book(entityId: string, productId: string) {
    const book = await this.db.b2bProductPriceBook.findUnique({
      where: { entityId_productId: { entityId, productId } },
      include: { offers: true },
    });
    if (!book) throw new NotFoundException('此商品尚未設定價格表');
    return book;
  }

  private audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    tableName: string,
    recordId: string,
    before: unknown,
    after: unknown,
  ) {
    return tx.auditLog.create({
      data: {
        userId: actorId,
        tableName,
        recordId,
        action: before ? 'UPDATE' : 'CREATE',
        ...(before ? { oldData: json(before) } : {}),
        newData: json(after),
      },
    });
  }

  async list(query: B2bPriceBookListDto) {
    await this.company(query.entityId);
    const limit = query.limit ? Number(query.limit) : 100;
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
    const search = query.search?.trim();
    if (search && search.length > 200)
      throw new BadRequestException('搜尋字串過長');
    const where: Prisma.B2bProductPriceBookWhereInput = {
      entityId: query.entityId,
      product: {
        entityId: query.entityId,
        ...(search
          ? {
              OR: [
                { sku: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };
    const [rows, total] = await Promise.all([
      this.db.b2bProductPriceBook.findMany({
        where,
        include: {
          product: {
            select: {
              sku: true,
              name: true,
              isActive: true,
              b2bCatalog: {
                where: { entityId: query.entityId },
                select: { isPublished: true },
                take: 1,
              },
            },
          },
          offers: { orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] },
        },
        orderBy: [{ product: { sku: 'asc' } }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.db.b2bProductPriceBook.count({ where }),
    ]);
    return {
      rows: rows.map((row) => ({
        productId: row.productId,
        sku: row.product.sku,
        name: row.product.name,
        brand: row.brand,
        productIsActive: row.product.isActive,
        isPublished: row.product.b2bCatalog[0]?.isPublished || false,
        isPublic: row.isPublic,
        msrp: asMoney(row.msrp),
        regularPrice: row.regularPrice ? asMoney(row.regularPrice) : null,
        groupBuyPrice: row.groupBuyPrice ? asMoney(row.groupBuyPrice) : null,
        currency: row.currency,
        taxBasis: row.taxBasis,
        updatedAt: row.updatedAt,
        offers: row.offers.map((offer) => ({
          id: offer.id,
          unitPrice: asMoney(offer.unitPrice),
          startsAt: offer.startsAt,
          endsAt: offer.endsAt,
          audience: offer.audience,
          audienceCode: offer.audienceCode,
          isActive: offer.isActive,
          updatedAt: offer.updatedAt,
        })),
      })),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }

  async brands(entityId: string) {
    await this.company(entityId);
    const rows = await this.db.b2bProductPriceBook.findMany({
      where: { entityId, brand: { not: null } },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    });
    return {
      brands: rows
        .map((row) => row.brand)
        .filter((value): value is string => Boolean(value?.trim())),
    };
  }

  async putBook(productId: string, dto: B2bPutPriceBookDto, actorId: string) {
    await this.company(dto.entityId);
    await this.product(dto.entityId, productId);
    if (
      dto.currency !== 'TWD' ||
      !['TAX_INCLUDED', 'TAX_EXCLUDED'].includes(dto.taxBasis)
    )
      throw new BadRequestException('幣別或稅別不支援');
    if (typeof dto.isPublic !== 'boolean')
      throw new BadRequestException('請明確設定是否公開建議售價');
    const msrp = checkMoney(dto.msrp, '建議售價');
    const regularPrice =
      dto.regularPrice == null
        ? null
        : checkMoney(dto.regularPrice, '常態售價');
    const groupBuyPrice =
      dto.groupBuyPrice == null
        ? null
        : checkMoney(dto.groupBuyPrice, '團購主進貨價');
    const brand = dto.brand?.trim() || null;
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM products WHERE id=${productId} AND entity_id=${dto.entityId} FOR UPDATE`;
      const before = await tx.b2bProductPriceBook.findUnique({
        where: { entityId_productId: { entityId: dto.entityId, productId } },
      });
      const saved = await tx.b2bProductPriceBook.upsert({
        where: { entityId_productId: { entityId: dto.entityId, productId } },
        create: {
          entityId: dto.entityId,
          productId,
          brand,
          msrp,
          regularPrice,
          groupBuyPrice,
          isPublic: dto.isPublic,
          currency: dto.currency,
          taxBasis: dto.taxBasis,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          ...(dto.brand !== undefined ? { brand } : {}),
          msrp,
          regularPrice,
          groupBuyPrice,
          isPublic: dto.isPublic,
          currency: dto.currency,
          taxBasis: dto.taxBasis,
          updatedBy: actorId,
        },
      });
      await this.audit(
        tx,
        actorId,
        'b2b_product_price_books',
        saved.id,
        before,
        saved,
      );
      return saved;
    });
    return {
      productId: result.productId,
      brand: result.brand,
      msrp: asMoney(result.msrp),
      regularPrice: result.regularPrice ? asMoney(result.regularPrice) : null,
      groupBuyPrice: result.groupBuyPrice
        ? asMoney(result.groupBuyPrice)
        : null,
      isPublic: result.isPublic,
      currency: result.currency,
      taxBasis: result.taxBasis,
      updatedAt: result.updatedAt,
    };
  }

  private offerData(dto: B2bUpsertOfferDto) {
    const { from, until } = window(
      dto.startsAt,
      dto.endsAt,
      'startsAt',
      'endsAt',
    );
    const code = audienceCode(dto.audienceCode);
    if (!['ALL', 'CODE'].includes(dto.audience))
      throw new BadRequestException('活動適用對象無效');
    if ((dto.audience === 'CODE' && !code) || (dto.audience === 'ALL' && code))
      throw new BadRequestException('活動代碼與適用對象不一致');
    return {
      unitPrice: checkMoney(dto.unitPrice, '活動價格'),
      startsAt: from,
      endsAt: until,
      audience: dto.audience,
      audienceCode: code,
      isActive: dto.isActive ?? true,
    };
  }

  async createOffer(
    productId: string,
    dto: B2bUpsertOfferDto,
    actorId: string,
  ) {
    await this.company(dto.entityId);
    await this.product(dto.entityId, productId);
    const data = this.offerData(dto);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM products WHERE id=${productId} AND entity_id=${dto.entityId} FOR UPDATE`;
      const book = await tx.b2bProductPriceBook.findUnique({
        where: { entityId_productId: { entityId: dto.entityId, productId } },
      });
      if (!book) throw new NotFoundException('請先設定商品牌價');
      const offer = await tx.b2bPriceOffer.create({
        data: {
          ...data,
          priceBookId: book.id,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      await this.audit(tx, actorId, 'b2b_price_offers', offer.id, null, offer);
      return offer;
    });
  }

  async updateOffer(
    productId: string,
    offerId: string,
    dto: B2bUpsertOfferDto,
    actorId: string,
  ) {
    await this.company(dto.entityId);
    await this.product(dto.entityId, productId);
    const data = this.offerData(dto);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM products WHERE id=${productId} AND entity_id=${dto.entityId} FOR UPDATE`;
      const book = await tx.b2bProductPriceBook.findUnique({
        where: { entityId_productId: { entityId: dto.entityId, productId } },
      });
      if (!book) throw new NotFoundException('此商品尚未設定價格表');
      const before = await tx.b2bPriceOffer.findFirst({
        where: { id: offerId, priceBookId: book.id },
      });
      if (!before) throw new NotFoundException('找不到此商品的活動');
      const saved = await tx.b2bPriceOffer.update({
        where: { id: offerId },
        data: { ...data, updatedBy: actorId },
      });
      await this.audit(
        tx,
        actorId,
        'b2b_price_offers',
        saved.id,
        before,
        saved,
      );
      return saved;
    });
  }

  async preview(productId: string, dto: B2bOfferPreviewDto) {
    await this.company(dto.entityId);
    await this.product(dto.entityId, productId);
    const book = await this.book(dto.entityId, productId);
    if (
      !Number.isInteger(dto.quantity) ||
      dto.quantity < 1 ||
      dto.quantity > 100000
    )
      throw new BadRequestException('數量無效');
    const at = dto.at ? instant(dto.at, 'at') : new Date();
    if (dto.priceType === 'MSRP')
      return pricePreview(
        book.msrp,
        dto.quantity,
        book.currency,
        book.taxBasis,
        'MSRP',
      );
    if (dto.priceType === 'REGULAR')
      return pricePreview(
        book.regularPrice,
        dto.quantity,
        book.currency,
        book.taxBasis,
        'REGULAR',
        book.regularPrice ? undefined : 'regular_price_not_set',
      );
    if (dto.priceType === 'GROUP_BUY') {
      const reference = pricePreview(
        book.groupBuyPrice,
        dto.quantity,
        book.currency,
        book.taxBasis,
        'GROUP_BUY',
      );
      return {
        ...reference,
        eligible: false,
        quoteUnitPrice: null,
        quoteLineTotal: null,
        reason: book.groupBuyPrice
          ? 'organizer_classification_required'
          : 'group_buy_price_not_set',
      };
    }
    if (dto.priceType !== 'CAMPAIGN' || !dto.offerId)
      throw new BadRequestException('活動試算必須指定 offerId');
    const offer = book.offers.find((row) => row.id === dto.offerId);
    if (!offer) throw new NotFoundException('找不到此商品的活動');
    const reason = !offer.isActive
      ? 'offer_disabled'
      : at < offer.startsAt || at >= offer.endsAt
        ? 'offer_outside_validity'
        : offer.audience === 'CODE' &&
            audienceCode(dto.audienceCode) !== offer.audienceCode
          ? 'audience_code_not_eligible'
          : null;
    return {
      ...pricePreview(
        reason ? null : offer.unitPrice,
        dto.quantity,
        book.currency,
        book.taxBasis,
        'CAMPAIGN',
        reason || undefined,
      ),
      offerId: offer.id,
    };
  }

  async publicCatalog(
    entityId: string,
    limit = 100,
    offset = 0,
    search?: string,
    brand?: string,
    category?: string,
  ) {
    if (process.env.B2B_PUBLIC_CATALOG_ENABLED !== 'true')
      throw new ServiceUnavailableException('公開商品頁尚未啟用');
    await this.company(entityId);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 999999
    )
      throw new BadRequestException('分頁參數無效');
    const term = search?.trim();
    if (term && term.length > 200)
      throw new BadRequestException('搜尋字串過長');
    const brandFilter = brand?.trim();
    if (brandFilter && brandFilter.length > 100)
      throw new BadRequestException('品牌名稱過長');
    const where = publicCatalogWhere(entityId, term, brandFilter, category);
    const [rows, total] = await Promise.all([
      this.db.b2bProductPriceBook.findMany({
        where,
        select: {
          productId: true,
          brand: true,
          msrp: true,
          currency: true,
          taxBasis: true,
          product: {
            select: {
              sku: true,
              name: true,
              category: true,
            },
          },
        },
        orderBy: [{ product: { sku: 'asc' } }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.db.b2bProductPriceBook.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        productId: row.productId,
        sku: row.product.sku,
        name: row.product.name,
        brand: row.brand,
        category: row.product.category,
        msrp: asMoney(row.msrp),
        currency: row.currency,
        taxBasis: row.taxBasis,
      })),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }

  async publicCatalogFacets(entityId: string) {
    if (process.env.B2B_PUBLIC_CATALOG_ENABLED !== 'true')
      throw new ServiceUnavailableException('公開商品頁尚未啟用');
    await this.company(entityId);
    const rows = await this.db.b2bProductPriceBook.findMany({
      where: publicCatalogWhere(entityId),
      select: {
        brand: true,
        product: { select: { category: true } },
      },
    });
    return {
      brands: [
        ...new Set(
          rows
            .map((row) => row.brand)
            .filter((value): value is string => Boolean(value?.trim())),
        ),
      ].sort((a, b) => a.localeCompare(b)),
      categories: [
        ...new Set(
          rows
            .map((row) => row.product.category)
            .filter((value): value is string => Boolean(value?.trim())),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    };
  }

  async discountRules(query: B2bPriceBookListDto) {
    await this.company(query.entityId);
    const limit = query.limit ? Number(query.limit) : 100;
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
    const search = query.search?.trim();
    if (search && search.length > 200)
      throw new BadRequestException('搜尋字串過長');
    const where: Prisma.B2bCustomerDiscountRuleWhereInput = {
      entityId: query.entityId,
      customer: {
        entityId: query.entityId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };
    const [rows, total] = await Promise.all([
      this.db.b2bCustomerDiscountRule.findMany({
        where,
        include: { customer: { select: { name: true, isActive: true } } },
        orderBy: [{ customer: { name: 'asc' } }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.db.b2bCustomerDiscountRule.count({ where }),
    ]);
    return {
      rows: rows.map((row) => ({
        id: row.id,
        customerId: row.customerId,
        customerName: row.customer.name,
        customerIsActive: row.customer.isActive,
        multiplier: row.multiplier.toString(),
        basePriceType: row.basePriceType,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        isActive: row.isActive,
        updatedAt: row.updatedAt,
      })),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }

  async putDiscountRule(
    customerId: string,
    dto: B2bCustomerDiscountDto,
    actorId: string,
  ) {
    await this.company(dto.entityId);
    const customer = await this.db.customer.findFirst({
      where: { id: customerId, entityId: dto.entityId, isActive: true },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('客戶不存在或已停用');
    if (
      !Number.isFinite(dto.multiplier) ||
      dto.multiplier <= 0 ||
      dto.multiplier > 1 ||
      !decimal(dto.multiplier).mul(10000).isInteger()
    )
      throw new BadRequestException('折數倍率必須介於 0 與 1，最多四位小數');
    if (!['MSRP', 'REGULAR'].includes(dto.basePriceType))
      throw new BadRequestException('折數基準價無效');
    const validFrom = instant(dto.validFrom, 'validFrom');
    const validUntil = dto.validUntil
      ? instant(dto.validUntil, 'validUntil')
      : null;
    if (validUntil && validUntil <= validFrom)
      throw new BadRequestException('有效結束時間必須晚於開始時間');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customers WHERE id=${customerId} AND entity_id=${dto.entityId} FOR UPDATE`;
      const before = await tx.b2bCustomerDiscountRule.findUnique({
        where: { entityId_customerId: { entityId: dto.entityId, customerId } },
      });
      const saved = await tx.b2bCustomerDiscountRule.upsert({
        where: { entityId_customerId: { entityId: dto.entityId, customerId } },
        create: {
          entityId: dto.entityId,
          customerId,
          multiplier: decimal(dto.multiplier),
          basePriceType: dto.basePriceType,
          validFrom,
          validUntil,
          isActive: dto.isActive,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          multiplier: decimal(dto.multiplier),
          basePriceType: dto.basePriceType,
          validFrom,
          validUntil,
          isActive: dto.isActive,
          updatedBy: actorId,
        },
      });
      await this.audit(
        tx,
        actorId,
        'b2b_customer_discount_rules',
        saved.id,
        before,
        saved,
      );
      return {
        id: saved.id,
        customerId: saved.customerId,
        multiplier: saved.multiplier.toString(),
        basePriceType: saved.basePriceType,
        validFrom: saved.validFrom,
        validUntil: saved.validUntil,
        isActive: saved.isActive,
        updatedAt: saved.updatedAt,
      };
    });
  }

  async previewDiscount(customerId: string, dto: B2bDiscountPreviewDto) {
    await this.company(dto.entityId);
    const customer = await this.db.customer.findFirst({
      where: { id: customerId, entityId: dto.entityId, isActive: true },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('客戶不存在或已停用');
    if (
      !Array.isArray(dto.items) ||
      !dto.items.length ||
      dto.items.length > 100 ||
      dto.items.some(
        (item) =>
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 100000,
      )
    )
      throw new BadRequestException('試算品項或數量無效');
    const at = dto.at ? instant(dto.at, 'at') : new Date();
    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const [products, rule, books, fixedPrices] = await Promise.all([
      this.db.product.findMany({
        where: {
          id: { in: productIds },
          entityId: dto.entityId,
          isActive: true,
          type: ProductType.SIMPLE,
        },
        select: { id: true },
      }),
      this.db.b2bCustomerDiscountRule.findUnique({
        where: { entityId_customerId: { entityId: dto.entityId, customerId } },
      }),
      this.db.b2bProductPriceBook.findMany({
        where: { entityId: dto.entityId, productId: { in: productIds } },
      }),
      this.db.b2bCustomerPrice.findMany({
        where: {
          entityId: dto.entityId,
          customerId,
          productId: { in: productIds },
          isActive: true,
          OR: [{ validUntil: null }, { validUntil: { gt: at } }],
        },
      }),
    ]);
    const available = new Set(products.map((row) => row.id));
    const bookByProduct = new Map(books.map((row) => [row.productId, row]));
    const fixedByProduct = new Map(
      fixedPrices.map((row) => [row.productId, row]),
    );
    const ruleActive =
      !!rule &&
      rule.isActive &&
      rule.validFrom <= at &&
      (!rule.validUntil || at < rule.validUntil);
    const items = dto.items.map((item) => {
      const empty = (reason: string) => ({
        productId: item.productId,
        quantity: item.quantity,
        source: null,
        basePriceType: null,
        baseUnitPrice: null,
        multiplier: null,
        selectedUnitPrice: null,
        selectedLineTotal: null,
        taxBasis: null,
        quoteUnitPrice: null,
        quoteLineTotal: null,
        eligible: false,
        reason,
      });
      if (!available.has(item.productId)) return empty('product_unavailable');
      const fixed = fixedByProduct.get(item.productId);
      if (fixed) {
        const price = fixed.unitPrice;
        return {
          productId: item.productId,
          quantity: item.quantity,
          source: 'FIXED_OVERRIDE',
          basePriceType: null,
          baseUnitPrice: null,
          multiplier: null,
          selectedUnitPrice: asMoney(price),
          selectedLineTotal: asMoney(price.mul(item.quantity)),
          taxBasis: 'TAX_EXCLUDED',
          quoteUnitPrice: asMoney(price),
          quoteLineTotal: asMoney(price.mul(item.quantity)),
          eligible: true,
          reason: null,
        };
      }
      if (!ruleActive || !rule) return empty('customer_rule_not_active');
      const book = bookByProduct.get(item.productId);
      if (!book) return empty('price_book_not_set');
      const base =
        rule.basePriceType === 'MSRP' ? book.msrp : book.regularPrice;
      if (!base) return empty('base_price_not_set');
      const price = base
        .mul(rule.multiplier)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const quotePrice = book.taxBasis === 'TAX_EXCLUDED' ? price : null;
      return {
        productId: item.productId,
        quantity: item.quantity,
        source: 'CUSTOMER_DISCOUNT',
        basePriceType: rule.basePriceType,
        baseUnitPrice: asMoney(base),
        multiplier: rule.multiplier.toString(),
        selectedUnitPrice: asMoney(price),
        selectedLineTotal: asMoney(price.mul(item.quantity)),
        taxBasis: book.taxBasis,
        quoteUnitPrice: quotePrice ? asMoney(quotePrice) : null,
        quoteLineTotal: quotePrice
          ? asMoney(quotePrice.mul(item.quantity))
          : null,
        eligible: !!quotePrice,
        reason: quotePrice ? null : 'tax_conversion_policy_required',
      };
    });
    return {
      currency: 'TWD',
      allEligible: items.every((item) => item.eligible),
      items,
    };
  }
}
