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
    const normalizedData = await this.prepareCustomerData(entityId, data);
    const paymentTermDays = this.resolvePaymentTermDays(normalizedData);
    const createData = {
      ...normalizedData,
      paymentTermDays,
      isMonthlyBilling: Boolean(normalizedData.isMonthlyBilling || paymentTermDays > 0),
      entity: { connect: { id: entityId } },
    } as Prisma.CustomerCreateInput;

    return this.prisma.customer.create({
      data: createData,
    });
  }

  async update(entityId: string, id: string, data: Prisma.CustomerUpdateInput) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, entityId },
      select: { id: true, code: true },
    });
    if (!existing) {
      return null;
    }
    const normalizedData = await this.prepareCustomerData(entityId, data, existing);
    const paymentTermDays = this.resolvePaymentTermDays(normalizedData);
    const updateData = {
      ...normalizedData,
      ...(paymentTermDays !== undefined
        ? {
            paymentTermDays,
            isMonthlyBilling: Boolean(
              normalizedData.isMonthlyBilling || paymentTermDays > 0,
            ),
          }
        : {}),
    } as Prisma.CustomerUpdateInput;

    return this.prisma.customer.update({
      where: { id },
      data: updateData,
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
      paymentSummary: this.buildPaymentSummary(customer),
      salesOrders: customer.salesOrders,
    };
  }

  private resolvePaymentTermDays(
    data: Prisma.CustomerCreateInput | Prisma.CustomerUpdateInput,
  ) {
    const rawTermDays = Number(data.paymentTermDays ?? 0);
    if (Number.isFinite(rawTermDays) && rawTermDays > 0) {
      return rawTermDays;
    }

    const terms = String(data.paymentTerms || '').toLowerCase();
    const netMatch = terms.match(/net\s*([0-9]+)/);
    if (netMatch?.[1]) {
      return Number(netMatch[1]);
    }
    if (terms.includes('月結')) {
      return 30;
    }
    if (data.isMonthlyBilling) {
      return 30;
    }
    if (data.type === 'company' && !terms.includes('prepaid')) {
      return 30;
    }

    return data.paymentTermDays === undefined &&
      data.paymentTerms === undefined &&
      data.isMonthlyBilling === undefined &&
      data.type === undefined
      ? undefined
      : 0;
  }

  private buildPaymentSummary(
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
    if (customer.isMonthlyBilling || customer.paymentTermDays > 0) {
      return `月結 ${customer.paymentTermDays || 30} 天`;
    }
    if (customer.paymentTerms) {
      return customer.paymentTerms;
    }
    return customer.type === 'company' ? '公司客戶，預設月結 30 天' : '一般現結';
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
        brand: this.resolveCommerceBrand(storeName),
        channelCode: normalizedChannel,
      };
    }

    if (normalizedChannel === 'SHOPLINE') {
      const storeName = meta.storeName || meta.storeHandle || 'Shopline';
      return {
        label: `${storeName}`,
        brand: this.resolveCommerceBrand(storeName),
        channelCode: normalizedChannel,
      };
    }

    const fallback = meta.storeName || meta.storeHandle || '其他來源';
    return {
      label: fallback,
      brand: this.resolveCommerceBrand(fallback),
      channelCode: normalizedChannel || null,
    };
  }

  private resolveCommerceBrand(value?: string | null) {
    const normalized = (value || '').trim();
    if (!normalized || this.isPlatformName(normalized)) {
      return '未分類品牌';
    }
    if (/moztech|墨子/i.test(normalized)) return 'MOZTECH';
    if (/bonson|邦生/i.test(normalized)) return 'BONSON';
    if (/airity/i.test(normalized)) return 'AIRITY';
    if (/moritek/i.test(normalized)) return 'MORITEK';
    return normalized;
  }

  private isPlatformName(value: string) {
    return ['萬魔未來工學院', '萬物未來工學院', '1SHOP', 'SHOPLINE'].some(
      (keyword) => value.toUpperCase().includes(keyword.toUpperCase()),
    );
  }

  private async prepareCustomerData(
    entityId: string,
    data: Prisma.CustomerCreateInput | Prisma.CustomerUpdateInput,
    existing?: { code: string | null },
  ) {
    const normalized = { ...data } as Record<string, any>;

    for (const key of [
      'name',
      'email',
      'phone',
      'phoneExtension',
      'mobile',
      'taxId',
      'contactPerson',
      'address',
      'statementEmail',
      'collectionOwner',
      'collectionNote',
    ]) {
      if (typeof normalized[key] === 'string') {
        const value = normalized[key].trim();
        normalized[key] = value || null;
      }
    }

    const taxId = this.normalizeTaxId(normalized.taxId);
    if (taxId) {
      normalized.taxId = taxId;
      normalized.code = taxId;
      if (!normalized.type) {
        normalized.type = 'company';
      }
      return normalized;
    }

    if (normalized.taxId !== undefined) {
      normalized.taxId = null;
    }

    if (typeof normalized.code === 'string') {
      const code = normalized.code.trim();
      normalized.code = code || null;
    }

    if (!normalized.code && !existing?.code) {
      normalized.code = await this.generatePersonalCustomerCode(entityId);
    }

    return normalized;
  }

  private normalizeTaxId(value: unknown) {
    const taxId = String(value || '').replace(/\D/g, '');
    return taxId || null;
  }

  private async generatePersonalCustomerCode(entityId: string) {
    const customers = await this.prisma.customer.findMany({
      where: {
        entityId,
        code: {
          startsWith: 'P',
        },
      },
      select: { code: true },
    });

    const maxSequence = customers.reduce((max, customer) => {
      const match = customer.code?.match(/^P(\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    return `P${String(maxSequence + 1).padStart(5, '0')}`;
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
