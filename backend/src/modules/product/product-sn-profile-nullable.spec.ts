import { ProductService } from './product.service';

describe('SN profile nullable EAN', () => {
  const body = {
    modelNumber: 'M1',
    style: '',
    color: '',
    modelCode: 'NSI',
    styleCode: '',
    colorCode: '',
  };
  function setup() {
    const db = { $executeRaw: jest.fn(async () => 1) };
    const service = new ProductService(db as any);
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'product',
      sku: 'ERP-SKU',
      barcode: null,
    } as any);
    return { db, service };
  }
  it.each([null, '', '   '])(
    'clears an explicitly empty EAN without substituting the product SKU (%s)',
    async (barcode) => {
      const { db, service } = setup();
      await service.updateSnProfile('company', 'product', { ...body, barcode });
      const values = (db.$executeRaw.mock.calls[0] as any).slice(1);
      expect(values[0]).toBe(true);
      expect(values[1]).toBeNull();
      expect(values.slice(-2)).toEqual(['product', 'company']);
      expect(values).not.toContain('ERP-SKU');
    },
  );
  it('preserves an omitted EAN and rejects an internal code presented as an EAN', async () => {
    const { db, service } = setup();
    await service.updateSnProfile('company', 'product', body);
    expect((db.$executeRaw.mock.calls[0] as any)[1]).toBe(false);
    db.$executeRaw.mockClear();
    await expect(
      service.updateSnProfile('company', 'product', {
        ...body,
        barcode: 'ITM-ERP-SKU',
      }),
    ).rejects.toThrow(/國際條碼/);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});
