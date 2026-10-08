/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailroomService } from './mailroom.service';
import {
  MailroomCatalogService,
  receiptProductSelect,
} from './mailroom-catalog.service';

function fixture(
  permissions = ['mailroom:read'],
  entityIds: string[] = ['company'],
) {
  const product = { findMany: jest.fn().mockResolvedValue([]) };
  const mailroom = {
    enabled: jest.fn(),
    actor: jest.fn().mockResolvedValue({
      id: 'clerk',
      name: 'Synthetic',
      permissions: new Set(permissions),
      entityIds,
    }),
  };
  const service = new MailroomCatalogService(
    { product } as unknown as PrismaService,
    mailroom as unknown as MailroomService,
  );
  return { service, product, mailroom };
}

describe('mailroom-only product picker', () => {
  test.each(['mailroom:read', 'mailroom:create', 'mailroom:update'])(
    '%s can read the receipt projection in the current company',
    async (grant) => {
      const f = fixture([grant]);
      await expect(f.service.options('clerk', 'company')).resolves.toEqual({
        items: [],
      });
      expect(f.product.findMany).toHaveBeenCalledWith({
        where: { entityId: 'company', isActive: true },
        select: receiptProductSelect,
        orderBy: [{ name: 'asc' }, { sku: 'asc' }, { id: 'asc' }],
        take: 30,
      });
      expect(Object.keys(receiptProductSelect).sort()).toEqual([
        'barcode',
        'hasSerialNumbers',
        'id',
        'modelNumber',
        'name',
        'sku',
      ]);
    },
  );
  test.each([
    { grants: ['inventory:read'] },
    { grants: ['b2b:read'] },
    { grants: ['repair_workbench:read'] },
    { grants: [] },
  ])('unrelated grant $grants cannot read any products', async ({ grants }) => {
    const f = fixture(grants);
    await expect(
      f.service.options('clerk', 'company', 'sku'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.product.findMany).not.toHaveBeenCalled();
  });
  test('foreign company, inactive actor, and disabled workbench stop before querying the catalog', async () => {
    const f = fixture();
    await expect(f.service.options('clerk', 'foreign')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    f.mailroom.actor.mockRejectedValueOnce(new ForbiddenException('inactive'));
    await expect(f.service.options('clerk', 'company')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    f.mailroom.enabled.mockImplementationOnce(() => {
      throw new ServiceUnavailableException();
    });
    await expect(f.service.options('clerk', 'company')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.product.findMany).not.toHaveBeenCalled();
  });
  test('exact name/SKU/barcode results precede partial matches without consuming more than 30 slots', async () => {
    const f = fixture();
    f.product.findMany
      .mockResolvedValueOnce([{ id: 'exact', sku: 'T' }])
      .mockResolvedValueOnce([{ id: 'partial', sku: 'TT' }]);
    expect(await f.service.options('clerk', 'company', ' T ')).toEqual({
      items: [
        { id: 'exact', sku: 'T' },
        { id: 'partial', sku: 'TT' },
      ],
    });
    expect(f.product.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        entityId: 'company',
        isActive: true,
        OR: [
          { name: { equals: 'T', mode: 'insensitive' } },
          { sku: { equals: 'T', mode: 'insensitive' } },
          { barcode: { equals: 'T', mode: 'insensitive' } },
        ],
      },
      take: 30,
    });
    expect(f.product.findMany.mock.calls[1][0]).toMatchObject({
      where: {
        id: { notIn: ['exact'] },
        OR: [
          { name: { contains: 'T', mode: 'insensitive' } },
          { sku: { contains: 'T', mode: 'insensitive' } },
          { barcode: { contains: 'T', mode: 'insensitive' } },
        ],
      },
      take: 29,
    });
  });
  test('a full exact page makes no second query and oversized search reads no products', async () => {
    const f = fixture();
    f.product.findMany.mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, index) => ({ id: String(index) })),
    );
    expect(
      (await f.service.options('clerk', 'company', 'T')).items,
    ).toHaveLength(30);
    expect(f.product.findMany).toHaveBeenCalledTimes(1);
    f.product.findMany.mockClear();
    await expect(
      f.service.options('clerk', 'company', 'x'.repeat(101)),
    ).rejects.toThrow('100');
    expect(f.product.findMany).not.toHaveBeenCalled();
  });
});
