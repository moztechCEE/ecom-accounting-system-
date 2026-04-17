import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(entityId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      include: {
        salesOrders: {
          select: {
            id: true,
            orderDate: true,
            externalOrderId: true,
            notes: true,
            channel: {
              select: {
                code: true,
                name: true,
              },
            },
          },
          orderBy: {
            orderDate: 'desc',
          },
        },
      },
    });

    return customers.map((customer) => this.enrichCustomer(customer));
  }

  async findOne(entityId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, entityId },
      include: {
        salesOrders: {
          select: {
            id: true,
            orderDate: true,
            externalOrderId: true,
            notes: true,
            channel: {
              select: {
                code: true,
                name: true,
              },
            },
          },
          orderBy: {
            orderDate: 'desc',
          },
        },
      },
    });

    if (!customer) {
      return null;
    }

    return this.enrichCustomer(customer);
  }

  async create(entityId: string, data: Prisma.CustomerCreateInput) {
    return this.prisma.customer.create({
      data: {
        ...data,
        entity: { connect: { id: entityId } },
      },
    });
  }

  async update(entityId: string, id: string, data: Prisma.CustomerUpdateInput) {
    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  async remove(entityId: string, id: string) {
    return this.prisma.customer.delete({
      where: { id },
    });
  }

  private enrichCustomer(
    customer: Prisma.CustomerGetPayload<{
      include: {
        salesOrders: {
          select: {
            id: true;
            orderDate: true;
            externalOrderId: true;
            notes: true;
            channel: {
              select: {
                code: true;
                name: true;
              };
            };
          };
        };
      };
    }>,
  ) {
    const sourceMap = new Map<
      string,
      { label: string; brand: string; channelCode: string | null }
    >();

    for (const order of customer.salesOrders) {
      const resolved = this.resolveOrderSource(order.channel?.code, order.notes);
      const key = `${resolved.channelCode || 'unknown'}::${resolved.brand}::${resolved.label}`;
      if (!sourceMap.has(key)) {
        sourceMap.set(key, resolved);
      }
    }

    const sources = Array.from(sourceMap.values());
    const primarySource = sources[0] || {
      label: '手動建立 / 未歸戶',
      brand: '未歸戶',
      channelCode: null,
    };

    return {
      ...customer,
      totalOrders: customer.salesOrders.length,
      lastOrderDate: customer.salesOrders[0]?.orderDate?.toISOString() || null,
      sourceLabels: sources.length
        ? sources.map((source) => source.label)
        : ['手動建立 / 未歸戶'],
      sourceBrands: sources.length
        ? Array.from(new Set(sources.map((source) => source.brand)))
        : ['未歸戶'],
      primarySourceLabel: primarySource.label,
      primarySourceBrand: primarySource.brand,
      salesOrders: customer.salesOrders,
    };
  }

  private resolveOrderSource(channelCode?: string | null, notes?: string | null) {
    const meta = this.extractMetadata(notes);
    const normalizedChannel = (channelCode || '').trim().toUpperCase();

    if (normalizedChannel === 'SHOPIFY') {
      return {
        label: 'MOZTECH 官網',
        brand: 'MOZTECH',
        channelCode: normalizedChannel,
      };
    }

    if (normalizedChannel === '1SHOP') {
      const storeName = meta.storeName || meta.storeAccount || '團購';
      return {
        label: `${storeName}`,
        brand: storeName.includes('萬魔') ? '萬魔未來工學院' : storeName,
        channelCode: normalizedChannel,
      };
    }

    if (normalizedChannel === 'SHOPLINE') {
      const storeName = meta.storeName || meta.storeHandle || 'Shopline';
      return {
        label: `${storeName}`,
        brand: storeName.includes('萬魔') ? '萬魔未來工學院' : storeName,
        channelCode: normalizedChannel,
      };
    }

    return {
      label: meta.storeName || meta.storeHandle || '其他來源',
      brand: meta.storeName || meta.storeHandle || '其他來源',
      channelCode: normalizedChannel || null,
    };
  }

  private extractMetadata(notes?: string | null) {
    const text = notes || '';
    const meta: Record<string, string> = {};

    for (const segment of text.split(/[;\n]/)) {
      const trimmed = segment.trim();
      if (!trimmed) {
        continue;
      }
      const [rawKey, ...rest] = trimmed.split('=');
      if (!rawKey || !rest.length) {
        continue;
      }
      const key = rawKey.replace(/^\[[^\]]+\]\s*/, '').trim();
      meta[key] = rest.join('=').trim();
    }

    return meta;
  }
}
