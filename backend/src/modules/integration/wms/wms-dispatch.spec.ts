import { prepareDispatch, WmsDispatchService } from './wms-dispatch.service';
import { createHash } from 'node:crypto';
const product = {
  id: 'p',
  type: 'SIMPLE',
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
  it.each(['BUNDLE', 'MANUFACTURED', 'SERVICE'])('rejects %s before dispatch instead of stranding a WMS handover', type => {
    expect(() => prepareDispatch({ ...order, items: [{ ...order.items[0], product: { ...product, type } }] }, 'company', { company: { p: 'TEST' } })).toThrow('只支援一般商品');
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

describe('Corely reservation evidence for WMS intake', () => {
  const movements = [
    {
      warehouseId: 'warehouse-1',
      productId: 'p',
      direction: 'RESERVE',
      quantity: 2,
    },
  ];
  const prisma = {
    salesOrder: { findFirst: jest.fn() },
    inventoryTransaction: { findMany: jest.fn() },
  };
  const bridge = { stations: jest.fn() };
  const dispatch = new WmsDispatchService(prisma as any, bridge as any, {
    WMS_DISPATCH_PRODUCT_BRANDS_JSON: JSON.stringify({ company: { p: 'TEST' } }),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    bridge.stations.mockResolvedValue(['dispatch']);
    prisma.salesOrder.findFirst.mockResolvedValue(order);
    prisma.inventoryTransaction.findMany.mockResolvedValue(movements);
  });

  it('includes the warehouse and exact held quantity in signed dispatch payload', async () => {
    const payload = await dispatch.preview('employee', 'company', 'order');
    expect(payload.items[0].productId).toBe('p');
    expect(payload.reservationReference).toEqual({
      salesOrderId: 'order',
      warehouseId: 'warehouse-1',
      quantitiesByProduct: [{ productId: 'p', quantity: 2 }],
    });
    expect(payload.sourceHash).toHaveLength(64);
  });

  it('rejects missing, short, released or already shipped reservations', async () => {
    for (const current of [
      [],
      [{ ...movements[0], quantity: 1 }],
      [...movements, { ...movements[0], direction: 'RELEASE', quantity: 1 }],
      [...movements, { ...movements[0], direction: 'OUT', quantity: 1 }],
    ]) {
      prisma.inventoryTransaction.findMany.mockResolvedValueOnce(current);
      await expect(dispatch.preview('employee', 'company', 'order')).rejects.toThrow();
    }
  });
});

it('returns a WMS prepick link only from the validated native intake receipt', async () => {
  const tx = {
    salesOrder: { findFirst: jest.fn().mockResolvedValue(order) },
    inventoryTransaction: { findMany: jest.fn().mockResolvedValue([{
      warehouseId: 'warehouse-1', productId: 'p', direction: 'RESERVE', quantity: 2,
    }]) },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const db = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    $executeRaw: jest.fn(),
  };
  const bridge = {
    stations: jest.fn().mockResolvedValue(['dispatch']),
    command: jest.fn().mockResolvedValue({
      source: 'wms', nativeIntakeId: 42, wmsOrderId: 9,
      workBarcode: 'WT0123456789ABCDEF01', batchId: 3, reservationAccepted: true,
    }),
  };
  const service = new WmsDispatchService(db as any, bridge as any, {
    WMS_DISPATCH_PRODUCT_BRANDS_JSON: JSON.stringify({ company: { p: 'TEST' } }),
    WMS_WORKSPACE_COMMANDS_ENABLED: 'true',
    WMS_WORKSPACE_URL: 'https://wms.example/',
  });
  const payload = await (service as any).prepare(tx, 'company', 'order');
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{
    payload_hash: digest, request_id: 'same-request', payload,
  }]);
  const receipt = await service.dispatch('employee', 'company', 'order', payload.sourceHash, 'same-request');
  expect(receipt.prepickUrl).toBe('https://wms.example/corely-intakes/42');
  expect(bridge.command).toHaveBeenCalledWith('employee', 'company', 'order', 'dispatch', 'dispatch', {
    requestId: 'same-request', order: payload,
  });
});
