import { prepareDispatch } from './wms-dispatch.service';
const product = {
  id: 'p',
  entityId: 'company',
  isActive: true,
  sku: 'CABLE',
  name: 'Test',
  barcode: '123',
  hasSerialNumbers: false,
};
const order = {
  id: 'order',
  entityId: 'company',
  status: 'pending',
  shipments: [],
  updatedAt: '2026-09-11T00:00:00Z',
  items: [{ id: 'line', productId: 'p', qty: 2, product }],
};
describe('ERP canonical dispatch', () => {
  it('uses stored products and exact reviewed brand mapping', () => {
    const p = prepareDispatch(order, 'company', { company: { p: 'TEST' } });
    expect(p.items[0].quantity).toBe(2);
    expect(p.sourceHash).toHaveLength(64);
    expect(p.brand).toBe('TEST');
  });
  it('rejects cross-company, missing brand/barcode, serial downgrade and invalid quantities', () => {
    for (const bad of [
      { ...order, entityId: 'other' },
      { ...order, status: 'shipped' },
      { ...order, items: [] },
      { ...order, items: [{ ...order.items[0], qty: 1.5 }] },
      {
        ...order,
        items: [
          {
            ...order.items[0],
            product: { ...product, hasSerialNumbers: true },
          },
        ],
      },
      {
        ...order,
        items: [{ ...order.items[0], product: { ...product, barcode: null } }],
      },
    ])
      expect(() =>
        prepareDispatch(bad, 'company', { company: { p: 'TEST' } }),
      ).toThrow();
    expect(() => prepareDispatch(order, 'company', {})).toThrow();
  });
  it('changes snapshot checksum on authoritative item edits', () => {
    expect(
      prepareDispatch(order, 'company', { company: { p: 'TEST' } }).sourceHash,
    ).not.toBe(
      prepareDispatch(
        { ...order, items: [{ ...order.items[0], qty: 3 }] },
        'company',
        { company: { p: 'TEST' } },
      ).sourceHash,
    );
  });
});
