import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { MailroomOutboundStockService, type OutboundStockIssueInput, type OutboundStockProof } from './mailroom-outbound-stock.service';

const D = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value);
const REQUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = (): OutboundStockIssueInput => ({ actorId: 'warehouse-staff', entityId: 'company', orderId: 'order-1', requestId: REQUEST,
  sourceCaseId: 'source-case', caseType: 'RESHIPMENT', items: [{ unitId: 'unit-1', sourceCaseItemId: 'source-line',
    productId: 'product-1', warehouseId: 'warehouse-1', sku: 'SKU-1', quantity: 1 }] });
const matches = (row: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([key, value]) =>
  typeof value === 'object' && value !== null ? 'gte' in value ? row[key].gte(value.gte) : 'in' in value ? value.in.includes(row[key]) : false : row[key] === value);

function fixture() {
  const actor: any = { id: 'warehouse-staff', isActive: true, mustChangePassword: false, inventoryDataScope: 'ENTITY',
    employee: { id: 'employee', entityId: 'company', isActive: true, department: null }, entityMemberships: [],
    roles: [{ role: { code: 'WAREHOUSE', permissions: [{ permission: { resource: 'inventory', action: 'update' } }] } }] };
  const products: any[] = [{ id: 'product-1', entityId: 'company', sku: 'SKU-1', isActive: true, type: 'SIMPLE', hasSerialNumbers: false }];
  const warehouses: any[] = [{ id: 'warehouse-1', entityId: 'company', isActive: true }];
  const snapshot: any = { entityId: 'company', productId: 'product-1', warehouseId: 'warehouse-1', qtyOnHand: D(10), qtyAvailable: D(8), qtyAllocated: D(2) };
  const rows: any[] = [], serials: any[] = [], qualified: any[] = [];
  const tx: any = {
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) => {
      if (sql.join('').includes('pg_advisory_xact_lock'))
        throw new Error('P2010: PostgreSQL void cannot be deserialized');
      return [{ id: 'locked-row' }];
    }),
    $executeRaw: jest.fn(async (sql: TemplateStringsArray) => {
      expect(sql.join('')).toBe('SELECT pg_advisory_xact_lock(hashtext())');
      return 0;
    }),
    user: { findUnique: jest.fn(async ({ where }: any) => where.id === actor.id ? actor : null) },
    product: { findFirst: jest.fn(async ({ where }: any) => products.find(row => matches(row, where)) || null) },
    warehouse: { findFirst: jest.fn(async ({ where }: any) => warehouses.find(row => matches(row, where)) || null) },
    inventorySnapshot: {
      findUnique: jest.fn(async ({ where }: any) => matches(snapshot, where.entityId_warehouseId_productId) ? snapshot : null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!matches(snapshot, where)) return { count: 0 };
        snapshot.qtyOnHand = snapshot.qtyOnHand.minus(data.qtyOnHand.decrement);
        snapshot.qtyAvailable = snapshot.qtyAvailable.minus(data.qtyAvailable.decrement);
        return { count: 1 };
      }),
    },
    afterSalesStockUnit: { count: jest.fn(async ({ where }: any) => qualified.filter(row => matches(row, where)).length) },
    inventoryTransaction: {
      findMany: jest.fn(async ({ where }: any) => rows.filter(row => row.entityId === where.entityId && row.referenceType === where.referenceType
        && where.OR.some((clause: any) => clause.referenceId ? row.referenceId === clause.referenceId : row.reason?.includes(clause.reason.contains)))),
      create: jest.fn(async ({ data }: any) => { const row = { ...data, id: `out-${rows.length + 1}`, quantity: D(data.quantity) }; rows.push(row); return row; }),
    },
    inventorySerialNumber: {
      findFirst: jest.fn(async ({ where }: any) => serials.find(row => matches(row, where)) || null),
      updateMany: jest.fn(async ({ where, data }: any) => { const row = serials.find(row => matches(row, where)); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    },
  };
  const atomic = async <T>(action: () => Promise<T>) => {
    const oldSnapshot = { ...snapshot }, oldRows = rows.slice(), oldSerials = serials.map(row => ({ ...row }));
    try { return await action(); } catch (error) {
      Object.assign(snapshot, oldSnapshot); rows.splice(0, rows.length, ...oldRows); serials.splice(0, serials.length, ...oldSerials); throw error;
    }
  };
  const addSerial = () => {
    products[0].hasSerialNumbers = true;
    serials.push({ id: 'serial-1', entityId: 'company', productId: 'product-1', warehouseId: 'warehouse-1', serialNumber: 'SN-1', status: 'AVAILABLE', outboundRefId: null });
  };
  return { tx: tx as Prisma.TransactionClient & typeof tx, actor, products, warehouses, snapshot, rows, serials, qualified, atomic, addSerial };
}
const verifyInput = (original: OutboundStockIssueInput, items: OutboundStockProof[]) => ({ entityId: original.entityId, orderId: original.orderId,
  requestId: original.requestId, sourceCaseId: original.sourceCaseId, caseType: original.caseType, items });

