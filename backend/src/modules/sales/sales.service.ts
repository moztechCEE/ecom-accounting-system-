import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { Prisma, Product, ProductType } from '@prisma/client';

/**
 * SalesService
 * 銷售服務基礎類別
 */
@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  /**
   * 查詢銷售渠道
   */
  async getSalesChannels(entityId: string) {
    return this.prisma.salesChannel.findMany({
      where: {
        entityId,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * 查詢客戶
   */
  async getCustomers(entityId: string) {
    return this.prisma.customer.findMany({
      where: {
        entityId,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * 查詢商品
   */
  async getProducts(entityId: string) {
    return this.prisma.product.findMany({
      where: {
        entityId,
        isActive: true,
      },
      orderBy: { sku: 'asc' },
    });
  }

  /**
   * 銷售訂單出貨時扣減庫存並釋放預留量
   */
  async fulfillSalesOrder(params: {
    entityId: string;
    warehouseId: string;
    salesOrderId: string;
    itemSerialNumbers?: Record<string, string[]>;
  }) {
    const { entityId, warehouseId, salesOrderId, itemSerialNumbers } = params;
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id: salesOrderId, entityId },
        include: { items: { include: { product: true } } },
      });
      if (!order) throw new NotFoundException('Sales order not found for entity');
      if (order.status === 'shipped' || order.status === 'completed') {
        return { success: true, alreadyFulfilled: true, status: order.status };
      }
      if (['cancelled', 'refunded'].includes(order.status)) {
        throw new BadRequestException(`Sales order cannot be fulfilled from status ${order.status}`);
      }

      // WMS-managed orders must be posted from verified shipment lines after
      // warehouse reconciliation. The legacy whole-order action would deduct
      // every ordered unit before actual handover and could post twice.
      const dispatchIntents = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM wms_dispatch_intents
        WHERE entity_id=${entityId} AND sales_order_id=${salesOrderId}
        LIMIT 1
      `;
      if (dispatchIntents.length > 0) {
        throw new BadRequestException(
          '此訂單已送 WMS，請依實際交運明細完成晚間核銷，不能整單直接扣庫',
        );
      }

      const existingOutbound = await tx.inventoryTransaction.count({
        where: {
          entityId,
          referenceType: 'SALES_ORDER',
          referenceId: salesOrderId,
          direction: 'OUT',
        },
      });
      if (existingOutbound > 0) {
        throw new BadRequestException(
          'Existing shipment inventory movements require manual review before retrying',
        );
      }

      const claimed = await tx.salesOrder.updateMany({
        where: { id: salesOrderId, entityId, status: order.status },
        data: { status: 'fulfilling' },
      });
      if (claimed.count !== 1) {
        const latest = await tx.salesOrder.findFirst({ where: { id: salesOrderId, entityId } });
        if (latest?.status === 'shipped' || latest?.status === 'completed') {
          return { success: true, alreadyFulfilled: true, status: latest.status };
        }
        throw new BadRequestException('Sales order is already being fulfilled');
      }

      const warehouse = await tx.warehouse.findFirst({
        where: { id: warehouseId, entityId, isActive: true },
      });
      if (!warehouse) throw new BadRequestException('Warehouse not found or inactive');

      for (const item of order.items) {
        if (item.product.hasSerialNumbers) {
          const sns = itemSerialNumbers?.[item.id] || [];
          if (sns.length !== Number(item.qty)) {
            throw new BadRequestException(
              `Product ${item.product.sku} requires ${item.qty} serial numbers, but got ${sns.length}`,
            );
          }
          await this.inventoryService.markSerialNumbersAsSold(
            {
              entityId,
              warehouseId,
              productId: item.productId,
              serialNumbers: sns,
              outboundRefType: 'SALES_ORDER',
              outboundRefId: salesOrderId,
            },
            tx,
          );
        }

        await this.fulfillInventoryForItem(
          tx,
          entityId,
          warehouseId,
          salesOrderId,
          item.product,
          Number(item.qty),
        );
      }

      await tx.shipment.create({
        data: {
          entityId,
          salesOrderId,
          shipDate: new Date(),
          status: 'shipped',
          notes: `Warehouse: ${warehouse.code}`,
        },
      });
      await tx.salesOrder.update({
        where: { id: salesOrderId },
        data: { status: 'shipped' },
      });
      return { success: true, alreadyFulfilled: false, status: 'shipped' };
    }, { maxWait: 5_000, timeout: 20_000 });
  }

  /**
   * 遞迴扣減庫存 (支援 Bundle 展開)
   */
  private async fulfillInventoryForItem(
    tx: Prisma.TransactionClient,
    entityId: string,
    warehouseId: string,
    orderId: string,
    product: Product,
    qty: number,
  ) {
    if (product.type === ProductType.BUNDLE) {
      // 展開 BOM
      const bom = await tx.billOfMaterial.findMany({
        where: { parentId: product.id },
        include: { child: true },
      });

      if (bom.length === 0) {
        this.logger.warn(`Bundle product ${product.sku} has no BOM components defined.`);
        return;
      }

      for (const component of bom) {
        const requiredQty = Number(component.quantity) * qty;
        await this.fulfillInventoryForItem(
          tx,
          entityId,
          warehouseId,
          orderId,
          component.child,
          requiredQty,
        );
      }
    } else {
      if (product.type === ProductType.SERVICE) return;

      await this.inventoryService.shipStock(
        {
          entityId,
          warehouseId,
          productId: product.id,
          quantity: qty,
          referenceType: 'SALES_ORDER',
          referenceId: orderId,
          reason: 'Sales order shipment',
        },
        tx,
      );
    }
  }
}
