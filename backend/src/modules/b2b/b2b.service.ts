import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SalesOrderService } from '../sales/services/sales-order.service';
import {
  B2bAccountDto,
  B2bAccountUpdateDto,
  B2bCatalogDto,
  B2bConfirmDto,
  B2bLoginDto,
  B2bPriceDto,
  B2bRequestDto,
  B2bReviewDto,
  B2bSupplierAccountDto,
} from './b2b.dto';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const emailKey = (value: string) => value.trim().toLowerCase();
// The workbench's date input means "through this calendar day" in Taiwan.
// Persist the next Taipei midnight as an exclusive UTC cutoff; catalog uses > now.
function priceValidUntil(value?: string): Date | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const cutoff = new Date(dateOnly ? `${value}T16:00:00.000Z` : value);
  if (!Number.isFinite(cutoff.getTime()) ||
      (dateOnly && cutoff.toISOString().slice(0, 10) !== value)) {
    throw new BadRequestException('客戶專屬價有效期限不是有效日期');
  }
  return cutoff;
}
const accountSelect = {
  id: true,
  accountType: true,
  vendorId: true,
  customerId: true,
  email: true,
  name: true,
  isActive: true,
} as const;
const includeRequest = {
  items: { orderBy: { sortOrder: 'asc' as const } },
  customer: { select: { name: true, companyName: true } },
} as const;
// Fixed dummy hash ensures absent accounts still perform the same bcrypt work.
const dummyHash =
  '$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
export type B2bIdentity = {
  id: string;
  entityId: string;
  customerId: string;
  name: string;
  customerName: string;
  companyName: string;
  tokenHash: string;
};

type RequestRecord = Prisma.B2bPurchaseRequestGetPayload<{
  include: typeof includeRequest;
}>;
export function publicRequest(row: RequestRecord) {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    customerPoNumber: row.customerPoNumber,
    status: row.status,
    salesOrderId: row.salesOrderId,
    currency: row.currency,
    subtotal: row.subtotal.toFixed(2),
    tax: row.tax.toFixed(2),
    total: row.total.toFixed(2),
    note: row.note,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
    deliveryDate: row.deliveryDate,
    quotePath: `/b2b/requests/${row.id}`,
    items: row.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      confirmedQuantity: i.confirmedQuantity,
      unitPrice: i.unitPrice.toFixed(2),
      lineTotal: i.lineTotal.toFixed(2),
    })),
  };
}
export function requestSourceHash(dto: B2bRequestDto) {
  return sha256(
    JSON.stringify({
      customerPoNumber: dto.customerPoNumber.trim(),
      note: dto.note?.trim() || null,
      items: [...dto.items]
        .sort((a, b) => a.productId.localeCompare(b.productId))
        .map((i) => ({ productId: i.productId, quantity: i.quantity })),
    }),
  );
}

