import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthService } from '../../auth/auth.service';
import { EntityAccessService } from '../../../common/entity-access/entity-access.service';
import { serviceSignature } from './erp-module.contract';
import { ErpAfterSalesModuleService } from './erp-module.service';

describe('machine after-sales public catalog', () => {
  const company = 'SYNTHETIC-COMPANY', secret = 'synthetic-public-catalog-secret-at-least-32';
  const display = { version: 1, published: true, brands: ['MOZTECH'], aliases: ['行動電源'], displayName: '顧客用名稱' };
  const row = { id: '11111111-1111-4111-8111-111111111111', name: 'ERP名稱', sku: 'P01', modelNumber: 'M01', barcode: '4711234567890', display,
    salesPrice: '999', purchaseCost: '100', stock: 20 };
  let db: { $queryRaw: jest.Mock }, auth: { validateUser: jest.Mock }, service: ErpAfterSalesModuleService;
  const request = (query = 'entityId=' + company + '&brand=MOZTECH') => {
    const originalUrl = '/api/v1/after-sales/module/public-catalog?' + query, time = String(Math.floor(Date.now() / 1000));
    return { method: 'GET', originalUrl, headers: { 'x-erp-time': time, 'x-erp-entity': company, 'x-erp-actor': 'public-catalog',
      'x-erp-signature': serviceSignature(secret, 'GET', originalUrl, time, company, 'public-catalog') } as Record<string, string> };
  };
  beforeEach(() => {
    db = { $queryRaw: jest.fn().mockResolvedValue([row]) }; auth = { validateUser: jest.fn(() => { throw new Error('machine is not staff'); }) };
    service = new ErpAfterSalesModuleService(new ConfigService({ AFTER_SALES_MODULE_ENABLED: 'true', AFTER_SALES_MODULE_ENTITY_ID: company,
      AFTER_SALES_MODULE_SECRET: secret }), auth as unknown as AuthService, {} as EntityAccessService, db as unknown as PrismaService);
  });
  it('projects only approved public fields, with no image or private product facts invented', async () => {
    const result = await service.publicCatalog(request(), company);
    expect(result).toEqual({ contractVersion: 'corely.erp.after-sales-public-catalog.v1', complete: true, items: [{ id: row.id,
      name: '顧客用名稱', sku: row.sku, modelNumber: row.modelNumber, barcode: row.barcode, imageUrl: null, aliases: ['行動電源'] }] });
    expect(auth.validateUser).not.toHaveBeenCalled();
    const query = db.$queryRaw.mock.calls[0][0];
    expect(query.sql).toContain('p.is_active=true AND e.is_active=true');
    expect(query.sql).toContain("->'published'='true'::jsonb"); expect(query.values).toContain(company); expect(query.values).toContain('["MOZTECH"]');
    expect(query.values.at(-1)).toBe(21);
  });
  it.each(['entityId=' + company, 'entityId=' + company + '&brand=OTHER', 'entityId=' + company + '&brand=MOZTECH&brand=BONSON',
    'entityId=' + company + '&brand=MOZTECH&limit=21', 'entityId=' + company + '&brand=MOZTECH&limit=0',
    'entityId=' + company + '&brand=MOZTECH&ids=private', 'entityId=' + company + '&brand=MOZTECH&search=' + 'a'.repeat(101),
    'entityId=' + company + '&brand=MOZTECH&search=' + '%20'.repeat(101),
    'entityId=' + company + '&brand=MOZTECH&search=%0Aabc',
    'entityId=' + company + '&brand=MOZTECH&search=a&search=b'])('rejects invalid signed query before reading products: %s', async query => {
    await expect(service.publicCatalog(request(query), company)).rejects.toBeInstanceOf(BadRequestException); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('rejects missing, stale, wrong-actor/company, altered-query signatures and GET bodies before any database call', async () => {
    for (const mutate of [(r: ReturnType<typeof request>) => delete r.headers['x-erp-signature'],
      r => r.headers['x-erp-time'] = '1000000000', r => r.headers['x-erp-actor'] = 'staff-id',
      r => r.headers['x-erp-entity'] = 'FOREIGN', r => r.originalUrl += '&search=changed',
      r => r.headers['content-length'] = '1', r => r.headers['transfer-encoding'] = 'chunked', r => r.method = 'POST']) {
      const r = request(); mutate(r); await expect(service.publicCatalog(r, company)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(service.publicCatalog(request(), 'FOREIGN')).rejects.toBeInstanceOf(UnauthorizedException); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('does not expose unpublished, cross-brand or malformed legacy metadata even if a database adapter returns it', async () => {
    db.$queryRaw.mockResolvedValue([{ ...row, display: undefined }, { ...row, display: { ...display, published: false } },
      { ...row, display: { ...display, brands: ['BONSON'] } }, { ...row, display: { ...display, price: 50 } }]);
    expect((await service.publicCatalog(request(), company)).items).toEqual([]);
  });
  it('binds escaped alias search and truncation, rather than interpolating caller SQL or returning an unbounded catalog', async () => {
    db.$queryRaw.mockResolvedValue([row, row]); const input = "x%'_\\";
    const result = await service.publicCatalog(request('entityId=' + company + '&brand=MOZTECH&limit=1&search=' + encodeURIComponent(input)), company);
    expect(result.items).toHaveLength(1); expect(result.complete).toBe(false);
    const query = db.$queryRaw.mock.calls[0][0]; expect(query.sql).not.toContain(input); expect(query.values).toContain(input);
    expect(query.values).toContain('%x\\%\'\\_\\\\%'); expect(query.sql).toContain('jsonb_array_elements_text');
  });
  it('refuses oversized responses rather than leaking arbitrary large product fields', async () => {
    db.$queryRaw.mockResolvedValue([{ ...row, name: 'x'.repeat(270000), display: { ...display, displayName: '' } }]);
    await expect(service.publicCatalog(request(), company)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
