import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';

const customer = (id: string, orders = 40000) => ({
  id,
  entityId: 'entity-a',
  name: id,
  type: 'company',
  paymentTermDays: 30,
  isMonthlyBilling: true,
  paymentTerms: 'net30',
  _count: { salesOrders: orders },
  salesOrders: orders
    ? [
        {
          id: 'order-latest',
          orderDate: new Date('2026-09-23T01:00:00Z'),
          channel: { code: 'SHOPIFY', name: 'Shopify' },
          notes: null,
          externalOrderId: 'EXT-1',
        },
      ]
    : [],
});

describe('Bounded customer directory summaries', () => {
  let service: CustomerService, db: any;
  beforeEach(() => {
    db = {
      $queryRaw: jest.fn(async (query: any) =>
        query.values
          .slice(1)
          .filter((id: string) => id !== 'manual')
          .map((id: string) => ({
            customerId: id,
            id: 'order-latest',
            orderDate: new Date('2026-09-23T01:00:00Z'),
            channelCode: 'SHOPIFY',
            channelName: 'Shopify',
            notes: null,
            externalOrderId: 'EXT-1',
            totalOrders: 40000n,
          })),
      ),
      customer: {
        findMany: jest.fn().mockResolvedValue([customer('customer-a')]),
        count: jest.fn().mockResolvedValue(40000),
        findFirst: jest.fn().mockResolvedValue(customer('customer-a')),
      },
    };
    service = new CustomerService(db);
  });

  it('caps both customer and order relations while retaining the complete order count', async () => {
    const result = await service.findAll('entity-a');
    const query = db.customer.findMany.mock.calls[0][0];
    expect(query).toMatchObject({
      where: { entityId: 'entity-a' },
      take: 50,
      skip: 0,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(query.include).toBeUndefined();
    const summaryQuery = db.$queryRaw.mock.calls[0][0];
    expect(summaryQuery.values).toEqual(['entity-a', 'customer-a']);
    expect(summaryQuery.text).toContain(
      'ROW_NUMBER() OVER (PARTITION BY customer_id',
    );
    expect(summaryQuery.text).toContain('WHERE ranked.position=1');
    expect(summaryQuery.text).toContain(
      'COUNT(*) OVER (PARTITION BY customer_id)',
    );
    expect(summaryQuery.text).toContain('channel.entity_id=ranked.entity_id');
    expect(result.rows[0]).toMatchObject({
      totalOrders: 40000,
      sourceScope: 'latest_order',
      sourceLabels: ['MOZTECH 官網'],
      sourceBrands: ['MOZTECH'],
      lastOrderDate: '2026-09-23T01:00:00.000Z',
      paymentSummary: '月結 30 天',
    });
    expect(result.rows[0]).not.toHaveProperty('_count');
    expect(result.rows[0].salesOrders).toHaveLength(1);
    expect(result).toMatchObject({
      total: 40000,
      limit: 50,
      offset: 0,
      hasMore: true,
      nextOffset: 1,
    });
  });

  it('paginates past the PostgreSQL parameter ceiling without enumerating customer IDs', async () => {
    db.customer.findMany.mockImplementation(
      async ({ take, skip, include }: any) => {
        if (!take || take > 100 || include)
          throw new Error('P2035 unbounded relations');
        return Array.from({ length: Math.min(take, 40000 - skip) }, (_, i) =>
          customer(`customer-${skip + i}`),
        );
      },
    );
    const page = await service.findAll('entity-a', {
      limit: '100',
      offset: '32768',
    });
    expect(page.rows).toHaveLength(100);
    expect(db.$queryRaw.mock.calls[0][0].values).toHaveLength(101);
    expect(page.rows[0].id).toBe('customer-32768');
    expect(page).toMatchObject({
      total: 40000,
      limit: 100,
      offset: 32768,
      hasMore: true,
      nextOffset: 32868,
    });
    const last = await service.findAll('entity-a', {
      limit: '100',
      offset: '39950',
    });
    expect(last.rows).toHaveLength(50);
    expect(last).toMatchObject({ hasMore: false, nextOffset: null });
  });

  it('uses identical scoped server search for rows and total count, including contacts beyond the first page', async () => {
    await service.findAll('entity-a', {
      search: '  Specific Contact  ',
      limit: '25',
      offset: '50',
    });
    const query = db.customer.findMany.mock.calls[0][0];
    expect(query.where.entityId).toBe('entity-a');
    expect(query.where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: 'Specific Contact', mode: 'insensitive' } },
        {
          contactPerson: { contains: 'Specific Contact', mode: 'insensitive' },
        },
        { taxId: { contains: 'Specific Contact', mode: 'insensitive' } },
      ]),
    );
    expect(db.customer.count).toHaveBeenCalledWith({ where: query.where });
    expect(query).toMatchObject({ take: 25, skip: 50 });
  });

  it('returns an explicit empty final page and honest manual-source defaults', async () => {
    db.customer.count.mockResolvedValue(1);
    db.customer.findMany.mockResolvedValue([customer('manual', 0)]);
    const result = await service.findAll('entity-a');
    expect(result).toMatchObject({
      total: 1,
      hasMore: false,
      nextOffset: null,
    });
    expect(result.rows[0]).toMatchObject({
      totalOrders: 0,
      lastOrderDate: null,
      sourceLabels: ['手動建立 / 未歸戶'],
      sourceScope: 'latest_order',
    });
    db.customer.findMany.mockResolvedValue([]);
    expect(await service.findAll('entity-a', { offset: '500' })).toMatchObject({
      rows: [],
      offset: 500,
      hasMore: false,
      nextOffset: null,
    });
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '01' },
    { limit: '1.5' },
    { limit: ['1'] },
    { offset: '-1' },
    { offset: '01' },
    { offset: '1e5' },
    { offset: '1000000001' },
    { search: ['one', 'two'] },
    { search: true },
    { search: 'a'.repeat(201) },
  ])(
    'rejects malformed or excessive list options %p before database access',
    async (query) => {
      await expect(
        service.findAll('entity-a', query as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.customer.findMany).not.toHaveBeenCalled();
      expect(db.customer.count).not.toHaveBeenCalled();
    },
  );

  it('also bounds a single high-volume customer detail and preserves company scope', async () => {
    const result = await service.findOne('entity-a', 'customer-a');
    expect(db.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-a', entityId: 'entity-a' },
      }),
    );
    expect(db.customer.findFirst.mock.calls[0][0].include).toBeUndefined();
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual([
      'entity-a',
      'customer-a',
    ]);
    expect(result?.totalOrders).toBe(40000);
    db.customer.findFirst.mockResolvedValue(null);
    expect(await service.findOne('entity-a', 'foreign-customer')).toBeNull();
  });

  it('controller forwards pagination only after verified company membership', async () => {
    const getContext = jest
      .fn()
      .mockResolvedValue({ entityId: 'entity-a', noAccess: false });
    const controller = new CustomerController(service, { getContext } as any);
    await controller.findAll(
      { user: { id: 'actor', entityId: 'untrusted' } },
      'entity-a',
      '10',
      '40',
      'Alice',
    );
    expect(getContext).toHaveBeenCalledWith('actor', 'sales', 'entity-a');
    expect(db.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 40,
        where: expect.objectContaining({ entityId: 'entity-a' }),
      }),
    );
    getContext.mockResolvedValue({ entityId: 'foreign', noAccess: true });
    await expect(
      controller.findAll(
        { user: { id: 'actor' } },
        'foreign',
        '10',
        '40',
        'Alice',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.customer.findMany).toHaveBeenCalledTimes(1);
  });
});
