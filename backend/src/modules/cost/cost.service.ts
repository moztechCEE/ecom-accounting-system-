import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma, ProductType } from '@prisma/client';

/**
 * 成本管理服務
 *
 * 核心功能：
 * 1. 進貨成本管理
 * 2. 開發成本攤提（模具費、檢驗費等）
 * 3. 成本分攤規則
 * 4. 銷貨成本計算（FIFO/LIFO/加權平均）
 * 5. 浮動成本計算 (報價用)
 */
@Injectable()
export class CostService {
  private readonly logger = new Logger(CostService.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 計算產品浮動成本 (Floating Cost)
   * 用於報價參考，包含 BOM 展開成本與服務費用 (如包裝費)
   * 
   * 邏輯：
   * 1. 若為 SIMPLE 產品：回傳移動平均成本 (Moving Average Cost) 或 最新進貨價
   * 2. 若為 BUNDLE/MANUFACTURED：遞迴計算所有子元件成本總和
   * 3. 若為 SERVICE：回傳最新採購價 (例如包裝服務費)
   */
  async calculateFloatingCost(entityId: string, productId: string): Promise<number> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product || product.entityId !== entityId) {
      throw new Error('Product not found');
    }

    // 1. 簡單商品或服務：直接回傳成本
    if (product.type === ProductType.SIMPLE || product.type === ProductType.SERVICE) {
      // 優先使用移動平均成本，若為 0 則使用最新進貨價
      const cost = Number(product.movingAverageCost) > 0 
        ? Number(product.movingAverageCost) 
        : Number(product.latestPurchasePrice);
      return cost;
    }

    // 2. 組合商品或製成品：展開 BOM 計算
    if (product.type === ProductType.BUNDLE || product.type === ProductType.MANUFACTURED) {
      const bom = await this.prisma.billOfMaterial.findMany({
        where: { parentId: productId },
        include: { child: true },
      });

      let totalCost = 0;

      for (const component of bom) {
        const componentCost = await this.calculateFloatingCost(entityId, component.childId);
        totalCost += componentCost * Number(component.quantity);
      }

      // 加上額外的固定製造費用 (Overhead) - 這裡暫時假設包含在 BOM 的 SERVICE 項目中
      // 如果有額外的 Overhead 欄位可以在此加入

      return totalCost;
    }

    return 0;
  }

  /**
   * 記錄進貨成本並更新移動平均成本
   * 觸發時機：採購收貨 (Purchase Order Receive)
   */
  async recordPurchaseCost(
    purchaseOrderId: string,
    transactionClient?: Prisma.TransactionClient,
  ) {
    const db = transactionClient || this.prisma;
    const po = await db.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: true, landedCost: { include: { lines: true } } },
    });

    if (!po) throw new Error('Purchase Order not found');
    const landedLines = new Map(po.landedCost?.lines.map((line) => [line.purchaseOrderItemId, line]) || []);
    if (po.landedCost &&
      (po.landedCost.status !== 'estimated' || landedLines.size !== po.items.length)) {
      throw new BadRequestException('Landed cost estimate is incomplete or already applied');
    }
    const grouped = new Map<string, { qty: Prisma.Decimal; totalCost: Prisma.Decimal; latestPrice: Prisma.Decimal }>();
    for (const item of po.items) {
      const landed = landedLines.get(item.id);
      if (po.landedCost &&
        (!landed || landed.productId !== item.productId || !landed.qty.equals(item.qty))) {
        throw new BadRequestException('Landed cost lines no longer match the purchase order');
      }
      const qty = new Prisma.Decimal(item.qty);
      const goodsCost = qty.mul(item.unitCostBase);
      const totalCost = goodsCost.add(landed?.allocatedFreightBase || 0);
      const previous = grouped.get(item.productId);
      grouped.set(item.productId, {
        qty: (previous?.qty || new Prisma.Decimal(0)).add(qty),
        totalCost: (previous?.totalCost || new Prisma.Decimal(0)).add(totalCost),
        latestPrice: new Prisma.Decimal(item.unitCostBase),
      });
    }

    for (const [productId, received] of grouped) {
      const product = await db.product.findUnique({ where: { id: productId } });
      if (!product) throw new BadRequestException(`Product ${productId} is missing`);
      const snapshots = await db.inventorySnapshot.findMany({
        where: { entityId: po.entityId, productId },
      });
      const totalOnHand = snapshots.reduce(
        (sum, snap) => sum.add(snap.qtyOnHand), new Prisma.Decimal(0),
      );
      const oldQty = totalOnHand.sub(received.qty);
      if (oldQty.isNegative()) throw new BadRequestException('Received quantity exceeds total stock');
      const previousValue = oldQty.mul(product.movingAverageCost);
      const movingAverageCost = previousValue.add(received.totalCost).div(totalOnHand).toDecimalPlaces(6);
      await db.product.update({
        where: { id: productId },
        data: {
          latestPurchasePrice: received.latestPrice,
          movingAverageCost,
        },
      });
    }

    // 5. 產生會計分錄 (借：存貨 / 貸：應付帳款-暫估)
    // 注意：這裡僅示範邏輯，實際應呼叫 AccountingService.createJournalEntry
    // 為了避免循環依賴，這裡暫時略過直接呼叫 AccountingService，
    // 實務上建議透過 EventEmitter 或將 JournalEntry 邏輯獨立
    this.logger.log(`Updated cost for PO ${purchaseOrderId}`);
  }

  /**
   * 記錄開發成本
   */
  async recordDevCost(data: {
    productId: string;
    costType: 'MOLD' | 'INSPECTION' | 'DESIGN' | 'OTHER';
    amount: number;
  }) {
    // TODO: 記錄開發成本
    // TODO: 設定攤提規則
  }

  /**
   * 攤提開發成本
   */
  async amortizeDevCost(devCostId: string, quantity: number) {
    // TODO: 依出貨數量攤提開發成本
    // TODO: 產生攤提分錄
  }

  /**
   * 計算銷貨成本（COGS）
   */
  async calculateCOGS(
    salesOrderId: string,
    method: 'FIFO' | 'LIFO' | 'WEIGHTED_AVG',
  ) {
    // TODO: 根據方法計算COGS
    // TODO: 產生COGS分錄（借：銷貨成本 / 貸：存貨）
  }

  /**
   * 批次成本追蹤
   */
  async trackBatchCost(batchId: string) {
    // TODO: 追蹤批次的完整成本
    // TODO: 包含進貨成本、攤提的開發成本等
  }

  /**
   * 成本差異分析
   */
  async analyzeCostVariance(
    productId: string,
    period: { start: Date; end: Date },
  ) {
    // TODO: 比較標準成本與實際成本
  }
}
