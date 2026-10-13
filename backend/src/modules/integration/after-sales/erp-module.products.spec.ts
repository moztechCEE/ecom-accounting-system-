import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { EntityAccessService } from '../../../common/entity-access/entity-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthService } from '../../auth/auth.service';
import { serviceSignature } from './erp-module.contract';
import { ErpAfterSalesModuleService } from './erp-module.service';

describe('signed company product selection', () => {
  const company = 'synthetic-company', actor = 'synthetic-csr', secret = 'synthetic-only-service-secret-32-characters';
  let permissions: string[], database: { product: { findMany: jest.Mock } }, service: ErpAfterSalesModuleService;
  const request = (query = '') => {
    const path = `/api/v1/after-sales/module/actors/${actor}/products?entityId=${company}${query}`;
    const time = String(Math.floor(Date.now() / 1000));
    return { method: 'GET', originalUrl: path, headers: { 'x-erp-time': time, 'x-erp-entity': company, 'x-erp-actor': actor,
      'x-erp-signature': serviceSignature(secret, 'GET', path, time, company, actor) } };
  };
  beforeEach(() => {
    permissions = ['after_sales_cases:read'];
    const auth = { validateUser: jest.fn().mockImplementation(async () => ({ id: actor, email: 'synthetic@example.invalid', mustChangePassword: false,
      employee: { isActive: true }, roles: [], effectivePermissions: permissions })) };
    const access = { assertAccess: jest.fn().mockResolvedValue({ scope: 'ENTITY', isSuperAdmin: false }) };
    database = { product: { findMany: jest.fn().mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111', entityId: company,
      sku: 'REAL-SKU', name: 'Actual product', modelNumber: null, barcode: '4711234567890', salesPrice: new Prisma.Decimal('129.50'),
      updatedAt: new Date('2026-10-13T01:00:00Z'), entity: { baseCurrency: 'TWD' } }]) } };
    service = new ErpAfterSalesModuleService(new ConfigService({ AFTER_SALES_MODULE_ENABLED: 'true', AFTER_SALES_MODULE_ENTITY_ID: company,
      AFTER_SALES_MODULE_SECRET: secret }), auth as unknown as AuthService, access as unknown as EntityAccessService, database as unknown as PrismaService);
  });
  it('lets a case reader select active company products without granting product management or guessing warranty/SN', async () => {
    const result = await service.products(request('&search=471'), actor, company);
    expect(database.product.findMany.mock.calls[0][0].where).toMatchObject({ entityId: company, isActive: true });
    expect(result.items[0]).toMatchObject({ barcode: '4711234567890', unitPrice: '129.50', warrantyMonths: null, currency: 'TWD' });
    expect(result.items[0]).not.toHaveProperty('serialNumber');
    expect(result.items[0]).not.toHaveProperty('purchaseCost');
  });
  it.each(['&entityId=foreign', '&limit=51', '&limit=1&limit=2', '&ids=%5B%22bad%22%5D', '&extra=true'])('rejects invalid signed query %s before database access', async query => {
    await expect(service.products(request(query), actor, company)).rejects.toBeInstanceOf(BadRequestException);
    expect(database.product.findMany).not.toHaveBeenCalled();
  });
  it('rejects a body/path signature reused with a changed search', async () => {
    const req = request('&search=one'); req.originalUrl = req.originalUrl.replace('one', 'two');
    await expect(service.products(req, actor, company)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(database.product.findMany).not.toHaveBeenCalled();
  });
  it('rechecks revocation after reading products', async () => {
    database.product.findMany.mockImplementationOnce(async () => { permissions = ['after_sales_shipping:read']; return []; });
    await expect(service.products(request(), actor, company)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('reports truncation instead of claiming a complete product catalog', async () => {
    const row = (await database.product.findMany())[0]; database.product.findMany.mockResolvedValue([row, row]);
    const result = await service.products(request('&limit=1'), actor, company);
    expect(result.complete).toBe(false); expect(result.items).toHaveLength(1);
  });
});
