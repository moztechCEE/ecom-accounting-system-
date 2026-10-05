/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Prisma } from '@prisma/client';
import { AfterSalesStockService } from './after-sales-stock.service';
describe('formal replacement posting and replay boundaries', () => {
  let tx: any, service: AfterSalesStockService, row: any;
  const invoke = (sn?: string, sku = 'SKU', kind = 'NEW') =>
    service.consumeForRepair(
      tx,
      'company',
      { id: 'item' },
      'tech',
      'request',
      sn,
      sku,
      kind,
    );
  beforeEach(() => {
    row = {
      id: 'reservation',
      entityId: 'company',
      itemId: 'item',
      status: 'RESERVED',
      expiresAt: new Date(Date.now() + 60000),
      externalStatus: 'NOT_CONFIGURED',
      unit: {
        id: 'unit',
        productId: 'product',
        warehouseId: 'warehouse',
        kind: 'NEW',
        serialNumber: null,
        unitLabel: 'unit-label',
        inventorySerialId: null,
      },
    };
    tx = {
      $queryRaw: jest.fn(),
      product: {
        findFirst: jest.fn(async () => ({
          sku: 'SKU',
          hasSerialNumbers: false,
        })),
      },
      afterSalesStockReservation: {
        findFirst: jest.fn(async () => row),
        findUniqueOrThrow: jest.fn(async () => row),
        update: jest.fn(async ({ data }) => Object.assign(row, data)),
      },
      inventorySnapshot: { updateMany: jest.fn(async () => ({ count: 1 })) },
      inventoryTransaction: {
        create: jest.fn(async ({ data }) => ({ id: data.direction, data })),
      },
      inventorySerialNumber: {
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      afterSalesStockUnit: { update: jest.fn() },
    };
    service = new AfterSalesStockService(
      tx,
      {} as any,
      {} as any,
      { get: () => 'false' } as any,
    );
  });
  test('nonserial replacement consumes one unit; replay does not spend it twice', async () => {
    const proof = await invoke();
    expect(proof).toMatchObject({
      status: 'POSTED',
      postingId: 'OUT',
      unitLabel: 'unit-label',
      replacementSN: null,
    });
    expect(
      tx.inventoryTransaction.create.mock.calls.map(([a]) => a.data.direction),
    ).toEqual(['RELEASE', 'OUT']);
    expect(tx.inventorySnapshot.updateMany.mock.calls[0][0].data).toEqual({
      qtyOnHand: { decrement: 1 },
      qtyAllocated: { decrement: 1 },
    });
    await invoke();
    expect(tx.inventorySnapshot.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryTransaction.create).toHaveBeenCalledTimes(2);
  });
  test.each(['wrong-sku', 'wrong-kind'])(
    'changed replacement %s cannot reuse posted proof',
    async (which) => {
      row.status = 'POSTED';
      await expect(
        invoke(
          undefined,
          which === 'wrong-sku' ? 'OTHER' : 'SKU',
          which === 'wrong-kind' ? 'REFURBISHED' : 'NEW',
        ),
      ).rejects.toThrow('不一致');
      expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
    },
  );
  test('wrong SN cannot spend a reserved unit', async () => {
    row.unit.serialNumber = 'ACTUAL';
    await expect(invoke('OTHER')).rejects.toThrow('SN');
    expect(tx.inventorySnapshot.updateMany).not.toHaveBeenCalled();
  });
  test('expired reservation is blocked', async () => {
    row.expiresAt = new Date(0);
    await expect(invoke()).rejects.toThrow('失效');
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  test('insufficient stock cannot create OUT', async () => {
    tx.inventorySnapshot.updateMany.mockResolvedValue({ count: 0 });
    await expect(invoke()).rejects.toThrow('餘額不足');
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  test('serial must still be RESERVED', async () => {
    row.unit.serialNumber = 'ACTUAL';
    row.unit.inventorySerialId = 'serial';
    tx.inventorySerialNumber.updateMany.mockResolvedValue({ count: 0 });
    await expect(invoke('ACTUAL')).rejects.toThrow('SN 庫存');
    expect(tx.afterSalesStockReservation.update).not.toHaveBeenCalled();
  });
  test('external posting requirement cannot pass local POSTED proof', async () => {
    row.status = 'POSTED';
    service = new AfterSalesStockService(
      tx,
      {} as any,
      {} as any,
      { get: () => 'true' } as any,
    );
    await expect(invoke()).rejects.toThrow('外部正式庫存');
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  test('formally returned STOCKED refurb unit needs its exact IN and current QC before OUT', async () => {
    const inbound = {
      inTransactionId: 'IN',
      unitId: 'unit',
      sourceItemId: 'return',
      quantity: 1,
      warehouseId: 'warehouse',
      toCustodianId: 'stock-owner',
      toLocation: 'stock-area',
      inspectionRevision: 2,
      reportRevision: 1,
    };
    row.unit.kind = 'REFURBISHED';
    row.unit.sourceItemId = 'return';
    row.unit.qualification = { inbound };
    const returned: any = {
      id: 'return',
      status: 'STOCKED',
      receipt: { category: 'RETURN' },
      sku: 'SKU',
      serialNumber: null,
      custodianId: 'stock-owner',
      location: 'stock-area',
      repairWorkflow: { inventoryReceipt: inbound },
      repairInspection: {
        status: 'SUBMITTED',
        revision: 2,
        data: {
          complaint: 'SYNTHETIC',
          testConditions: 'SYNTHETIC',
          diagnosis: 'SYNTHETIC',
          planNote: 'SYNTHETIC',
          plan: 'REPAIR',
          checks: [
            { name: 'SYNTHETIC', result: 'PASS', observation: 'SYNTHETIC' },
          ],
        },
      },
      repairReport: {
        status: 'SUBMITTED',
        revision: 1,
        inspectionRevision: 2,
        data: {
          outcome: 'REPAIRED',
          workPerformed: 'SYNTHETIC',
          qcNotes: 'SYNTHETIC',
          deliveredAccessories: 'SYNTHETIC',
          parts: [],
          qcResult: 'PASS',
          checks: [
            { name: 'SYNTHETIC', result: 'PASS', observation: 'SYNTHETIC' },
          ],
        },
      },
    };
    tx.mailroomItem = { findFirst: jest.fn(async () => returned) };
    tx.inventoryTransaction.findFirst = jest.fn(async () => null);
    await expect(invoke(undefined, 'SKU', 'REFURBISHED')).rejects.toThrow(
      '正式入庫流水',
    );
    tx.inventoryTransaction.findFirst.mockResolvedValue({
      quantity: new Prisma.Decimal(1),
    });
    returned.repairReport.inspectionRevision = 1;
    await expect(invoke(undefined, 'SKU', 'REFURBISHED')).rejects.toThrow(
      '同版',
    );
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
    returned.repairReport.inspectionRevision = 2;
    expect(await invoke(undefined, 'SKU', 'REFURBISHED')).toMatchObject({
      status: 'POSTED',
      postingId: 'OUT',
      quantity: 1,
    });
    await invoke(undefined, 'SKU', 'REFURBISHED');
    expect(tx.inventoryTransaction.create).toHaveBeenCalledTimes(2);
  });
  test('qualified labels cannot exceed formally on hand', async () => {
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
    const db: any = {
      ...tx,
      $transaction: async (fn) => fn(db),
      user: { findUnique: async () => owner },
      product: {
        findFirst: async () => ({
          id: 'product',
          sku: 'SKU',
          hasSerialNumbers: false,
        }),
      },
      warehouse: { findFirst: async () => ({ id: 'warehouse' }) },
      inventorySnapshot: {
        findUnique: async () => ({ qtyOnHand: new Prisma.Decimal(1) }),
      },
      afterSalesStockUnit: { count: async () => 1, create: jest.fn() },
    };
    service = new AfterSalesStockService(
      db,
      { validateUser: async () => owner } as any,
      {
        assertAccess: async () => ({ isSuperAdmin: true, scope: 'ENTITY' }),
      } as any,
      { get: () => 'false' } as any,
    );
    await expect(
      service.qualify('owner', {
        entityId: 'company',
        productId: 'product',
        warehouseId: 'warehouse',
        kind: 'NEW',
        unitLabel: '2nd',
        sourceReference: 'stock-in',
        ownershipReference: 'owned',
        inspectionReference: 'qc',
      }),
    ).rejects.toThrow('標籤數');
    expect(db.afterSalesStockUnit.create).not.toHaveBeenCalled();
  });
});
