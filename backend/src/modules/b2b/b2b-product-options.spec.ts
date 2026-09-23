import { BadRequestException } from '@nestjs/common';
import { B2bService } from './b2b.service';
import { B2bAdminController } from './b2b.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ENTITY_ACCESS_MODULE_KEY } from '../../common/decorators/entity-access.decorator';

describe('Bounded B2B product options', () => {
  let db: any, service: B2bService;
  beforeEach(() => {
    db = {
      entity: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'entity-a', baseCurrency: 'TWD' }),
      },
      product: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'p1738', sku: 'LAST-SKU', name: 'Last product' },
          ]),
        count: jest.fn().mockResolvedValue(1738),
      },
    };
    service = new B2bService(db, {} as any);
  });
  it('searches the full scoped SIMPLE active catalog, returns only basic fields and marks more results', async () => {
    const result = await service.productOptions('entity-a', ' LAST ', '20');
    expect(result).toEqual({
      rows: [{ id: 'p1738', sku: 'LAST-SKU', name: 'Last product' }],
      total: 1738,
      limit: 20,
      hasMore: true,
    });
    const query = db.product.findMany.mock.calls[0][0];
    expect(query).toEqual({
      where: {
        entityId: 'entity-a',
        isActive: true,
        type: 'SIMPLE',
        OR: [
          { sku: { contains: 'LAST', mode: 'insensitive' } },
          { name: { contains: 'LAST', mode: 'insensitive' } },
        ],
      },
      select: { id: true, sku: true, name: true },
      orderBy: [{ sku: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    expect(db.product.count).toHaveBeenCalledWith({ where: query.where });
  });
  it('bounds defaults and has no misleading continuation on an exact result set', async () => {
    db.product.count.mockResolvedValue(1);
    expect(await service.productOptions('entity-a')).toMatchObject({
      limit: 20,
      hasMore: false,
    });
    expect(db.product.findMany.mock.calls[0][0].where).toEqual({
      entityId: 'entity-a',
      isActive: true,
      type: 'SIMPLE',
    });
  });
  it.each(['0', '101', '-1', '01', '1.5', ['1'], true])(
    'rejects invalid limit %p before querying',
    async (limit) => {
      await expect(
        service.productOptions('entity-a', undefined, limit as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.entity.findFirst).not.toHaveBeenCalled();
      expect(db.product.findMany).not.toHaveBeenCalled();
    },
  );
  it.each([['a', 'b'], true, 'x'.repeat(201)])(
    'rejects invalid search before querying',
    async (search) => {
      await expect(
        service.productOptions('entity-a', search as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.product.findMany).not.toHaveBeenCalled();
    },
  );
  it('keeps inherited sales read permission and company guard metadata', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, B2bAdminController)).toEqual([
      'sales_orders:read',
    ]);
    expect(
      Reflect.getMetadata(ENTITY_ACCESS_MODULE_KEY, B2bAdminController),
    ).toBe('sales');
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        B2bAdminController.prototype.productOptions,
      ),
    ).toBeUndefined();
  });
});