@Injectable()
export class B2bService {
  constructor(private readonly db: PrismaService, private readonly salesOrders: SalesOrderService) {}
  ensureEnabled() {
    if (process.env.B2B_PORTAL_ENABLED !== 'true')
      throw new ServiceUnavailableException('客戶採購入口尚未啟用');
  }
  private async company(
    entityId: string,
    db: Prisma.TransactionClient | PrismaService = this.db,
  ) {
    const entity = await db.entity.findFirst({
      where: { id: entityId, isActive: true },
    });
    if (!entity) throw new NotFoundException('公司不存在或已停用');
    if (entity.baseCurrency !== 'TWD')
      throw new BadRequestException('第一版客戶採購入口僅支援台幣公司');
    return entity;
  }
  private async customer(
    entityId: string,
    customerId: string,
    db: Prisma.TransactionClient | PrismaService = this.db,
  ) {
    const row = await db.customer.findFirst({
      where: { id: customerId, entityId, isActive: true },
    });
    if (!row) throw new NotFoundException('客戶不存在或已停用');
    return row;
  }
  private async product(
    entityId: string,
    productId: string,
    db: Prisma.TransactionClient | PrismaService = this.db,
  ) {
    const row = await db.product.findFirst({
      where: { id: productId, entityId, isActive: true },
    });
    if (!row) throw new NotFoundException('商品不存在或已停用');
    return row;
  }
  private password(value: string) {
    if (value.length < 12 || Buffer.byteLength(value, 'utf8') > 72)
      throw new BadRequestException('密碼至少 12 字元，且不可超過 72 bytes');
    return bcrypt.hash(value, 12);
  }
  async setup(entityId: string) {
    const entity = await this.company(entityId);
    const [customers, products, accounts, catalog, prices, vendors, channels, warehouses] =
      await Promise.all([
        this.db.customer.findMany({
          where: { entityId, isActive: true },
          select: { id: true, code: true, name: true, companyName: true },
          orderBy: { name: 'asc' },
          take: 1000,
        }),
        this.db.product.findMany({
          where: { entityId, isActive: true },
          select: { id: true, sku: true, name: true },
          orderBy: { sku: 'asc' },
          take: 1000,
        }),
        this.db.b2bAccount.findMany({
          where: { entityId },
          select: accountSelect,
          orderBy: { name: 'asc' },
          take: 1000,
        }),
        this.db.b2bCatalogItem.findMany({
          where: { entityId },
          select: { productId: true, unitPrice: true, isPublished: true },
          take: 1000,
        }),
        this.db.b2bCustomerPrice.findMany({
          where: { entityId },
          select: {
            customerId: true,
            productId: true,
            unitPrice: true,
            isActive: true,
            validUntil: true,
          },
          take: 1000,
        }),
        this.db.vendor.findMany({
          where: { entityId, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 1000,
        }),
        this.db.salesChannel.findMany({
          where: { entityId, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.db.warehouse.findMany({
          where: { entityId, isActive: true },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        }),
      ]);
    return {
      company: {
        id: entity.id,
        name: entity.name,
        loginCode: entity.loginCode,
      },
      customers,
      products,
      accounts,
      catalog,
      prices,
      vendors,
      channels,
      warehouses,
    };
  }
  async createAccount(dto: B2bAccountDto, actorId: string) {
    await this.company(dto.entityId);
    await this.customer(dto.entityId, dto.customerId);
    const passwordHash = await this.password(dto.password);
    try {
      return await this.db.b2bAccount.create({
        data: {
          entityId: dto.entityId,
          customerId: dto.customerId,
          email: emailKey(dto.email),
          name: dto.name.trim(),
          passwordHash,
          createdBy: actorId,
        },
        select: accountSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('此公司已有相同 Email 客戶帳號');
      throw error;
    }
  }
  async createSupplierAccount(dto: B2bSupplierAccountDto, actorId: string) {
    await this.company(dto.entityId);
    const vendor = await this.db.vendor.findFirst({
      where: { id: dto.vendorId, entityId: dto.entityId, isActive: true },
    });
    if (!vendor) throw new NotFoundException('供應商不存在或已停用');
    const passwordHash = await this.password(dto.password);
    try {
      return await this.db.b2bAccount.create({
        data: {
          entityId: dto.entityId,
          vendorId: dto.vendorId,
          accountType: 'SUPPLIER',
          email: emailKey(dto.email),
          name: dto.name.trim(),
          passwordHash,
          createdBy: actorId,
        },
        select: accountSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('此公司已有相同 Email 合作夥伴帳號');
      throw error;
    }
  }
  async updateAccount(id: string, dto: B2bAccountUpdateDto, accountType: 'CUSTOMER' | 'SUPPLIER' = 'CUSTOMER') {
    const passwordHash = dto.password
      ? await this.password(dto.password)
      : undefined;
    return this.db.$transaction(async (tx) => {
      const account = await tx.b2bAccount.findFirst({
        where: { id, entityId: dto.entityId, accountType },
      });
      if (!account) throw new NotFoundException('客戶帳號不存在');
      const result = await tx.b2bAccount.update({
        where: { id },
        data: {
          isActive: dto.isActive,
          ...(passwordHash
            ? { passwordHash, failedLoginCount: 0, lockedUntil: null }
            : {}),
        },
        select: accountSelect,
      });
      if (!dto.isActive || passwordHash)
        await tx.b2bSession.updateMany({
          where: { accountId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      return result;
    });
  }
  async setCatalog(dto: B2bCatalogDto, actorId: string) {
    await this.company(dto.entityId);
    await this.product(dto.entityId, dto.productId);
    const data = {
      unitPrice: new Prisma.Decimal(dto.unitPrice),
      isPublished: dto.isPublished,
      updatedBy: actorId,
    };
    return this.db.b2bCatalogItem.upsert({
      where: {
        entityId_productId: {
          entityId: dto.entityId,
          productId: dto.productId,
        },
      },
      create: { entityId: dto.entityId, productId: dto.productId, ...data },
      update: data,
      select: { productId: true, unitPrice: true, isPublished: true },
    });
  }
  async setPrice(dto: B2bPriceDto, actorId: string) {
    await this.company(dto.entityId);
    await this.customer(dto.entityId, dto.customerId);
    await this.product(dto.entityId, dto.productId);
    const validUntil = priceValidUntil(dto.validUntil);
    if (validUntil && validUntil.getTime() <= Date.now() && dto.isActive)
      throw new BadRequestException('有效期限必須晚於現在');
    const key = {
      entityId: dto.entityId,
      customerId: dto.customerId,
      productId: dto.productId,
    };
    const data = {
      unitPrice: new Prisma.Decimal(dto.unitPrice),
      isActive: dto.isActive,
      validUntil,
      updatedBy: actorId,
    };
    return this.db.b2bCustomerPrice.upsert({
      where: { entityId_customerId_productId: key },
      create: { ...key, ...data },
      update: data,
      select: {
        customerId: true,
        productId: true,
        unitPrice: true,
        isActive: true,
        validUntil: true,
      },
    });
  }
  async login(dto: B2bLoginDto) {
    this.ensureEnabled();
    const entity = await this.db.entity.findFirst({
      where: { loginCode: dto.companyCode.trim(), isActive: true },
      select: { id: true },
    });
    const account = entity
      ? await this.db.b2bAccount.findUnique({
          where: {
            entityId_email: { entityId: entity.id, email: emailKey(dto.email) },
          },
        })
      : null;
    const passwordMatches = await bcrypt.compare(
      dto.password,
      account?.passwordHash || dummyHash,
    );
    if (!account) throw new UnauthorizedException('公司代碼、Email 或密碼錯誤');
    // Lock serializes login counters and rechecks credentials after concurrent password/account changes.
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM b2b_accounts WHERE id=${account.id} FOR UPDATE`;
      const current = await tx.b2bAccount.findUnique({
        where: { id: account.id },
        include: { customer: true, entity: true },
      });
      const now = new Date();
      if (
        !current ||
        current.accountType !== 'CUSTOMER' ||
        !current.customerId ||
        !current.isActive ||
        !current.customer?.isActive ||
        current.customer.entityId !== current.entityId ||
        !current.entity.isActive ||
        current.entity.baseCurrency !== 'TWD' ||
        current.passwordHash !== account.passwordHash ||
        (current.lockedUntil && current.lockedUntil > now)
      )
        return null;
      if (!passwordMatches) {
        const count =
          current.lockedUntil && current.lockedUntil <= now
            ? 1
            : current.failedLoginCount + 1;
        await tx.b2bAccount.update({
          where: { id: current.id },
          data: {
            failedLoginCount: count,
            lockedUntil:
              count >= 5 ? new Date(now.getTime() + 15 * 60 * 1000) : null,
          },
        });
        return null;
      }
      await tx.b2bAccount.update({
        where: { id: current.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      const token = `b2b_${randomBytes(32).toString('hex')}`;
      const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      await tx.b2bSession.create({
        data: { tokenHash: sha256(token), accountId: current.id, expiresAt },
      });
      return {
        token,
        expiresAt,
        profile: {
          id: current.id,
          name: current.name,
          customerId: current.customerId,
          customerName: current.customer.companyName || current.customer.name,
          entityId: current.entityId,
          companyName: current.entity.name,
        },
      };
    });
    if (!result) throw new UnauthorizedException('公司代碼、Email 或密碼錯誤');
    return result;
  }
  async authenticate(authorization?: string): Promise<B2bIdentity> {
    this.ensureEnabled();
    if (!authorization || !/^Bearer b2b_[a-f0-9]{64}$/.test(authorization))
      throw new UnauthorizedException('請先登入客戶採購入口');
    const tokenHash = sha256(authorization.slice(7));
    const session = await this.db.b2bSession.findUnique({
      where: { tokenHash },
      include: { account: { include: { customer: true, entity: true } } },
    });
    const account = session?.account;
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !account?.isActive ||
      account.accountType !== 'CUSTOMER' ||
      !account.customerId ||
      !account.customer?.isActive ||
      !account.entity.isActive ||
      account.customer.entityId !== account.entityId
    )
      throw new UnauthorizedException('客戶登入已失效，請重新登入');
    return {
      id: account.id,
      name: account.name,
      entityId: account.entityId,
      customerId: account.customerId,
      customerName: account.customer.companyName || account.customer.name,
      companyName: account.entity.name,
      tokenHash,
    };
  }
  async logout(identity: B2bIdentity) {
    await this.db.b2bSession.updateMany({
      where: { tokenHash: identity.tokenHash },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }
  async catalog(
    identity: B2bIdentity,
    db: Prisma.TransactionClient | PrismaService = this.db,
    productIds?: string[],
  ) {
    await this.company(identity.entityId, db);
    await this.customer(identity.entityId, identity.customerId, db);
    const [catalog, prices] = await Promise.all([
      db.b2bCatalogItem.findMany({
        where: {
          entityId: identity.entityId,
          isPublished: true,
          ...(productIds ? { productId: { in: productIds } } : {}),
          product: { entityId: identity.entityId, isActive: true, type: ProductType.SIMPLE },
        },
        select: {
          productId: true,
          unitPrice: true,
          product: { select: { sku: true, name: true, description: true } },
        },
        orderBy: { product: { sku: 'asc' } },
        take: 1000,
      }),
      db.b2bCustomerPrice.findMany({
        where: {
          entityId: identity.entityId,
          customerId: identity.customerId,
          isActive: true,
          OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
          ...(productIds ? { productId: { in: productIds } } : {}),
        },
        select: { productId: true, unitPrice: true },
      }),
    ]);
    const overrides = new Map(prices.map((p) => [p.productId, p.unitPrice]));
    return {
      currency: 'TWD',
      taxRate: '5',
      items: catalog.map((p) => ({
        productId: p.productId,
        sku: p.product.sku,
        name: p.product.name,
        description: p.product.description,
        unitPrice: (overrides.get(p.productId) || p.unitPrice).toFixed(2),
        currency: 'TWD',
      })),
    };
  }
  async submit(identity: B2bIdentity, dto: B2bRequestDto) {
    if (new Set(dto.items.map((i) => i.productId)).size !== dto.items.length)
      throw new BadRequestException('同一商品請合併數量');
    const key = {
      entityId: identity.entityId,
      customerId: identity.customerId,
      requestId: dto.requestId,
    };
    const sourceHash = requestSourceHash(dto);
    const existing = await this.db.b2bPurchaseRequest.findUnique({
      where: { entityId_customerId_requestId: key },
      include: includeRequest,
    });
    if (existing) {
      if (existing.sourceHash !== sourceHash)
        throw new ConflictException('此提交編號已用於不同內容');
      return publicRequest(existing);
    }
    try {
      const result = await this.db.$transaction(
        async (tx) => {
          const catalog = await this.catalog(
            identity,
            tx,
            dto.items.map((i) => i.productId),
          );
          const products = new Map(catalog.items.map((i) => [i.productId, i]));
          const items = dto.items.map((item, index) => {
            const product = products.get(item.productId);
            if (!product)
              throw new BadRequestException('商品未發布、已停用或不屬於此公司');
            const unitPrice = new Prisma.Decimal(product.unitPrice);
            const lineTotal = unitPrice.mul(item.quantity);
            return {
              productId: item.productId,
              sku: product.sku,
              name: product.name,
              quantity: item.quantity,
              unitPrice,
              lineTotal,
              sortOrder: index,
            };
          });
          const subtotal = items.reduce(
            (sum, i) => sum.add(i.lineTotal),
            new Prisma.Decimal(0),
          );
          const tax = subtotal.mul('0.05').toDecimalPlaces(2);
          const total = subtotal.add(tax);
          const id = randomUUID();
          return tx.b2bPurchaseRequest.create({
            data: {
              id,
              ...key,
              accountId: identity.id,
              sourceHash,
              requestNumber: `B2B-${id.toUpperCase()}`,
              customerPoNumber: dto.customerPoNumber.trim(),
              note: dto.note?.trim() || null,
              subtotal,
              tax,
              total,
              items: { create: items },
            },
            include: includeRequest,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return publicRequest(result);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const row = await this.db.b2bPurchaseRequest.findUnique({
          where: { entityId_customerId_requestId: key },
          include: includeRequest,
        });
        if (row && row.sourceHash === sourceHash) return publicRequest(row);
        throw new ConflictException('此提交編號已用於不同內容');
      }
      throw error;
    }
  }
  async requests(entityId: string, customerId?: string) {
    const rows = await this.db.b2bPurchaseRequest.findMany({
      where: { entityId, ...(customerId ? { customerId } : {}) },
      include: includeRequest,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      items: rows.map((r) => ({
        ...publicRequest(r),
        ...(!customerId
          ? { customerName: r.customer.companyName || r.customer.name }
          : {}),
      })),
    };
  }
  async detail(identity: B2bIdentity, id: string) {
    const row = await this.db.b2bPurchaseRequest.findFirst({
      where: {
        id,
        entityId: identity.entityId,
        customerId: identity.customerId,
      },
      include: includeRequest,
    });
    if (!row) throw new NotFoundException('找不到此報價需求');
    return publicRequest(row);
  }
  async review(id: string, dto: B2bReviewDto, actorId: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM b2b_purchase_requests WHERE id=${id} AND entity_id=${dto.entityId} FOR UPDATE`;
      const row = await tx.b2bPurchaseRequest.findFirst({
        where: { id, entityId: dto.entityId },
        include: includeRequest,
      });
      if (!row) throw new NotFoundException('找不到此報價需求');
      if (row.status !== 'pending_stock_review')
        throw new ConflictException('此需求已確認，請重新載入');
      const quantities = new Map(
        dto.items.map((i) => [i.id, i.confirmedQuantity]),
      );
      if (
        quantities.size !== dto.items.length ||
        quantities.size !== row.items.length ||
        row.items.some(
          (i) => !quantities.has(i.id) || quantities.get(i.id)! > i.quantity,
        )
      )
        throw new BadRequestException('請逐項確認，不可超過客戶需求量');
      const complete = row.items.every(
        (i) => quantities.get(i.id) === i.quantity,
      );
      if (!complete && !dto.reviewNote?.trim())
        throw new BadRequestException('數量不足時請填寫差異說明');
      for (const item of row.items)
        await tx.b2bRequestItem.update({
          where: { id: item.id },
          data: { confirmedQuantity: quantities.get(item.id)! },
        });
      const updated = await tx.b2bPurchaseRequest.update({
        where: { id },
        data: {
          status: complete ? 'stock_confirmed' : 'needs_adjustment',
          reviewedAt: new Date(),
          reviewedBy: actorId,
          reviewNote: dto.reviewNote?.trim() || null,
          deliveryDate: dto.deliveryDate
            ? new Date(`${dto.deliveryDate}T00:00:00.000Z`)
            : null,
        },
        include: includeRequest,
      });
      // Human review records availability only. No order, reservation, shipment, or ledger write occurs here.
      return publicRequest(updated);
    });
  }

  async confirm(id: string, dto: B2bConfirmDto, actorId: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM b2b_purchase_requests WHERE id=${id} AND entity_id=${dto.entityId} FOR UPDATE`;
      const row = await tx.b2bPurchaseRequest.findFirst({
        where: { id, entityId: dto.entityId },
        include: includeRequest,
      });
      if (!row) throw new NotFoundException('找不到此報價需求');
      if (row.status === 'order_confirmed' && row.salesOrderId) {
        const existing = await tx.salesOrder.findFirst({
          where: { id: row.salesOrderId, entityId: dto.entityId },
          select: { id: true, channelId: true },
        });
        if (!existing || existing.channelId !== dto.channelId)
          throw new ConflictException('此需求已使用其他通路確認接單');
        const reservation = await tx.inventoryTransaction.findFirst({
          where: {
            entityId: dto.entityId,
            referenceType: 'SALES_ORDER',
            referenceId: existing.id,
            direction: 'RESERVE',
          },
          select: { warehouseId: true },
        });
        if (reservation?.warehouseId !== dto.warehouseId)
          throw new ConflictException('此需求已使用其他倉庫確認接單');
        return { ...publicRequest(row), alreadyConfirmed: true };
      }
      if (row.status !== 'stock_confirmed' || !row.reviewedAt ||
        row.items.some((item) => item.confirmedQuantity !== item.quantity || item.quantity < 1)) {
        throw new ConflictException('須先由人員全數核庫；數量有差異時應取得客戶重新確認');
      }
      if (row.currency !== 'TWD' ||
        !row.items.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0)).equals(row.subtotal) ||
        !row.subtotal.add(row.tax).equals(row.total)) {
        throw new BadRequestException('報價金額快照不一致，請人工查核');
      }
      const totalTaxCents = row.tax.mul(100).toNumber();
      if (!Number.isSafeInteger(totalTaxCents) || totalTaxCents < 0)
        throw new BadRequestException('報價稅額超出支援範圍');
      const productIds = row.items.map((item) => item.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, entityId: row.entityId, isActive: true },
        select: { id: true, type: true, hasSerialNumbers: true, barcode: true },
      });
      if (products.length !== productIds.length || products.some((product) =>
        product.type !== ProductType.SIMPLE || product.hasSerialNumbers || !product.barcode?.trim())) {
        throw new BadRequestException('部分商品尚未具備 WMS 條碼或序號配置，不能確認接單');
      }
      let brandMapping: Record<string, Record<string, string>>;
      try {
        brandMapping = JSON.parse(process.env.WMS_DISPATCH_PRODUCT_BRANDS_JSON || '{}');
        if (!brandMapping || typeof brandMapping !== 'object' || Array.isArray(brandMapping))
          throw new Error('mapping must be an object');
      } catch {
        throw new BadRequestException('WMS 商品品牌對照尚未設定');
      }
      const brands = new Set(products.map((product) => brandMapping?.[row.entityId]?.[product.id]));
      const brand = [...brands][0];
      if (brands.size !== 1 || typeof brand !== 'string' || !brand.trim() || brand.length > 128)
        throw new BadRequestException('商品缺少一致的 WMS 品牌對照，不能確認接單');
      const taxParts = row.items.map((item, index) => {
        const exact = row.subtotal.isZero()
          ? new Prisma.Decimal(0)
          : row.tax.mul(100).mul(item.lineTotal).div(row.subtotal);
        const cents = exact.floor().toNumber();
        return { index, cents, remainder: exact.sub(cents) };
      });
      let remaining = totalTaxCents - taxParts.reduce((sum, part) => sum + part.cents, 0);
      taxParts.sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
      for (const part of taxParts) {
        if (remaining-- <= 0) break;
        part.cents++;
      }
      const taxByIndex = new Map(taxParts.map((part) => [part.index, part.cents / 100]));
      const order = await this.salesOrders.createSalesOrder({
        entityId: row.entityId,
        channelId: dto.channelId,
        warehouseId: dto.warehouseId,
        customerId: row.customerId,
        externalOrderId: `B2B:${row.id}`,
        orderDate: new Date(),
        currency: 'TWD',
        fxRate: 1,
        items: row.items.map((item, index) => ({
          productId: item.productId,
          qty: item.quantity,
          unitPrice: Number(item.unitPrice),
          taxAmount: taxByIndex.get(index) || 0,
        })),
      }, actorId, tx);
      const updated = await tx.b2bPurchaseRequest.update({
        where: { id },
        data: { salesOrderId: order.id, status: 'order_confirmed' },
        include: includeRequest,
      });
      return { ...publicRequest(updated), alreadyConfirmed: false };
    }, { maxWait: 5_000, timeout: 20_000 });
  }
}
