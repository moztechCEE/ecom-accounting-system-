import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { InventoryService } from '../inventory/inventory.service';
import { CostService } from '../cost/cost.service';
import { LandedCostDto } from './dto/landed-cost.dto';
import { calculateLandedCost } from './landed-cost';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateB2bPurchaseOrderDto } from './dto/create-b2b-purchase-order.dto';

type PreparedPurchaseOrder = {
  vendorId: string;
  orderDate: Date;
  currency: string;
  fxRate: Prisma.Decimal;
  notes: string | null;
  items: {
    productId: string;
    qty: Prisma.Decimal;
    unitCostOriginal: Prisma.Decimal;
    unitCostCurrency: string;
    unitCostFxRate: Prisma.Decimal;
    unitCostBase: Prisma.Decimal;
  }[];
  productIds: string[];
  totalAmountOriginal: Prisma.Decimal;
  totalAmountBase: Prisma.Decimal;
};

type B2bSource = {
  requestId: string;
  requestKey: string;
  payloadHash: string;
  requestItemIds: string[];
};

const CLOSED_B2B_PURCHASE_STATUSES = ['cancelled', 'received', 'completed'];

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly costService: CostService,
  ) {}

  private companyId(entityId: string) {
    const companyId = typeof entityId === 'string' ? entityId.trim() : '';
    if (!companyId || companyId.length > 128)
      throw new BadRequestException('entityId is required');
    return companyId;
  }

  private preparePurchaseOrder(dto: CreatePurchaseOrderDto): PreparedPurchaseOrder {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto))
      throw new BadRequestException('採購單內容格式錯誤');
    // Validate service callers as well as HTTP callers, and snapshot normalized
    // values before the first await so a mutable DTO cannot change the write.
    const input = plainToInstance(CreatePurchaseOrderDto, dto);
    if (validateSync(input, { whitelist: true, forbidNonWhitelisted: true }).length)
      throw new BadRequestException('請確認供應商、日期、幣別、正數數量／成本及匯率');
    const vendorId = input.vendorId;
    const orderDate = new Date(input.orderDate);
    const currency = input.currency;
    const fxRate = new Prisma.Decimal(input.fxRate);
    const notes = input.notes || null;
    const items = input.items.map((item) => {
      const qty = new Prisma.Decimal(item.qty);
      const unitCostOriginal = new Prisma.Decimal(item.unitCost);
      // Stored unit cost has two decimals. Sum the same rounded values that
      // recordPurchaseCost consumes, so the PO header and receipt cost agree.
      const unitCostBase = unitCostOriginal.mul(fxRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      return { productId: item.productId, qty, unitCostOriginal,
        unitCostCurrency: currency, unitCostFxRate: fxRate, unitCostBase };
    });
    if (items.some((item) => item.unitCostBase.isZero()))
      throw new BadRequestException('換算後本位幣單價低於 0.01，請確認單價與匯率');
    const productIds = [...new Set(items.map((item) => item.productId))];
    const totalAmountOriginal = items.reduce(
      (total, item) => total.add(item.qty.mul(item.unitCostOriginal)), new Prisma.Decimal(0));
    const totalAmountBase = items.reduce(
      (total, item) => total.add(item.qty.mul(item.unitCostBase)), new Prisma.Decimal(0));
    const storageLimit = new Prisma.Decimal('10000000000000000');
    if (totalAmountOriginal.gte(storageLimit) || totalAmountBase.gte(storageLimit))
      throw new BadRequestException('採購金額超過支援範圍');

    return { vendorId, orderDate, currency, fxRate, notes, items,
      productIds, totalAmountOriginal, totalAmountBase };
  }

  private async createInTransaction(
    tx: Prisma.TransactionClient,
    companyId: string,
    draft: PreparedPurchaseOrder,
    source?: B2bSource,
  ) {
    const [entity, vendor, products] = await Promise.all([
      tx.entity.findFirst({ where: { id: companyId, isActive: true }, select: { baseCurrency: true } }),
      tx.vendor.findFirst({ where: { id: draft.vendorId, entityId: companyId, isActive: true }, select: { id: true } }),
      tx.product.findMany({ where: { id: { in: draft.productIds }, entityId: companyId, isActive: true }, select: { id: true } }),
    ]);
    if (!entity || !vendor || products.length !== draft.productIds.length)
      throw new BadRequestException('供應商或商品不屬於目前公司，或公司／主檔已停用');
    if (draft.currency === entity.baseCurrency && !draft.fxRate.equals(1))
      throw new BadRequestException('採購幣別與公司本位幣相同時，匯率必須為 1');
    return tx.purchaseOrder.create({
      data: {
        entityId: companyId, vendorId: draft.vendorId, orderDate: draft.orderDate, status: 'pending',
        totalAmountOriginal: draft.totalAmountOriginal, totalAmountCurrency: draft.currency,
        totalAmountFxRate: draft.fxRate, totalAmountBase: draft.totalAmountBase, notes: draft.notes,
        ...(source ? {
          sourceB2bRequestId: source.requestId,
          sourceRequestKey: source.requestKey,
          sourcePayloadHash: source.payloadHash,
        } : {}),
        items: { create: draft.items.map((item, index) => ({
          ...item,
          ...(source ? { sourceB2bRequestItemId: source.requestItemIds[index] } : {}),
        })) },
      },
      include: { items: true, vendor: true },
    });
  }

  async create(entityId: string, dto: CreatePurchaseOrderDto) {
    const companyId = this.companyId(entityId);
    const draft = this.preparePurchaseOrder(dto);
    return this.prisma.$transaction(
      (tx) => this.createInTransaction(tx, companyId, draft),
      { maxWait: 5_000, timeout: 20_000 },
    );
  }

  private b2bPayloadHash(input: {
    entityId: string;
    requestId: string;
    vendorId: string;
    orderDate: Date;
    currency: string;
    fxRate: number;
    items: { requestItemId: string; qty: number; unitCost: number }[];
  }) {
    return createHash('sha256').update(JSON.stringify({
      entityId: input.entityId,
      requestId: input.requestId,
      vendorId: input.vendorId,
      orderDate: input.orderDate.toISOString(),
      currency: input.currency,
      fxRate: new Prisma.Decimal(input.fxRate).toFixed(6),
      items: input.items.map((item) => ({
        requestItemId: item.requestItemId,
        qty: item.qty,
        unitCost: new Prisma.Decimal(item.unitCost).toFixed(2),
      })).sort((a, b) => a.requestItemId.localeCompare(b.requestItemId)),
    })).digest('hex');
  }

  private assertSameB2bRequestKey<T extends {
    sourceB2bRequestId: string | null;
    sourcePayloadHash: string | null;
  }>(
    existing: T,
    requestId: string,
    payloadHash: string,
  ): T {
    if (existing.sourceB2bRequestId !== requestId || existing.sourcePayloadHash !== payloadHash)
      throw new ConflictException('此採購請求編號已用於不同內容');
    return existing;
  }

  async createFromB2bRequest(entityId: string, dto: CreateB2bPurchaseOrderDto) {
    const companyId = this.companyId(entityId);
    if (!dto || typeof dto !== 'object' || Array.isArray(dto))
      throw new BadRequestException('採購單內容格式錯誤');
    const input = plainToInstance(CreateB2bPurchaseOrderDto, dto);
    if (validateSync(input, { whitelist: true, forbidNonWhitelisted: true }).length)
      throw new BadRequestException('請確認需求、供應商、日期、幣別、正數數量／成本及匯率');
    const requestId = input.requestId.toLowerCase();
    const requestKey = input.requestKey.toLowerCase();
    const selected = input.items.map((item) => ({
      requestItemId: item.requestItemId.toLowerCase(), qty: item.qty, unitCost: item.unitCost,
    }));
    if (new Set(selected.map((item) => item.requestItemId)).size !== selected.length)
      throw new BadRequestException('同一需求明細不可重複選取');
    const orderDate = new Date(input.orderDate);
    const vendorId = input.vendorId;
    const currency = input.currency;
    const fxRate = input.fxRate;
    const payloadHash = this.b2bPayloadHash({
      entityId: companyId, requestId, vendorId, orderDate, currency, fxRate, items: selected,
    });

    const loadExisting = (db: PrismaService | Prisma.TransactionClient) => db.purchaseOrder.findFirst({
      where: { entityId: companyId, sourceRequestKey: requestKey },
      include: { items: true, vendor: true },
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        // The request row serializes shortage calculations against another PO
        // creation or a concurrent staff review/confirmation.
        await tx.$queryRaw`SELECT id FROM b2b_purchase_requests WHERE id=${requestId} AND entity_id=${companyId} FOR UPDATE`;
        const request = await tx.b2bPurchaseRequest.findFirst({
          where: { id: requestId, entityId: companyId },
          select: { id: true, status: true, reviewedAt: true, items: { select: {
            id: true, productId: true, quantity: true, confirmedQuantity: true,
          } } },
        });
        if (!request) throw new NotFoundException('找不到此客戶需求');
        const existing = await loadExisting(tx);
        if (existing) return this.assertSameB2bRequestKey(existing, requestId, payloadHash);
        if (request.status !== 'needs_adjustment')
          throw new ConflictException('僅核庫不足的需求可建立供應商採購單');
        const sourceItems = new Map(request.items.map((item) => [item.id, item]));
        if (!request.reviewedAt || request.items.some((item) => item.confirmedQuantity === null ||
          item.confirmedQuantity < 0 || item.confirmedQuantity > item.quantity))
          throw new ConflictException('此需求尚未完成人工核庫');
        const lastReviewAt = request.reviewedAt;
        // Receipt claims a PO row before posting stock and its final status.
        // Lock linked rows so the following status/timestamp check sees any
        // concurrent receipt before permitting another order for this shortage.
        await tx.$queryRaw`SELECT id FROM purchase_orders WHERE entity_id=${companyId} AND source_b2b_request_id=${requestId} FOR UPDATE`;
        const priorOrders = await tx.purchaseOrder.findMany({
          where: { entityId: companyId, sourceB2bRequestId: requestId },
          select: { status: true, updatedAt: true, items: { select: { sourceB2bRequestItemId: true, qty: true } } },
        });
        if (priorOrders.some((order) =>
          ['received', 'completed'].includes(order.status) &&
          order.updatedAt.getTime() >= lastReviewAt.getTime()))
          throw new ConflictException('採購單已於上次核庫後收貨，請先重新人工核庫');
        const ordered = new Map<string, Prisma.Decimal>();
        for (const order of priorOrders) {
          if (CLOSED_B2B_PURCHASE_STATUSES.includes(order.status)) continue;
          for (const item of order.items) {
            if (!item.sourceB2bRequestItemId) continue;
            ordered.set(item.sourceB2bRequestItemId,
              (ordered.get(item.sourceB2bRequestItemId) || new Prisma.Decimal(0)).add(item.qty));
          }
        }
        for (const item of selected) {
          const source = sourceItems.get(item.requestItemId);
          if (!source) throw new BadRequestException('採購明細不屬於此客戶需求');
          const shortage = new Prisma.Decimal(source.quantity - source.confirmedQuantity!);
          const remaining = shortage.sub(ordered.get(source.id) || 0);
          if (new Prisma.Decimal(item.qty).gt(remaining))
            throw new ConflictException('採購數量超過尚未採購的缺貨量');
        }
        const draft = this.preparePurchaseOrder({
          vendorId, orderDate: orderDate.toISOString(), currency, fxRate,
          items: selected.map((item) => ({
            productId: sourceItems.get(item.requestItemId)!.productId,
            qty: item.qty,
            unitCost: item.unitCost,
          })),
        });
        return this.createInTransaction(tx, companyId, draft, {
          requestId, requestKey, payloadHash,
          requestItemIds: selected.map((item) => item.requestItemId),
        });
      }, { maxWait: 5_000, timeout: 20_000 });
    } catch (error) {
      // A key can race across two *different* B2B request rows. The unique
      // database constraint decides that race; compare the committed payload.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await loadExisting(this.prisma);
        if (existing) return this.assertSameB2bRequestKey(existing, requestId, payloadHash);
      }
      throw error;
    }
  }

  async b2bProcurement(entityId: string, requestId: string) {
    const companyId = this.companyId(entityId);
    const request = await this.prisma.b2bPurchaseRequest.findFirst({
      where: { id: requestId, entityId: companyId },
      select: { items: { select: { id: true, quantity: true, confirmedQuantity: true } } },
    });
    if (!request) throw new NotFoundException('找不到此客戶需求');
    if (request.items.some((item) => item.confirmedQuantity === null))
      throw new ConflictException('此需求尚未完成人工核庫');
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { entityId: companyId, sourceB2bRequestId: requestId },
      select: {
        id: true, status: true, createdAt: true,
        vendor: { select: { name: true } },
        items: { select: { sourceB2bRequestItemId: true, qty: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const ordered = new Map<string, Prisma.Decimal>();
    for (const order of orders) {
      if (CLOSED_B2B_PURCHASE_STATUSES.includes(order.status)) continue;
      for (const item of order.items) {
        if (!item.sourceB2bRequestItemId) continue;
        ordered.set(item.sourceB2bRequestItemId,
          (ordered.get(item.sourceB2bRequestItemId) || new Prisma.Decimal(0)).add(item.qty));
      }
    }
    return {
      items: request.items.map((item) => ({
        requestItemId: item.id,
        requested: item.quantity,
        confirmed: item.confirmedQuantity!,
        shortage: item.quantity - item.confirmedQuantity!,
        ordered: (ordered.get(item.id) || new Prisma.Decimal(0)).toNumber(),
      })),
      purchaseOrders: orders.map((order) => ({
        id: order.id, status: order.status, vendorName: order.vendor.name, createdAt: order.createdAt,
      })),
    };
  }

  async options(entityId: string) {
    const [vendors, products] = await Promise.all([
      this.prisma.vendor.findMany({ where: { entityId, isActive: true },
        select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.product.findMany({ where: { entityId, isActive: true },
        select: { id: true, name: true, sku: true }, orderBy: { sku: 'asc' } }),
    ]);
    return { vendors, products };
  }

  async findAll(entityId: string) {
    return this.prisma.purchaseOrder.findMany({
      where: { entityId },
      include: {
        vendor: true,
        items: {
          include: { product: true },
        },
        landedCost: { include: { lines: true } },
      },
      orderBy: { orderDate: 'desc' },
    });
  }

  async findOne(entityId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, entityId },
      include: {
        vendor: true,
        items: {
          include: { product: true },
        },
        landedCost: { include: { lines: true } },
      },
    });

    if (!po) {
      throw new NotFoundException('Purchase Order not found');
    }

    return po;
  }

  private async landedCostPreview(entityId: string, id: string, dto: LandedCostDto, db: PrismaService | Prisma.TransactionClient) {
    const po = await db.purchaseOrder.findFirst({
      where: { id, entityId },
      include: { entity: { select: { baseCurrency: true } }, items: { include: { product: true } } },
    });
    if (!po) throw new NotFoundException('Purchase Order not found');
    if (po.status !== 'pending') throw new BadRequestException('Landed cost can only be changed before receipt');
    if (po.entity.baseCurrency !== 'TWD')
      throw new BadRequestException('第一版進貨運費試算僅支援台幣本位幣公司');
    if (dto.freightCurrency.toUpperCase() === 'TWD' && dto.fxRateToBase !== 1)
      throw new BadRequestException('台幣運費對台幣本位幣的匯率必須為 1');
    const weights = new Map(dto.weights.map((entry) => [entry.purchaseOrderItemId, entry.chargeableWeightKg]));
    if (weights.size !== dto.weights.length || weights.size !== po.items.length ||
      po.items.some((item) => !weights.has(item.id))) {
      throw new BadRequestException('Provide one chargeable weight for every purchase-order line');
    }
    return calculateLandedCost({
      freightCurrency: dto.freightCurrency.toUpperCase(),
      ratePerKgOriginal: dto.ratePerKgOriginal,
      fxRateToBase: dto.fxRateToBase,
      items: po.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.product.sku,
        qty: item.qty,
        unitCostBase: item.unitCostBase,
        chargeableWeightKg: weights.get(item.id)!,
      })),
    });
  }

  async previewLandedCost(entityId: string, id: string, dto: LandedCostDto) {
    return this.landedCostPreview(entityId, id, dto, this.prisma);
  }

  async saveLandedCost(entityId: string, id: string, dto: LandedCostDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the same PO row that receiveOrder claims. A concurrent receive
      // cannot apply a cost while its estimate is being replaced.
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, entityId, status: 'pending' },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException('Purchase Order is not pending');
      const preview = await this.landedCostPreview(entityId, id, dto, tx);
      const saved = await tx.purchaseLandedCost.upsert({
        where: { purchaseOrderId: id },
        create: {
          purchaseOrderId: id,
          entityId,
          freightCurrency: preview.freightCurrency,
          ratePerKgOriginal: preview.ratePerKgOriginal,
          fxRateToBase: preview.fxRateToBase,
          totalChargeableWeightKg: preview.totalChargeableWeightKg,
          freightOriginal: preview.freightOriginal,
          freightBase: preview.freightBase,
          goodsBase: preview.goodsBase,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          freightCurrency: preview.freightCurrency,
          ratePerKgOriginal: preview.ratePerKgOriginal,
          fxRateToBase: preview.fxRateToBase,
          totalChargeableWeightKg: preview.totalChargeableWeightKg,
          freightOriginal: preview.freightOriginal,
          freightBase: preview.freightBase,
          goodsBase: preview.goodsBase,
          updatedBy: actorId,
        },
      });
      await tx.purchaseLandedCostLine.deleteMany({ where: { landedCostId: saved.id } });
      await tx.purchaseLandedCostLine.createMany({
        data: preview.lines.map((line) => ({
          landedCostId: saved.id,
          purchaseOrderItemId: line.purchaseOrderItemId,
          productId: line.productId,
          qty: line.qty,
          chargeableWeightKg: line.chargeableWeightKg,
          allocatedFreightBase: line.allocatedFreightBase,
          landedUnitCostBase: line.landedUnitCostBase,
        })),
      });
      return tx.purchaseLandedCost.findUnique({
        where: { id: saved.id }, include: { lines: true },
      });
    }, { maxWait: 5_000, timeout: 20_000 });
  }

  /**
   * Receive Purchase Order (Inbound)
   * Triggers inventory update and cost recording
   */
  async receiveOrder(entityId: string, id: string, dto: ReceivePurchaseOrderDto) {
    const { warehouseId, serialNumbers } = dto;
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, entityId },
        include: {
          vendor: true,
          items: { include: { product: true } },
        },
      });
      if (!po) throw new NotFoundException('Purchase Order not found');
      if (po.status === 'received' || po.status === 'completed') {
        return po;
      }
      if (po.status !== 'pending') {
        throw new BadRequestException(`Purchase Order cannot be received from status ${po.status}`);
      }

      // Conditional status claim makes concurrent retries idempotent. The claim,
      // inventory, serial numbers, cost and final status share one transaction.
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, entityId, status: 'pending' },
        data: { status: 'receiving' },
      });
      if (claimed.count !== 1) {
        const latest = await tx.purchaseOrder.findFirst({
          where: { id, entityId },
          include: { vendor: true, items: { include: { product: true } } },
        });
        if (latest?.status === 'received' || latest?.status === 'completed') return latest;
        throw new BadRequestException('Purchase Order is already being processed');
      }

      const warehouse = await tx.warehouse.findFirst({
        where: { id: warehouseId, entityId, isActive: true },
      });
      if (!warehouse) throw new BadRequestException('Warehouse not found or inactive');

      const serialRequirements = new Map<
        string,
        { sku: string; quantity: number; serialNumbers: string[] }
      >();
      for (const item of po.items) {
        if (!item.product.hasSerialNumbers) continue;
        const current = serialRequirements.get(item.productId) || {
          sku: item.product.sku,
          quantity: 0,
          serialNumbers:
            serialNumbers?.find((entry) => entry.productId === item.productId)?.serialNumbers || [],
        };
        current.quantity += Number(item.qty);
        serialRequirements.set(item.productId, current);
      }
      for (const requirement of serialRequirements.values()) {
        const unique = new Set(requirement.serialNumbers.map((serial) => serial.trim()));
        if (
          unique.size !== requirement.quantity ||
          requirement.serialNumbers.length !== requirement.quantity ||
          [...unique].some((serial) => !serial)
        ) {
          throw new BadRequestException(
            `Product ${requirement.sku} requires ${requirement.quantity} unique serial numbers, but got ${requirement.serialNumbers.length}`,
          );
        }
      }

      for (const item of po.items) {
        await this.inventoryService.adjustStock(
          {
            entityId,
            warehouseId,
            productId: item.productId,
            quantity: Number(item.qty),
            direction: 'IN',
            reason: `Purchase Order Receive: ${po.id}`,
            referenceType: 'PURCHASE_ORDER',
            referenceId: po.id,
          },
          tx,
        );
      }
      for (const [productId, requirement] of serialRequirements) {
        await this.inventoryService.addSerialNumbers(
          entityId,
          warehouseId,
          productId,
          requirement.serialNumbers,
          'PURCHASE_ORDER',
          po.id,
          tx,
        );
      }

      await this.costService.recordPurchaseCost(po.id, tx);
      await tx.purchaseLandedCost.updateMany({
        where: { purchaseOrderId: po.id, status: 'estimated' },
        data: { status: 'applied', appliedAt: new Date() },
      });
      return tx.purchaseOrder.update({
        where: { id },
        data: { status: 'received' },
        include: { vendor: true, items: { include: { product: true } } },
      });
    }, { maxWait: 5_000, timeout: 20_000 });
  }
}
