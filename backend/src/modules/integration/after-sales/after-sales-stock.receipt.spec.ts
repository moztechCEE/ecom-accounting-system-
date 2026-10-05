/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { AfterSalesStockService } from './after-sales-stock.service';
import { ReceiveReturnStockDto } from './after-sales-stock.dto';
import {
  physicalCustody,
  repairWorkflow,
} from '../../mailroom/repair-workflow.contract';
import {
  validateRefurbishedReturn,
  returnStockUnitId,
} from './after-sales-stock.contract';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const documents = () => ({
  repairInspection: {
    number: 'SYNTHETIC-I',
    status: 'SUBMITTED',
    revision: 2,
    data: {
      complaint: 'SYNTHETIC RETURN',
      reproduction: 'YES',
      testConditions: 'SYNTHETIC BENCH',
      diagnosis: 'SYNTHETIC CONTACT',
      causeStatus: 'CONFIRMED',
      plan: 'REPAIR',
      planNote: 'SYNTHETIC CLEAN',
      feeSuggestion: 'FREE',
      estimateNote: '',
      checks: [
        { name: 'power', result: 'PASS', observation: 'SYNTHETIC PASS' },
      ],
    },
  },
  repairReport: {
    number: 'SYNTHETIC-R',
    status: 'SUBMITTED',
    revision: 1,
    inspectionRevision: 2,
    data: {
      outcome: 'REPAIRED',
      workPerformed: 'SYNTHETIC CLEAN',
      parts: [],
      laborMinutes: 1,
      checks: [
        { name: 'power', result: 'PASS', observation: 'SYNTHETIC PASS' },
      ],
      qcResult: 'PASS',
      qcNotes: 'SYNTHETIC PASS',
      deliveredAccessories: 'SYNTHETIC COMPLETE',
    },
  },
});
describe('stock owner receives a qualified RETURN as a real one-piece IN', () => {
  let tx: any,
    service: AfterSalesStockService,
    source: any,
    owner: any,
    clerk: any,
    input: ReceiveReturnStockDto;
  let stored: any, serial: any;
  beforeEach(() => {
    owner = {
      id: uuid(1),
      name: 'SYNTHETIC STOCK OWNER',
      isActive: true,
      mustChangePassword: false,
      inventoryDataScope: 'ENTITY',
      employee: null,
      entityMemberships: [{ entityId: 'company' }],
      roles: [{ role: { code: 'ADMIN', permissions: [] } }],
      effectivePermissions: ['inventory:update'],
    };
    clerk = {
      ...owner,
      id: uuid(2),
      roles: [
        {
          role: {
            code: 'MAILROOM_OPERATOR',
            permissions: [
              { permission: { resource: 'mailroom', action: 'update' } },
            ],
          },
        },
      ],
      effectivePermissions: ['mailroom:update'],
    };
    source = {
      id: uuid(3),
      entityId: 'company',
      label: 'SYNTHETIC RETURN',
      productName: 'SYNTHETIC',
      sku: 'SYNTHETIC-SKU',
      serialNumber: 'SYNTHETIC-SN',
      version: 8,
      status: 'PENDING_WELFARE_STOCK',
      matchResult: 'MATCH',
      grade: 'C',
      location: 'SYNTHETIC CLERK AREA',
      custodianId: clerk.id,
      declared: {
        id: 'synthetic-source-line',
        quantity: 1,
        sku: 'SYNTHETIC-SKU',
      },
      repairWorkflow: { schema: 1 },
      ...documents(),
      receipt: {
        id: uuid(4),
        category: 'RETURN',
        sourceCaseId: 'synthetic-source-case',
        receivedById: uuid(20),
        sourceNumber: 'SYNTHETIC-RETURN',
      },
    };
    input = {
      entityId: 'company',
      sourceItemId: source.id,
      productId: uuid(5),
      warehouseId: uuid(6),
      requestId: uuid(7),
      expectedVersion: 8,
      quantity: 1,
      confirmedItems: true,
      sourceLocation: source.location,
      location: 'SYNTHETIC STOCK AREA',
      unitLabel: 'SYNTHETIC UNIT',
      serialNumber: source.serialNumber,
      ownershipReference: 'SYNTHETIC COMPANY OWNED',
      inspectionReference: 'SYNTHETIC I2/R1',
    };
    stored = null;
    serial = null;
    tx = {
      $queryRaw: jest.fn(async () => []),
      $executeRaw: jest.fn(),
      $transaction: jest.fn(async (fn) => fn(tx)),
      user: {
        findUnique: jest.fn(async ({ where }) =>
          where.id === owner.id ? owner : clerk,
        ),
        findUniqueOrThrow: jest.fn(async () => owner),
      },
      product: {
        findFirst: jest.fn(async () => ({
          id: input.productId,
          sku: source.sku,
          name: 'SYNTHETIC',
          hasSerialNumbers: true,
          type: 'SIMPLE',
        })),
      },
      warehouse: {
        findFirst: jest.fn(async () => ({ id: input.warehouseId })),
      },
      mailroomItem: {
        findFirst: jest.fn(async () => source),
        update: jest.fn(async ({ data }) => {
          source = { ...source, ...data, version: source.version + 1 };
          return source;
        }),
      },
      afterSalesStockUnit: {
        findUnique: jest.fn(async () => stored),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }) => {
          stored = data;
          return stored;
        }),
      },
      inventoryTransaction: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }) => ({ ...data, id: uuid(8) })),
      },
      inventorySnapshot: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(),
      },
      inventorySerialNumber: {
        findFirst: jest.fn(async () => serial),
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async ({ data }) => ({ ...data, id: uuid(9) })),
      },
      mailroomAction: { create: jest.fn() },
      mailroomTask: { updateMany: jest.fn() },
    };
    service = new AfterSalesStockService(
      tx,
      { validateUser: async () => owner } as any,
      {
        assertAccess: async () => ({ scope: 'ENTITY', isSuperAdmin: false }),
      } as any,
      { get: () => 'false' } as any,
    );
  });
  test('one IN, AVAILABLE SN, snapshot +1, qualified unit and real custody/history share one transaction', async () => {
    const result = await service.receiveReturn(owner.id, input);
    expect(result).toMatchObject({
      duplicate: false,
      unit: { kind: 'REFURBISHED', sourceItemId: input.sourceItemId },
      inbound: {
        inTransactionId: uuid(8),
        inspectionRevision: 2,
        reportRevision: 1,
        fromCustodianId: clerk.id,
        toCustodianId: owner.id,
        quantity: 1,
        externalInventoryPosted: false,
      },
    });
    expect(tx.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'Serializable',
    });
    expect(tx.inventoryTransaction.create.mock.calls[0][0].data).toMatchObject({
      direction: 'IN',
      quantity: 1,
      referenceType: 'AFTER_SALES_RETURN',
      referenceId: input.sourceItemId,
    });
    expect(tx.inventorySnapshot.upsert.mock.calls[0][0].update).toEqual({
      qtyOnHand: { increment: 1 },
      qtyAvailable: { increment: 1 },
    });
    expect(tx.inventorySerialNumber.create.mock.calls[0][0].data).toMatchObject(
      {
        status: 'AVAILABLE',
        serialNumber: input.serialNumber,
        inboundRefId: uuid(8),
      },
    );
    expect(source).toMatchObject({
      status: 'STOCKED',
      version: 9,
      custodianId: owner.id,
      location: input.location,
    });
    expect(physicalCustody(source)).toBe('INVENTORY');
    expect(
      repairWorkflow(source.repairWorkflow).inventoryReceipt,
    ).toMatchObject({ inTransactionId: uuid(8), toCustodianId: owner.id });
    expect(tx.mailroomAction.create.mock.calls[0][0].data).toMatchObject({
      action: 'after_sales_stock_received',
      fromStatus: 'PENDING_WELFARE_STOCK',
      toStatus: 'STOCKED',
      version: 9,
      snapshot: {
        repairInspection: { revision: 2 },
        repairReport: { revision: 1 },
      },
    });
  });
  test('exact retry returns original IN despite changed version/custodian; changed body or key cannot add stock', async () => {
    const first = await service.receiveReturn(owner.id, input);
    const replay = await service.receiveReturn(owner.id, input);
    expect(replay.duplicate).toBe(true);
    expect(replay.inbound.inTransactionId).toBe(first.inbound.inTransactionId);
    await expect(
      service.receiveReturn(owner.id, {
        ...input,
        location: 'SYNTHETIC OTHER',
      }),
    ).rejects.toThrow('重試不可變更');
    await expect(
      service.receiveReturn(owner.id, { ...input, requestId: uuid(10) }),
    ).rejects.toThrow('重試不可變更');
    expect(tx.inventoryTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.inventorySnapshot.upsert).toHaveBeenCalledTimes(1);
  });
  test('ordinary technician and SELF stock scope cannot receive even their own repair item', async () => {
    owner.roles = [];
    owner.effectivePermissions = ['repair_workbench:update'];
    await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
      '售後庫存權限',
    );
    expect(tx.$transaction).not.toHaveBeenCalled();
    owner.effectivePermissions = ['inventory:update'];
    service = new AfterSalesStockService(
      tx,
      { validateUser: async () => owner } as any,
      { assertAccess: async () => ({ scope: 'SELF' }) } as any,
      {} as any,
    );
    await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
      '售後庫存權限',
    );
  });
  test.each([
    'revoked',
    'foreign',
    'self',
    'clerk-revoked',
    'clerk-foreign',
    'clerk-no-permission',
  ])('fresh actor/clerk gate rejects %s without IN', async (which) => {
    if (which === 'revoked') owner.isActive = false;
    if (which === 'foreign') owner.entityMemberships = [];
    if (which === 'self') owner.inventoryDataScope = 'SELF';
    if (which === 'clerk-revoked') clerk.isActive = false;
    if (which === 'clerk-foreign') clerk.entityMemberships = [];
    if (which === 'clerk-no-permission') clerk.roles = [];
    await expect(service.receiveReturn(owner.id, input)).rejects.toThrow();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  test.each([
    'stale',
    'location',
    'quantity',
    'unconfirmed',
    'declared-many',
    'repair-case',
    'not-returned',
    'mismatch',
    'FAIL',
    'old-report',
    'draft',
    'only-grade',
    'wrong-sku',
    'wrong-sn',
    'no-sn',
  ])(
    'identity, physical receipt and full current QC reject %s before inventory writes',
    async (which) => {
      if (which === 'stale') input.expectedVersion--;
      if (which === 'location') input.sourceLocation = 'SYNTHETIC OLD LOCATION';
      if (which === 'quantity') input.quantity = 2;
      if (which === 'unconfirmed') input.confirmedItems = false;
      if (which === 'declared-many') source.declared.quantity = 2;
      if (which === 'repair-case') source.receipt.category = 'REPAIR';
      if (which === 'not-returned') source.status = 'WAITING_RETURN_ACCEPTANCE';
      if (which === 'mismatch') source.matchResult = 'MISMATCH';
      if (which === 'FAIL') source.repairReport.data.qcResult = 'FAIL';
      if (which === 'old-report') source.repairReport.inspectionRevision = 1;
      if (which === 'draft') source.repairInspection.status = 'DRAFT';
      if (which === 'only-grade') {
        source.grade = 'AA';
        source.repairReport = null;
      }
      if (which === 'wrong-sku') source.declared.sku = 'SYNTHETIC WRONG';
      if (which === 'wrong-sn') input.serialNumber = 'SYNTHETIC WRONG';
      if (which === 'no-sn') {
        delete input.serialNumber;
        source.serialNumber = null;
      }
      await expect(service.receiveReturn(owner.id, input)).rejects.toThrow();
      expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
      expect(tx.inventorySnapshot.upsert).not.toHaveBeenCalled();
    },
  );
  test.each(['AVAILABLE', 'SOLD', 'RESERVED', 'RETURNED'])(
    'existing foreign-product SN in status %s cannot be counted as returned stock',
    async (status) => {
      serial = {
        status,
        productId: 'SYNTHETIC OTHER PRODUCT',
        warehouseId: 'SYNTHETIC OTHER WAREHOUSE',
      };
      await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
        '不可重複入庫',
      );
      expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
    },
  );
  test.each(['SOLD', 'RETURNED', 'DEFECTIVE'])(
    'same-product %s SN is received with prior movement references preserved',
    async (status) => {
      serial = {
        id: uuid(66),
        entityId: 'company',
        productId: input.productId,
        warehouseId: uuid(67),
        serialNumber: input.serialNumber,
        status,
        inboundRefType: 'PURCHASE_ORDER',
        inboundRefId: 'SYNTHETIC ORIGINAL PURCHASE',
        outboundRefType: 'SALES_ORDER',
        outboundRefId: 'SYNTHETIC ORIGINAL SALE',
      };
      const result = await service.receiveReturn(owner.id, input);
      expect(result.inbound.previousSerial).toMatchObject({
        status,
        outboundRefId: 'SYNTHETIC ORIGINAL SALE',
        inboundRefId: 'SYNTHETIC ORIGINAL PURCHASE',
      });
      expect(tx.inventorySerialNumber.create).not.toHaveBeenCalled();
      expect(
        tx.inventorySerialNumber.updateMany.mock.calls[0][0],
      ).toMatchObject({
        where: { id: serial.id, status },
        data: {
          status: 'AVAILABLE',
          warehouseId: input.warehouseId,
          inboundRefId: uuid(8),
          outboundRefId: null,
          outboundRefType: null,
        },
      });
      expect(result.unit.inventorySerialId).toBe(serial.id);
      expect(
        tx.mailroomAction.create.mock.calls[0][0].data.snapshot.repairWorkflow
          .inventoryReceipt.previousSerial.outboundRefId,
      ).toBe('SYNTHETIC ORIGINAL SALE');
    },
  );
  test.each(['AVAILABLE', 'RESERVED'])(
    'same-product %s SN is already counted and cannot be received twice',
    async (status) => {
      serial = { id: uuid(66), productId: input.productId, status };
      await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
        '不可重複入庫',
      );
      expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
    },
  );
  test('active existing unit and RETURNED/DEFECTIVE on-hand balance are rejected', async () => {
    serial = {
      id: uuid(66),
      productId: input.productId,
      warehouseId: input.warehouseId,
      status: 'SOLD',
    };
    tx.afterSalesStockUnit.findFirst.mockResolvedValue({
      id: 'SYNTHETIC ACTIVE UNIT',
    });
    await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
      '有效合格',
    );
    tx.afterSalesStockUnit.findFirst.mockResolvedValue(null);
    serial.status = 'RETURNED';
    tx.inventorySnapshot.findUnique.mockResolvedValue({
      qtyOnHand: new Prisma.Decimal(1),
    });
    await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
      '原倉位',
    );
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  test('stable external single-piece key survives changed receipt, label and request', () => {
    const id = returnStockUnitId('company', 'synthetic-case', 'synthetic-line');
    expect(
      returnStockUnitId('company', 'synthetic-case', 'synthetic-line'),
    ).toBe(id);
    expect(
      returnStockUnitId('other-company', 'synthetic-case', 'synthetic-line'),
    ).not.toBe(id);
    expect(
      returnStockUnitId('company', 'synthetic-case', 'other-line'),
    ).not.toBe(id);
    expect(id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  });
  test('a second receipt for the same external single piece is denied', async () => {
    tx.$queryRaw.mockImplementation(async (sql) =>
      String(sql).includes('JOIN mailroom_items') ? [{ id: uuid(55) }] : [],
    );
    await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
      '其他收件',
    );
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  test('prior IN without a unit does not authorize another IN', async () => {
    tx.inventoryTransaction.findFirst.mockResolvedValue({
      id: 'SYNTHETIC OLD IN',
    });
    await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
      '已有正式入庫',
    );
    expect(tx.inventorySnapshot.upsert).not.toHaveBeenCalled();
  });
  test('a labeled nonserial return adds one real unit to other existing stock; replay cannot add again', async () => {
    source.serialNumber = null;
    delete input.serialNumber;
    tx.product.findFirst.mockResolvedValue({
      id: input.productId,
      sku: source.sku,
      type: 'SIMPLE',
      hasSerialNumbers: false,
    });
    tx.inventorySnapshot.findUnique.mockResolvedValue({
      qtyOnHand: new Prisma.Decimal(1),
      qtyAllocated: new Prisma.Decimal(0),
      qtyAvailable: new Prisma.Decimal(1),
    });
    const received = await service.receiveReturn(owner.id, input);
    expect(received.unit.serialNumber).toBeNull();
    expect(tx.inventorySerialNumber.create).not.toHaveBeenCalled();
    expect(received.unit.unitLabel).toBe(input.unitLabel);
    expect(tx.inventorySnapshot.upsert.mock.calls[0][0].update).toEqual({
      qtyOnHand: { increment: 1 },
      qtyAvailable: { increment: 1 },
    });
    expect((await service.receiveReturn(owner.id, input)).duplicate).toBe(true);
    expect(tx.inventoryTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.inventorySnapshot.upsert).toHaveBeenCalledTimes(1);
  });
  test('inconsistent prior formal balances fail closed', async () => {
    tx.inventorySnapshot.findUnique.mockResolvedValue({
      qtyOnHand: new Prisma.Decimal(1),
      qtyAllocated: new Prisma.Decimal(1),
      qtyAvailable: new Prisma.Decimal(1),
    });
    await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
      '餘額不一致',
    );
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  test('missing unit insert propagates transaction failure before custody/history; no success response', async () => {
    tx.afterSalesStockUnit.create.mockRejectedValue(
      new Error('SYNTHETIC WRITE FAILURE'),
    );
    await expect(service.receiveReturn(owner.id, input)).rejects.toThrow(
      'SYNTHETIC WRITE FAILURE',
    );
    expect(tx.mailroomItem.update).not.toHaveBeenCalled();
    expect(tx.mailroomAction.create).not.toHaveBeenCalled();
  });
  test('DTO rejects quantities above one and unconfirmed physical receipt', async () => {
    expect(
      await validate(Object.assign(new ReceiveReturnStockDto(), input)),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          Object.assign(new ReceiveReturnStockDto(), input, {
            quantity: 2,
            confirmedItems: false,
          }),
        )
      ).map((x) => x.property),
    ).toEqual(expect.arrayContaining(['quantity', 'confirmedItems']));
  });
  test('the shared validator uses linked inspection revision, not equal document revision', () => {
    expect(
      validateRefurbishedReturn(source, source.sku, source.serialNumber),
    ).toEqual({ inspectionRevision: 2, reportRevision: 1 });
    source.repairReport.inspectionRevision = 1;
    expect(() =>
      validateRefurbishedReturn(source, source.sku, source.serialNumber),
    ).toThrow('同版');
  });
});