describe('warehouse-only formal outbound stock boundary', () => {
  const service = new MailroomOutboundStockService();
  it.each(['RESHIPMENT', 'PRIVATE_PURCHASE', 'EXCHANGE_RETURN'] as const)('posts a positive OUT for %s and preserves other reservations', async caseType => {
    const f = fixture(), original = { ...input(), caseType };
    const result = await service.issue(f.tx, original);
    expect(f.tx.$executeRaw.mock.calls.map((args: unknown[]) => args[1])).toEqual([
      'company:outbound-order:order-1',
      `company:outbound-request:${REQUEST}`,
    ]);
    expect(result.duplicate).toBe(false);
    expect(result.items[0]).toMatchObject({ unitId: 'unit-1', sourceCaseItemId: 'source-line', postingId: 'out-1', quantity: 1, externalInventoryPosted: false });
    expect(f.snapshot.qtyOnHand.eq(9)).toBe(true); expect(f.snapshot.qtyAvailable.eq(7)).toBe(true); expect(f.snapshot.qtyAllocated.eq(2)).toBe(true);
    expect(f.rows.map(row => row.direction)).toEqual(['OUT']); expect(f.rows[0].quantity.eq(1)).toBe(true);
    expect(JSON.parse(f.rows[0].reason).requestId).toBe(REQUEST);
    expect(f.tx.$queryRaw.mock.calls.some((args: any[]) => args[0].join('').includes('inventory_snapshots') && args[0].join('').includes('FOR UPDATE'))).toBe(true);
  });
  it('expands multiple pieces into independent proof rows and atomically decrements the grouped amount', async () => {
    const f = fixture(), original = input();
    original.items.push({ ...original.items[0], unitId: 'unit-2' });
    const result = await service.issue(f.tx, original);
    expect(result.items.map(item => item.unitId)).toEqual(['unit-1', 'unit-2']);
    expect(f.tx.inventorySnapshot.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.inventorySnapshot.updateMany.mock.calls[0][0].data).toEqual({ qtyOnHand: { decrement: 2 }, qtyAvailable: { decrement: 2 } });
    expect(f.rows).toHaveLength(2); expect(f.rows.every(row => row.quantity.eq(1))).toBe(true);
  });
  it('replays only an identical complete batch without another deduction, including reordered input', async () => {
    const f = fixture(), original = input(); original.items.push({ ...original.items[0], unitId: 'unit-2' });
    const first = await service.issue(f.tx, original), replay = await service.issue(f.tx, { ...original, items: original.items.slice().reverse() });
    expect(replay).toEqual({ items: first.items, duplicate: true });
    expect(f.tx.inventorySnapshot.updateMany).toHaveBeenCalledTimes(1); expect(f.rows).toHaveLength(2);
  });
  it.each(['sku', 'sourceCaseItemId', 'productId', 'warehouseId', 'unitId', 'serialNumber'])('cannot replay with changed line %s', async key => {
    const f = fixture(), original = input(); await service.issue(f.tx, original);
    const changed = { ...original, items: [{ ...original.items[0], [key]: 'DIFFERENT' }] };
    await expect(service.issue(f.tx, changed)).rejects.toThrow('不一致');
    expect(f.rows).toHaveLength(1); expect(f.tx.inventorySnapshot.updateMany).toHaveBeenCalledTimes(1);
  });
  it.each(['requestId', 'orderId', 'sourceCaseId', 'caseType', 'actorId'])('cannot reuse posted request with changed batch %s', async key => {
    const f = fixture(), original = input(); await service.issue(f.tx, original);
    if (key === 'actorId') f.actor.id = 'other-warehouse-staff';
    const changed = { ...original, [key]: key === 'requestId' ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : key === 'caseType' ? 'PRIVATE_PURCHASE' : key === 'actorId' ? f.actor.id : 'changed-id' } as OutboundStockIssueInput;
    await expect(service.issue(f.tx, changed)).rejects.toThrow();
    expect(f.rows).toHaveLength(1); expect(f.tx.inventorySnapshot.updateMany).toHaveBeenCalledTimes(1);
  });
  it('rejects missing or added posting lines rather than deducting only a new line', async () => {
    const f = fixture(), original = input(); await service.issue(f.tx, original);
    await expect(service.issue(f.tx, { ...original, items: [...original.items, { ...original.items[0], unitId: 'unit-2' }] })).rejects.toThrow('不完整');
    expect(f.rows).toHaveLength(1);
  });
  it('posts actual available SN and readonly verification never writes another stock movement', async () => {
    const f = fixture(); f.addSerial(); const original = input(); original.items[0].serialNumber = 'SN-1';
    const result = await service.issue(f.tx, original);
    expect(f.serials[0]).toMatchObject({ status: 'SOLD', outboundRefType: 'AFTER_SALES_OUTBOUND', outboundRefId: result.items[0].postingId });
    f.tx.inventorySnapshot.updateMany.mockClear(); f.tx.inventoryTransaction.create.mockClear(); f.tx.inventorySerialNumber.updateMany.mockClear();
    expect(await service.verify(f.tx, verifyInput(original, result.items))).toEqual(result.items);
    expect(f.tx.inventorySnapshot.updateMany).not.toHaveBeenCalled(); expect(f.tx.inventoryTransaction.create).not.toHaveBeenCalled(); expect(f.tx.inventorySerialNumber.updateMany).not.toHaveBeenCalled();
  });
  it.each(['postingId', 'actorId', 'requestHash', 'schema', 'entityId', 'orderId', 'requestId', 'sourceCaseId', 'caseType', 'referenceType', 'externalInventoryPosted'])('rejects a changed stored proof %s', async key => {
    const f = fixture(), original = input(), result = await service.issue(f.tx, original);
    await expect(service.verify(f.tx, verifyInput(original, [{ ...result.items[0], [key]: 'changed' }]))).rejects.toThrow('回執');
    expect(f.rows).toHaveLength(1);
  });
  it.each(['direction', 'quantity', 'reason'])('rejects corrupt formal movement %s', async key => {
    const f = fixture(), original = input(), result = await service.issue(f.tx, original);
    f.rows[0][key] = key === 'quantity' ? D(-1) : key === 'reason' ? '{}' : 'ADJUST';
    await expect(service.verify(f.tx, verifyInput(original, result.items))).rejects.toThrow();
  });
  it('rejects missing required SN and duplicate physical or serial identities before writing', async () => {
    const f = fixture(); f.addSerial(); const original = input();
    await expect(service.issue(f.tx, original)).rejects.toThrow('SN');
    const piece = { ...original.items[0], serialNumber: 'SN-1' };
    await expect(service.issue(f.tx, { ...original, items: [piece, { ...piece }] })).rejects.toThrow('重複');
    await expect(service.issue(f.tx, { ...original, items: [piece, { ...piece, unitId: 'unit-2' }] })).rejects.toThrow('重複');
    expect(f.rows).toHaveLength(0);
  });
  it.each(['entityId', 'productId', 'warehouseId', 'status', 'outboundRefId'])('cannot take SN with wrong %s', async key => {
    const f = fixture(); f.addSerial(); const original = input(); original.items[0].serialNumber = 'SN-1'; f.serials[0][key] = 'OTHER';
    await expect(service.issue(f.tx, original)).rejects.toThrow('SN'); expect(f.rows).toHaveLength(0);
  });
  it('does not consume a tagged after-sales serial or use free balance covered by qualified units', async () => {
    const f = fixture(); f.addSerial(); f.qualified.push({ entityId: 'company', productId: 'product-1', warehouseId: 'warehouse-1', inventorySerialId: 'serial-1', status: 'QUALIFIED' });
    const original = input(); original.items[0].serialNumber = 'SN-1';
    await expect(service.issue(f.tx, original)).rejects.toThrow('SN'); expect(f.rows).toHaveLength(0);
    const nonSerial = fixture(); nonSerial.qualified.push(...Array.from({ length: 8 }, () => ({ entityId: 'company', productId: 'product-1', warehouseId: 'warehouse-1', status: 'QUALIFIED' })));
    await expect(service.issue(nonSerial.tx, input())).rejects.toThrow('不足'); expect(nonSerial.rows).toHaveLength(0);
  });
  it.each(['negative', 'inconsistent', 'reserved', 'nonfinite'])('rejects %s snapshot without ADJUST or negative stock', async issue => {
    const f = fixture();
    if (issue === 'negative') f.snapshot.qtyOnHand = D(-1);
    if (issue === 'inconsistent') f.snapshot.qtyOnHand = D(99);
    if (issue === 'reserved') { f.snapshot.qtyAvailable = D(0); f.snapshot.qtyAllocated = D(10); }
    if (issue === 'nonfinite') f.snapshot.qtyAvailable = D('NaN');
    await expect(service.issue(f.tx, input())).rejects.toThrow('不足'); expect(f.rows).toHaveLength(0);
  });
  it.each(['inactive-product', 'inactive-warehouse', 'wrong-company', 'nonphysical', 'wrong-sku'])('rejects %s product/warehouse', async problem => {
    const f = fixture();
    if (problem === 'inactive-product') f.products[0].isActive = false;
    if (problem === 'inactive-warehouse') f.warehouses[0].isActive = false;
    if (problem === 'wrong-company') f.products[0].entityId = 'other-company';
    if (problem === 'nonphysical') f.products[0].type = 'SERVICE';
    if (problem === 'wrong-sku') f.products[0].sku = 'OTHER-SKU';
    await expect(service.issue(f.tx, input())).rejects.toThrow(); expect(f.rows).toHaveLength(0);
  });
  it.each(['inactive', 'password', 'inactive-employee', 'company', 'scope', 'mailroom-only'])('requires fresh stock authority: %s', async problem => {
    const f = fixture();
    if (problem === 'inactive') f.actor.isActive = false;
    if (problem === 'password') f.actor.mustChangePassword = true;
    if (problem === 'inactive-employee') f.actor.employee.isActive = false;
    if (problem === 'company') f.actor.employee.entityId = 'other-company';
    if (problem === 'scope') f.actor.inventoryDataScope = 'SELF';
    if (problem === 'mailroom-only') f.actor.roles[0].role.permissions[0].permission.resource = 'mailroom';
    await expect(service.issue(f.tx, input())).rejects.toThrow(); expect(f.rows).toHaveLength(0);
  });
  it('rolls back the caller transaction if SN changes after validation', async () => {
    const f = fixture(); f.addSerial(); const original = input(); original.items[0].serialNumber = 'SN-1';
    f.tx.inventorySerialNumber.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.atomic(() => service.issue(f.tx, original))).rejects.toThrow('整筆');
    expect(f.snapshot.qtyOnHand.eq(10)).toBe(true); expect(f.snapshot.qtyAvailable.eq(8)).toBe(true); expect(f.rows).toHaveLength(0); expect(f.serials[0].status).toBe('AVAILABLE');
  });
  it.each([0, -1, 2, 1.5, Number.NaN])('rejects non-single-piece quantity %s', async quantity => {
    const f = fixture(), original = input(); (original.items[0] as any).quantity = quantity;
    await expect(service.issue(f.tx, original)).rejects.toThrow('數量一'); expect(f.rows).toHaveLength(0);
  });
});

