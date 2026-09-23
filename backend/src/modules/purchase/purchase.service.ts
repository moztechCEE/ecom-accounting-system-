import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { InventoryService } from '../inventory/inventory.service';
import { CostService } from '../cost/cost.service';
import { LandedCostDto } from './dto/landed-cost.dto';
import { calculateLandedCost } from './landed-cost';
import { Prisma } from '@prisma/client';

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly costService: CostService,
  ) {}

  async create(entityId: string, dto: CreatePurchaseOrderDto) {
    // Calculate totals
    let totalAmountOriginal = 0;
    
    // Verify items and calculate total
    for (const item of dto.items) {
      totalAmountOriginal += item.qty * item.unitCost;
    }

    const totalAmountBase = totalAmountOriginal * dto.fxRate;

    return this.prisma.purchaseOrder.create({
      data: {
        entityId,
        vendorId: dto.vendorId,
        orderDate: new Date(dto.orderDate),
        totalAmountOriginal,
        totalAmountCurrency: dto.currency,
        totalAmountFxRate: dto.fxRate,
        totalAmountBase,
        notes: dto.notes,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            qty: item.qty,
            unitCostOriginal: item.unitCost,
            unitCostCurrency: dto.currency,
            unitCostFxRate: dto.fxRate,
            unitCostBase: item.unitCost * dto.fxRate,
          })),
        },
      },
      include: {
        items: true,
        vendor: true,
      },
    });
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
