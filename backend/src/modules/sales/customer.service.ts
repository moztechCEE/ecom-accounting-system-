import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Customer, Prisma } from '@prisma/client';

type RecentCustomerOrder = {
  id: string; orderDate: Date; externalOrderId: string | null; notes: string | null;
  channel: { code: string | null; name: string | null } | null;
};
type CustomerWithSummary = Customer & {
  salesOrders: RecentCustomerOrder[];
  _count: { salesOrders: number };
};
type CustomerOrderSummaryRow = {
  customerId: string; id: string; orderDate: Date; externalOrderId: string | null;
  notes: string | null; channelCode: string | null; channelName: string | null;
  totalOrders: bigint;
};

export type CustomerListQuery = { limit?: string; offset?: string; search?: string };


@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async businessRecords(entityId: string, rawLimit?: string, rawOffset?: string) {
    const pageNumber = (value: unknown, fallback: number, minimum: number, maximum: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(value)
          || Number(value) < minimum || Number(value) > maximum) {
        throw new BadRequestException('Invalid business record pagination');
      }
      return Number(value);
    };
    const limit = pageNumber(rawLimit, 50, 1, 100);
    const offset = pageNumber(rawOffset, 0, 0, 1_000_000_000);
    // No relation include: a full customer+orders query can exceed PostgreSQL's
    // bind parameter ceiling. Business directory pages do not need contacts or orders.
    const fetched = await this.prisma.customer.findMany({
      where: { entityId }, orderBy: { id: 'asc' }, take: limit + 1, skip: offset,
      select: {
        id: true, entityId: true, code: true, name: true, companyName: true,
        type: true, isActive: true, paymentTerms: true, paymentTermDays: true,
        isMonthlyBilling: true, billingCycle: true, updatedAt: true,
      },
    });
    const rows = fetched.slice(0, limit);
    const hasMore = fetched.length > limit;
    return { rows, limit, offset, hasMore, nextOffset: hasMore ? offset + rows.length : null };
  }

  async findAll(entityId: string, query: CustomerListQuery = {}) {
    const pageNumber = (value: unknown, fallback: number, minimum: number, maximum: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(value)
          || Number(value) < minimum || Number(value) > maximum) {
        throw new BadRequestException('Invalid customer pagination');
      }
      return Number(value);
    };
    const limit = pageNumber(query.limit, 50, 1, 100);
    const offset = pageNumber(query.offset, 0, 0, 1_000_000_000);
    if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200))
      throw new BadRequestException('Customer search must be a string of at most 200 characters');
    const search = query.search?.trim() || '';
    const where: Prisma.CustomerWhereInput = {
      entityId,
      ...(search ? { OR: [
        'name', 'code', 'email', 'phone', 'phoneExtension', 'mobile', 'taxId',
        'companyName', 'contactPerson', 'address', 'summary',
      ].map((field) => ({ [field]: { contains: search, mode: 'insensitive' as const } })) } : {}),
    };
    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit, skip: offset,
      }),
      this.prisma.customer.count({ where }),
    ]);
    const rows = await this.withOrderSummaries(entityId, customers);
    const hasMore = rows.length > 0 && offset + rows.length < total;
    return { rows, total, limit, offset, hasMore,
      nextOffset: hasMore ? offset + rows.length : null };
  }

  async findOne(entityId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, entityId },
    });
    return customer ? (await this.withOrderSummaries(entityId, [customer]))[0] : null;
  }

  private async withOrderSummaries(entityId: string, customers: Customer[]) {
    if (!customers.length) return [];
    // Never hydrate customer -> all orders -> channels. Even a nested Prisma
    // take can be applied in memory depending on relation-loading strategy.
    // This query has <= 101 bind values, one database-side ranking pass, and
    // returns <= 100 rows, regardless of the number of historical sales orders.
    const summaries = await this.prisma.$queryRaw<CustomerOrderSummaryRow[]>(Prisma.sql`
      SELECT ranked.customer_id AS "customerId", ranked.id,
        ranked.order_date AS "orderDate", ranked.external_order_id AS "externalOrderId",
        ranked.notes, ranked.total_orders AS "totalOrders",
        channel.code AS "channelCode", channel.name AS "channelName"
      FROM (
        SELECT id, entity_id, customer_id, channel_id, order_date, external_order_id, notes,
          COUNT(*) OVER (PARTITION BY customer_id) AS total_orders,
          ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, id DESC) AS position
        FROM sales_orders
        WHERE entity_id=${entityId} AND customer_id IN (${Prisma.join(customers.map((row) => row.id))})
      ) ranked
      LEFT JOIN sales_channels channel
        ON channel.id=ranked.channel_id AND channel.entity_id=ranked.entity_id
      WHERE ranked.position=1
    `);
    const byCustomer = new Map(summaries.map((summary) => [summary.customerId, summary]));
    return customers.map((customer) => {
      const summary = byCustomer.get(customer.id);
      const salesOrders: RecentCustomerOrder[] = summary ? [{
        id: summary.id, orderDate: summary.orderDate, externalOrderId: summary.externalOrderId,
        notes: summary.notes, channel: summary.channelCode === null ? null : {
          code: summary.channelCode, name: summary.channelName,
        },
      }] : [];
      return this.enrichCustomer({ ...customer, salesOrders,
        _count: { salesOrders: summary ? Number(summary.totalOrders) : 0 } });
    });
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
      throw new NotFoundException('Customer not found');
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
      where: { id, entityId },
      data: updateData,
    });
  }

  async remove(entityId: string, id: string) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, entityId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Customer not found');
    // Keep orders, quotations and B2B account links for the audit trail.
    return this.prisma.customer.update({
      where: { id, entityId },
      data: { isActive: false },
    });
  }

  private enrichCustomer(customer: CustomerWithSummary) {
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

    const { _count, ...publicCustomer } = customer;
    return {
      ...publicCustomer,
      totalOrders: _count.salesOrders,
      sourceScope: 'latest_order' as const,
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

  private buildPaymentSummary(customer: Pick<Customer,
    'isMonthlyBilling' | 'paymentTermDays' | 'paymentTerms' | 'type'>) {
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
      'companyName',
      'contactPerson',
      'address',
      'summary',
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
