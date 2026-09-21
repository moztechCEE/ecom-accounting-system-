import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

describe('Bounded company customer business records', () => {
  const findMany = jest.fn();
  const service = new CustomerService({ customer: { findMany } } as unknown as PrismaService);
  beforeEach(() => findMany.mockReset().mockResolvedValue([]));

  it('selects only business fields within the fixed company, with at most 101 rows and no relations', async () => {
    const result = await service.businessRecords('tw-entity-001', '100', '50000');
    expect(result).toEqual({ rows: [], limit: 100, offset: 50000, hasMore: false, nextOffset: null });
    const query = findMany.mock.calls[0][0];
    expect(query).toMatchObject({ where: { entityId: 'tw-entity-001' }, take: 101, skip: 50000, orderBy: { id: 'asc' } });
    expect(query.include).toBeUndefined();
    expect(Object.keys(query.select).sort()).toEqual([
      'id', 'entityId', 'code', 'name', 'companyName', 'type', 'isActive', 'paymentTerms',
      'paymentTermDays', 'isMonthlyBilling', 'billingCycle', 'updatedAt',
    ].sort());
  });

  it('returns a next page only when the extra row exists; defaults are bounded', async () => {
    findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(await service.businessRecords('tw-entity-001', '2', '50')).toEqual({
      rows: [{ id: 'a' }, { id: 'b' }], limit: 2, offset: 50, hasMore: true, nextOffset: 52,
    });
    findMany.mockResolvedValue([]);
    await service.businessRecords('tw-entity-001');
    expect(findMany.mock.calls[1][0]).toMatchObject({ take: 51, skip: 0 });
  });

  it.each(['0', '101', '-1', '01', '1.0', ' 1', '', ['1'], true])('rejects invalid limit %p before DB access', async (limit) => {
    await expect(service.businessRecords('tw-entity-001', limit as string)).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each(['-1', '01', '1e6', '1000000001', ['0']])('rejects invalid offset %p before DB access', async (offset) => {
    await expect(service.businessRecords('tw-entity-001', '1', offset as string)).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('requires sales read permission and verifies company before querying', async () => {
    const getContext = jest.fn().mockResolvedValue({ entityId: 'tw-entity-001', noAccess: false });
    const businessRecords = jest.fn();
    const controller = new CustomerController({ businessRecords } as unknown as CustomerService,
      { getContext } as unknown as EntityAccessService);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.businessRecords)).toEqual(['sales_orders:read']);
    await controller.businessRecords({ user: { id: 'reader', entityId: 'untrusted' } }, undefined, '10', '100');
    expect(businessRecords).toHaveBeenCalledWith('tw-entity-001', '10', '100');
    getContext.mockResolvedValue({ entityId: 'foreign', noAccess: true });
    await expect(controller.businessRecords({ user: { id: 'reader' } }, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
    expect(businessRecords).toHaveBeenCalledTimes(1);
  });
});
