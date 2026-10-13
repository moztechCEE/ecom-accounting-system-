/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Prisma } from '@prisma/client';
import { AfterSalesStockService } from './after-sales-stock.service';

describe('qualification shares the ordinary OUT stock locks', () => {
  const input = {
    entityId: 'company',
    productId: 'product',
    warehouseId: 'warehouse',
    kind: 'NEW',
    unitLabel: 'qualified-unit',
    sourceReference: 'formal-in',
    ownershipReference: 'company-owned',
    inspectionReference: 'inspection-passed',
  };
  let service: AfterSalesStockService;
  let tx: any, db: any;
  let events: string[];
  let labels: any[];
  let stock: { qtyOnHand: Prisma.Decimal };
  let serial: any;
  let onLock: ((kind: string) => void) | undefined;

  beforeEach(() => {
    events = [];
    labels = [];
    stock = { qtyOnHand: new Prisma.Decimal(2) };
    serial = {
      id: 'serial-id',
      entityId: 'company',
      productId: 'product',
      warehouseId: 'warehouse',
      serialNumber: 'SN-1',
      status: 'AVAILABLE',
    };
    onLock = undefined;
    const owner = {
      id: 'owner',
      isActive: true,
      mustChangePassword: false,
      inventoryDataScope: 'ENTITY',
      roles: [{ role: { code: 'SUPER_ADMIN', permissions: [] } }],
      employee: null,
      entityMemberships: [],
      effectivePermissions: [],
    };
    tx = {
      user: {
        findUnique: jest.fn(async () => {
          events.push('authority-read');
          return owner;
        }),
      },
      $queryRaw: jest.fn(async (parts: TemplateStringsArray) => {
        const sql = parts.join('?');
        const table = sql.match(/FROM (\w+)/)?.[1];
        events.push(`lock:${table}`);
        onLock?.(table!);
        return [];
      }),
      product: {
        findFirst: jest.fn(async () => {
          events.push('product-read');
          return {
            id: 'product',
            sku: 'SKU',
            name: 'Product',
            hasSerialNumbers: false,
          };
        }),
      },
      warehouse: {
        findFirst: jest.fn(async () => {
          events.push('warehouse-read');
          return { id: 'warehouse' };
        }),
      },
      inventorySnapshot: {
        findUnique: jest.fn(async () => {
          events.push('snapshot-read');
          return { ...stock };
        }),
        updateMany: jest.fn(),
      },
      inventorySerialNumber: {
        findFirst: jest.fn(async ({ where }) => {
          events.push('serial-read');
          return serial &&
            Object.entries(where).every(([key, value]) => serial[key] === value)
            ? { ...serial }
            : null;
        }),
        updateMany: jest.fn(),
      },
      afterSalesStockUnit: {
        count: jest.fn(async () => {
          events.push('capacity-read');
          return labels.filter((x) =>
            ['QUALIFIED', 'RESERVED'].includes(x.status),
          ).length;
        }),
        findFirst: jest.fn(async ({ where }) => {
          events.push('serial-qualification-read');
          return labels.find(
            (x) =>
              x.inventorySerialId === where.inventorySerialId &&
              where.status.in.includes(x.status),
          );
        }),
        create: jest.fn(async ({ data }) => {
          events.push('qualification-create');
          const label = {
            id: `unit-${labels.length + 1}`,
            status: 'QUALIFIED',
            ...data,
          };
          labels.push(label);
          return label;
        }),
      },
      inventoryTransaction: { create: jest.fn() },
    };
    db = { $transaction: jest.fn(async (fn) => fn(tx)) };
    service = new AfterSalesStockService(
      db,
      { validateUser: async () => owner } as any,
      {
        assertAccess: async () => ({ isSuperAdmin: true, scope: 'ENTITY' }),
      } as any,
      { get: () => 'false' } as any,
    );
  });

  test('takes the same product, warehouse, snapshot order before fresh reads', async () => {
    const label = await service.qualify('owner', input);
    expect(events).toEqual([
      'authority-read',
      'lock:products',
      'lock:warehouses',
      'lock:inventory_snapshots',
      'product-read',
      'warehouse-read',
      'snapshot-read',
      'capacity-read',
      'qualification-create',
    ]);
    expect(db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'Serializable',
    });
    expect(label.qualification).toEqual({
      sourceReference: 'formal-in',
      ownershipReference: 'company-owned',
      inspectionReference: 'inspection-passed',
      sku: 'SKU',
      name: 'Product',
      hasSerialNumbers: false,
      externalInventoryPosted: false,
    });
    expect(tx.inventorySnapshot.updateMany).not.toHaveBeenCalled();
    expect(tx.inventorySerialNumber.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  test('a stock reduction while acquiring the snapshot lock is reread and refused', async () => {
    onLock = (table) => {
      if (table === 'inventory_snapshots')
        stock.qtyOnHand = new Prisma.Decimal(0);
    };
    await expect(service.qualify('owner', input)).rejects.toThrow(
      '尚未正式入庫',
    );
    expect(tx.afterSalesStockUnit.create).not.toHaveBeenCalled();
    expect(events.indexOf('snapshot-read')).toBeGreaterThan(
      events.indexOf('lock:inventory_snapshots'),
    );
  });

  test('qualification capacity is counted again after the snapshot lock', async () => {
    onLock = (table) => {
      if (table === 'inventory_snapshots')
        labels.push({ status: 'QUALIFIED' }, { status: 'RESERVED' });
    };
    await expect(service.qualify('owner', input)).rejects.toThrow('標籤數');
    expect(tx.afterSalesStockUnit.create).not.toHaveBeenCalled();
  });

  test('serial lock follows snapshot and precedes both serial and duplicate reads', async () => {
    await service.qualify('owner', { ...input, serialNumber: ' SN-1 ' });
    const snapshotLock = events.indexOf('lock:inventory_snapshots');
    const serialLock = events.indexOf('lock:inventory_serial_numbers');
    expect(serialLock).toBeGreaterThan(snapshotLock);
    expect(events.indexOf('serial-read')).toBeGreaterThan(serialLock);
    expect(events.indexOf('serial-qualification-read')).toBeGreaterThan(
      serialLock,
    );
    const [parts, ...values] = tx.$queryRaw.mock.calls[3];
    expect(parts.join('?')).toContain('FOR UPDATE');
    expect(values).toEqual(['company', 'product', 'SN-1']);
    expect(labels[0]).toMatchObject({
      serialNumber: 'SN-1',
      inventorySerialId: 'serial-id',
    });
  });

  test.each(['SOLD', 'RESERVED'])(
    'fresh %s serial status cannot qualify',
    async (status) => {
      onLock = (table) => {
        if (table === 'inventory_serial_numbers') serial.status = status;
      };
      await expect(
        service.qualify('owner', { ...input, serialNumber: 'SN-1' }),
      ).rejects.toThrow('SN 未在可用庫存');
      expect(tx.afterSalesStockUnit.create).not.toHaveBeenCalled();
    },
  );

  test('fresh serial moved to another warehouse cannot qualify', async () => {
    onLock = (table) => {
      if (table === 'inventory_serial_numbers')
        serial.warehouseId = 'other-warehouse';
    };
    await expect(
      service.qualify('owner', { ...input, serialNumber: 'SN-1' }),
    ).rejects.toThrow('SN 未在可用庫存');
    expect(tx.afterSalesStockUnit.create).not.toHaveBeenCalled();
  });

  test('another qualification discovered after the serial lock prevents a duplicate SN', async () => {
    onLock = (table) => {
      if (table === 'inventory_serial_numbers')
        labels.push({
          inventorySerialId: 'serial-id',
          status: 'QUALIFIED',
        });
    };
    await expect(
      service.qualify('owner', { ...input, serialNumber: 'SN-1' }),
    ).rejects.toThrow('同一 SN');
    expect(tx.afterSalesStockUnit.create).not.toHaveBeenCalled();
  });

  test('two qualifiers serialized by a mocked snapshot mutex do not exceed one formal unit', async () => {
    stock.qtyOnHand = new Prisma.Decimal(1);
    let held = false;
    const waiters: Array<() => void> = [];
    db.$transaction.mockImplementation(async (fn) => {
      let ownsSnapshot = false;
      const scopedTx = {
        ...tx,
        $queryRaw: async (
          parts: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          if (parts.join('?').includes('FROM inventory_snapshots')) {
            if (held)
              await new Promise<void>((resolve) => waiters.push(resolve));
            else held = true;
            ownsSnapshot = true;
          }
          return tx.$queryRaw(parts, ...values);
        },
      };
      try {
        return await fn(scopedTx);
      } finally {
        if (ownsSnapshot) {
          const next = waiters.shift();
          if (next) next();
          else held = false;
        }
      }
    });
    const results = await Promise.allSettled([
      service.qualify('owner', { ...input, unitLabel: 'first' }),
      service.qualify('owner', { ...input, unitLabel: 'second' }),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect(labels).toHaveLength(1);
    expect(events.filter((x) => x === 'capacity-read')).toHaveLength(2);
  });

  test('fresh account revocation fails before any stock locks or qualification writes', async () => {
    tx.user.findUnique.mockResolvedValue({ isActive: false });
    await expect(service.qualify('owner', input)).rejects.toThrow('帳號已停用');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.afterSalesStockUnit.create).not.toHaveBeenCalled();
  });
});
