import { BadRequestException } from '@nestjs/common';
import { publicDisplayMetadata, publishedPublicDisplay } from './after-sales-public-display.contract';
import { ProductService } from './product.service';
import { PrismaService } from '../../common/prisma/prisma.service';
describe('controlled after-sales display metadata writes', () => {
  const display = { version: 1, published: true, brands: ['MOZTECH'], aliases: [' 別名 ', '別名'] };
  it('defaults unconfigured/legacy products to private and requires explicit brand publication', () => {
    for (const value of [undefined, {}, null, { ...display, published: false }, { ...display, brands: ['BONSON'] }]) expect(publishedPublicDisplay(value, 'MOZTECH')).toBeNull();
    expect(publicDisplayMetadata(display)).toEqual({ ...display, aliases: ['別名'] });
    expect(publishedPublicDisplay(display, 'MOZTECH')?.published).toBe(true);
    expect(publicDisplayMetadata({ version: 1, published: false, brands: [] })).toEqual({ version: 1, published: false, brands: [], aliases: [] });
    expect(publicDisplayMetadata({ version: 1, published: true, brands: ['BONSON'] })).toEqual({ version: 1, published: true, brands: ['BONSON'], aliases: [] });
  });
  it.each([{ ...display, version: 2 }, { ...display, brands: [] }, { ...display, brands: ['MOZTECH', 'MOZTECH'] }, { ...display, brands: ['OTHER'] },
    { ...display, stock: 9 }, { ...display, cost: 99 }, { ...display, aliases: [''] }, { ...display, aliases: ['x'.repeat(81)] },
    ...['http://images.example.com/a.png', 'https://127.0.0.1/a.png', 'https://metadata.google.internal/a.png',
      'https://localhost./a.png', 'https://metadata.google.internal./a.png', 'https://foo.local./a.png', 'https://user:secret@images.example.com/a.png',
      'https://images.example.com/a.png#secret'].map(imageUrl => ({ ...display, imageUrl }))])('rejects unsafe or unrelated metadata before product writes %#', async metadata => {
    const db = { $transaction: jest.fn(), product: { findUnique: jest.fn(), create: jest.fn() } };
    const service = new ProductService(db as unknown as PrismaService);
    await expect(service.update('COMPANY', 'PRODUCT', { attributes: { afterSalesPublicDisplay: metadata } })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
    await expect(service.create('COMPANY', { name: 'name', sku: 'sku', barcode: '4710000000000', attributes: { afterSalesPublicDisplay: metadata } })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.product.findUnique).not.toHaveBeenCalled();
  });
  it('keeps existing JSON attributes, SN profile and product finances when only the display metadata changes', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'P', attributes: { supplier: 'original', warranty: { unknown: true }, snLabels: { color: 'black' } } }]),
      product: { update: jest.fn().mockResolvedValue({ id: 'P' }) } };
    const service = new ProductService({ $transaction: async fn => fn(tx) } as unknown as PrismaService);
    await service.update('COMPANY', 'P', { attributes: { afterSalesPublicDisplay: display } });
    expect(tx.product.update.mock.calls[0][0]).toEqual({ where: { id: 'P' }, data: { attributes: { supplier: 'original', warranty: { unknown: true }, snLabels: { color: 'black' }, afterSalesPublicDisplay: { ...display, aliases: ['別名'] } } } });
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['P', 'COMPANY']);
  });
});