describe('ordinary OUT preserves the required external stock policy', () => {
  let originalFlag: string | undefined;
  beforeEach(() => {
    originalFlag = process.env.AFTER_SALES_REQUIRE_EXTERNAL_STOCK;
    delete process.env.AFTER_SALES_REQUIRE_EXTERNAL_STOCK;
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AFTER_SALES_REQUIRE_EXTERNAL_STOCK;
    else process.env.AFTER_SALES_REQUIRE_EXTERNAL_STOCK = originalFlag;
  });

  it.each([undefined, 'false'])('allows only local OUT with external flag %s', async flag => {
    const config = { get: jest.fn(() => flag) };
    const service = new MailroomOutboundStockService(config as unknown as ConfigService);
    const f = fixture(), original = input();
    const result = await service.issue(f.tx, original);
    expect(result.items[0].externalInventoryPosted).toBe(false);
    expect(JSON.parse(f.rows[0].reason).externalInventoryPosted).toBe(false);
    expect(await service.verify(f.tx, verifyInput(original, result.items))).toEqual(result.items);
    expect(config.get).toHaveBeenCalledWith('AFTER_SALES_REQUIRE_EXTERNAL_STOCK');
    expect(f.tx.inventoryTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('required external confirmation blocks fresh preparation before any stock writer', async () => {
    const service = new MailroomOutboundStockService({ get: () => 'true' } as unknown as ConfigService);
    const f = fixture();
    await expect(service.issue(f.tx, input())).rejects.toThrow('外部正式庫存確認');
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    expect(f.tx.inventoryTransaction.findMany).not.toHaveBeenCalled();
    expect(f.tx.inventorySnapshot.updateMany).not.toHaveBeenCalled();
    expect(f.tx.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(f.tx.inventorySerialNumber.updateMany).not.toHaveBeenCalled();
    expect(f.snapshot.qtyOnHand.eq(10)).toBe(true);
  });

  it('required external confirmation refuses acceptance or dispatch of local proof', async () => {
    const f = fixture(), original = input();
    const result = await new MailroomOutboundStockService().issue(f.tx, original);
    f.tx.inventoryTransaction.findMany.mockClear();
    f.tx.inventorySnapshot.updateMany.mockClear();
    f.tx.inventoryTransaction.create.mockClear();
    const service = new MailroomOutboundStockService({ get: () => 'true' } as unknown as ConfigService);
    await expect(service.verify(f.tx, verifyInput(original, result.items))).rejects.toThrow('不能備貨或出貨');
    expect(f.tx.inventoryTransaction.findMany).not.toHaveBeenCalled();
    expect(f.tx.inventorySnapshot.updateMany).not.toHaveBeenCalled();
    expect(f.tx.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(f.rows).toHaveLength(1);
  });

  it('enabling policy blocks replay and dispatch without spending an existing OUT again', async () => {
    let required = 'false';
    const service = new MailroomOutboundStockService({ get: () => required } as unknown as ConfigService);
    const f = fixture(), original = input();
    const first = await service.issue(f.tx, original);
    required = 'true';
    await expect(service.issue(f.tx, original)).rejects.toThrow('外部確認');
    await expect(service.verify(f.tx, verifyInput(original, first.items))).rejects.toThrow('外部確認');
    expect(f.rows).toHaveLength(1);
    expect(f.tx.inventorySnapshot.updateMany).toHaveBeenCalledTimes(1);
    expect(f.snapshot.qtyOnHand.eq(9)).toBe(true);
    expect(f.rows[0].direction).toBe('OUT');
    expect(JSON.parse(f.rows[0].reason).externalInventoryPosted).toBe(false);
    required = 'false';
    expect(await service.issue(f.tx, original)).toEqual({ duplicate: true, items: first.items });
    expect(f.tx.inventorySnapshot.updateMany).toHaveBeenCalledTimes(1);
  });

  it('an optional-constructor caller still obeys the same process environment flag', async () => {
    process.env.AFTER_SALES_REQUIRE_EXTERNAL_STOCK = 'true';
    const f = fixture();
    await expect(new MailroomOutboundStockService().issue(f.tx, input())).rejects.toThrow('外部正式庫存確認');
    expect(f.tx.inventorySnapshot.updateMany).not.toHaveBeenCalled();
    expect(f.tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
});
