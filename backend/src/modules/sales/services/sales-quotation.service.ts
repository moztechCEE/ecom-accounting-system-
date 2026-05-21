import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CreateSalesQuotationDto,
  SalesQuotationItemDto,
} from '../dto/create-sales-quotation.dto';

@Injectable()
export class SalesQuotationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    entityId: string,
    filters: {
      status?: string;
      search?: string;
      startDate?: Date;
      endDate?: Date;
    } = {},
  ) {
    return this.prisma.salesQuotation.findMany({
      where: {
        entityId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.startDate || filters.endDate
          ? {
              quotationDate: {
                ...(filters.startDate ? { gte: filters.startDate } : {}),
                ...(filters.endDate ? { lte: filters.endDate } : {}),
              },
            }
          : {}),
        ...(filters.search?.trim()
          ? {
              OR: [
                { quotationNo: { contains: filters.search.trim(), mode: 'insensitive' } },
                { reference: { contains: filters.search.trim(), mode: 'insensitive' } },
                { customer: { name: { contains: filters.search.trim(), mode: 'insensitive' } } },
                { items: { some: { itemName: { contains: filters.search.trim(), mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      include: this.includeGraph(),
      orderBy: [{ quotationDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(entityId: string, id: string) {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id, entityId },
      include: this.includeGraph(),
    });

    if (!quotation) {
      throw new NotFoundException('Sales quotation not found');
    }

    return quotation;
  }

  async create(dto: CreateSalesQuotationDto, userId?: string) {
    const entityId = dto.entityId?.trim();
    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }
    if (!dto.items?.length) {
      throw new BadRequestException('報價單至少需要一筆明細');
    }

    const quotationDate = dto.quotationDate ? new Date(dto.quotationDate) : new Date();
    if (Number.isNaN(quotationDate.getTime())) {
      throw new BadRequestException('quotationDate must be a valid date');
    }

    const [quotationNo, products] = await Promise.all([
      this.generateQuotationNo(entityId, quotationDate),
      this.loadProducts(entityId, dto.items),
    ]);
    const computedItems = this.computeItems(dto.items, products);
    const totals = this.computeTotals(computedItems);

    return this.prisma.salesQuotation.create({
      data: {
        entityId,
        customerId: dto.customerId || null,
        quotationNo,
        quotationDate,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        ownerName: dto.ownerName?.trim() || null,
        currency: dto.currency?.trim() || 'TWD',
        paymentTerms: dto.paymentTerms?.trim() || null,
        deliveryTerms: dto.deliveryTerms?.trim() || null,
        reference: dto.reference?.trim() || null,
        notes: dto.notes?.trim() || null,
        internalNote: dto.internalNote?.trim() || null,
        createdBy: userId || null,
        subtotalOriginal: totals.subtotal,
        discountAmountOriginal: totals.discount,
        taxAmountOriginal: totals.tax,
        totalAmountOriginal: totals.total,
        items: {
          create: computedItems.map((item, index) => ({
            productId: item.productId,
            itemName: item.itemName,
            itemSpec: item.itemSpec,
            quantity: item.quantity,
            unitPriceOriginal: item.unitPriceOriginal,
            discountOriginal: item.discountOriginal,
            taxRate: item.taxRate,
            taxAmountOriginal: item.taxAmountOriginal,
            lineTotalOriginal: item.lineTotalOriginal,
            sortOrder: index + 1,
          })),
        },
      },
      include: this.includeGraph(),
    });
  }

  async updateStatus(
    entityId: string,
    id: string,
    status: string,
  ) {
    const existing = await this.findOne(entityId, id);
    const nextStatus = status.trim();

    return this.prisma.salesQuotation.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        approvedAt:
          nextStatus === 'approved' && !existing.approvedAt
            ? new Date()
            : existing.approvedAt,
      },
      include: this.includeGraph(),
    });
  }

  private includeGraph() {
    return {
      customer: true,
      items: {
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              modelNumber: true,
              category: true,
              salesPrice: true,
            },
          },
        },
        orderBy: { sortOrder: 'asc' as const },
      },
    };
  }

  private async generateQuotationNo(entityId: string, quotationDate: Date) {
    const year = quotationDate.getFullYear();
    const month = String(quotationDate.getMonth() + 1).padStart(2, '0');
    const day = String(quotationDate.getDate()).padStart(2, '0');
    const prefix = `QT-${year}${month}${day}`;
    const existingCount = await this.prisma.salesQuotation.count({
      where: {
        entityId,
        quotationNo: {
          startsWith: prefix,
        },
      },
    });

    return `${prefix}-${String(existingCount + 1).padStart(3, '0')}`;
  }

  private async loadProducts(entityId: string, items: SalesQuotationItemDto[]) {
    const productIds = Array.from(
      new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id))),
    );
    if (productIds.length === 0) {
      return new Map<string, Product>();
    }

    const products = await this.prisma.product.findMany({
      where: {
        entityId,
        id: { in: productIds },
      },
    });

    return new Map(products.map((product) => [product.id, product]));
  }

  private computeItems(
    items: SalesQuotationItemDto[],
    products: Map<string, Product>,
  ) {
    return items.map((item) => {
      const product = item.productId ? products.get(item.productId) : null;
      if (item.productId && !product) {
        throw new BadRequestException('報價明細包含不存在的商品');
      }

      const quantity = new Prisma.Decimal(item.quantity || 0);
      const unitPriceOriginal = new Prisma.Decimal(
        item.unitPriceOriginal ?? Number(product?.salesPrice || 0),
      );
      const discountOriginal = new Prisma.Decimal(item.discountOriginal || 0);
      const taxRate = new Prisma.Decimal(item.taxRate ?? 5);
      const taxableAmount = Prisma.Decimal.max(
        quantity.mul(unitPriceOriginal).sub(discountOriginal),
        new Prisma.Decimal(0),
      );
      const taxAmountOriginal = taxableAmount.mul(taxRate).div(100).toDecimalPlaces(2);
      const lineTotalOriginal = taxableAmount.add(taxAmountOriginal).toDecimalPlaces(2);

      return {
        productId: product?.id || null,
        itemName: item.itemName?.trim() || product?.name || '未命名品項',
        itemSpec: item.itemSpec?.trim() || product?.modelNumber || product?.sku || null,
        quantity,
        unitPriceOriginal,
        discountOriginal,
        taxRate,
        taxAmountOriginal,
        lineTotalOriginal,
      };
    });
  }

  private computeTotals(
    items: ReturnType<SalesQuotationService['computeItems']>,
  ) {
    return items.reduce(
      (totals, item) => {
        const beforeDiscount = item.quantity.mul(item.unitPriceOriginal);
        totals.subtotal = totals.subtotal.add(beforeDiscount);
        totals.discount = totals.discount.add(item.discountOriginal);
        totals.tax = totals.tax.add(item.taxAmountOriginal);
        totals.total = totals.total.add(item.lineTotalOriginal);
        return totals;
      },
      {
        subtotal: new Prisma.Decimal(0),
        discount: new Prisma.Decimal(0),
        tax: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
      },
    );
  }
}
