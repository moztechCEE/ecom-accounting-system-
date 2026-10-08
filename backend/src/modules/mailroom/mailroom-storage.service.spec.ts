/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Actor } from './mailroom.contract';
import { MailroomStorageService } from './mailroom-storage.service';
import {
  CreateStorageRackDto,
  MoveStorageItemDto,
  UpdateStorageLocationDto,
  UpdateStorageRackDto,
} from './mailroom-storage.dto';

describe('mailroom storage keeps location separate from custody and inventory', () => {
  let service: MailroomStorageService, db: any, mailroom: any;
  let racks: any[], locations: any[], items: any[], actions: any[];
  let currentActor: Actor;
  const actor = (
    permissions = ['mailroom:read', 'mailroom:update'],
  ): Actor => ({
    id: 'clerk',
    name: 'SYNTHETIC CLERK',
    entityIds: ['company-a'],
    permissions: new Set(permissions),
  });
  const item = (id: string, changes: Record<string, unknown> = {}) => ({
    id,
    entityId: 'company-a',
    receiptId: 'receipt-' + id,
    label: id,
    productName: 'SYNTHETIC PRODUCT ' + id,
    sku: 'SYNTHETIC-SKU',
    serialNumber: null,
    status: 'RECEIVED',
    storageLocationId: 'location-a',
    location: 'A1',
    custodianId: 'clerk',
    repairOwnerId: null,
    nextUserId: 'technician',
    version: 1,
    evidence: ['SYNTHETIC EVIDENCE'],
    repairWorkflow: null,
    receipt: {
      number: 'MR-' + id,
      sourceNumber: 'CASE-' + id,
      category: 'REPAIR',
    },
    ...changes,
  });
  const matches = (row: any, where: any) =>
    Object.entries(where || {}).every(([key, value]) => {
      if (value && typeof value === 'object' && 'has' in value)
        return row[key]?.includes(value.has);
      if (value && typeof value === 'object' && 'in' in value)
        return value.in.includes(row[key]);
      return row[key] === value;
    });
  const table = (
    rows: () => any[],
    defaults: Record<string, unknown> = {},
  ) => ({
    findMany: jest.fn(async ({ where }) =>
      rows().filter((row) => matches(row, where)),
    ),
    findFirst: jest.fn(
      async ({ where }) => rows().find((row) => matches(row, where)) || null,
    ),
    findFirstOrThrow: jest.fn(async ({ where }) => {
      const row = rows().find((row) => matches(row, where));
      if (!row) throw new Error('mock row missing');
      return row;
    }),
    create: jest.fn(async ({ data }) => {
      if (
        data.code &&
        rows().some(
          (row) =>
            row.entityId === data.entityId &&
            (row.code === data.code ||
              (data.rackId &&
                row.rackId === data.rackId &&
                row.level === data.level &&
                row.slot === data.slot)),
        )
      )
        throw new Prisma.PrismaClientKnownRequestError(
          'SYNTHETIC unique constraint',
          { code: 'P2002', clientVersion: 'SYNTHETIC' },
        );
      const row = {
        version: 1,
        isActive: true,
        commandKeys: [],
        commands: {},
        ...defaults,
        ...data,
      };
      rows().push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => {
      const row = rows().find((row) => row.id === where.id);
      Object.assign(row, data);
      return row;
    }),
  });
  const move = (
    requestId = 'move-request-01',
    changes: Partial<MoveStorageItemDto> = {},
  ): MoveStorageItemDto => ({
    entityId: 'company-a',
    requestId,
    expectedVersion: 1,
    storageLocationId: 'location-a',
    ...changes,
  });
  const rackRequest = (
    changes: Partial<CreateStorageRackDto> = {},
  ): CreateStorageRackDto => ({
    entityId: 'company-a',
    requestId: 'rack-create-01',
    code: 'B',
    name: '待寄架',
    zone: 'OUTBOUND',
    rows: 2,
    columns: 2,
    ...changes,
  });
  beforeEach(() => {
    currentActor = actor();
    racks = [
      {
        id: 'rack-a',
        entityId: 'company-a',
        code: 'A',
        name: '收件架',
        zone: 'RECEIVING',
        rows: 1,
        columns: 2,
        layoutX: 0,
        layoutY: 0,
        version: 1,
        isActive: true,
        commandKeys: [],
        commands: {},
      },
    ];
    locations = [
      {
        id: 'location-a',
        entityId: 'company-a',
        rackId: 'rack-a',
        code: 'A1',
        name: 'A1',
        level: 1,
        slot: 1,
        version: 1,
        isActive: true,
        commandKeys: [],
        commands: {},
      },
    ];
    items = [item('piece-a')];
    actions = [];
    mailroom = { enabled: jest.fn(), actor: jest.fn(async () => currentActor) };
    db = {
      mailroomStorageRack: table(() => racks, { layoutX: 0, layoutY: 0 }),
      mailroomStorageLocation: table(() => locations),
      mailroomItem: table(() => items),
      mailroomAction: {
        findUnique: jest.fn(
          async ({ where }) =>
            actions.find((entry) =>
              matches(entry, where.entityId_actorId_requestId),
            ) || null,
        ),
        create: jest.fn(async ({ data }) => {
          actions.push(structuredClone(data));
          return data;
        }),
      },
      user: {
        findMany: jest.fn(async () => [
          { id: 'clerk', name: 'SYNTHETIC CLERK' },
          { id: 'other', name: 'SYNTHETIC OTHER' },
        ]),
      },
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(async () => []),
      notification: { create: jest.fn() },
      mailroomTask: { create: jest.fn(), updateMany: jest.fn() },
      inventoryTransaction: { create: jest.fn() },
      mailroomDelivery: { create: jest.fn() },
    };
    db.$transaction = jest.fn(async (fn) => {
      const previous = structuredClone({ racks, locations, items, actions });
      try {
        return await fn(db);
      } catch (error) {
        ({ racks, locations, items, actions } = previous);
        throw error;
      }
    });
    service = new MailroomStorageService(db, mailroom);
  });
  afterEach(() => {
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(db.mailroomTask.create).not.toHaveBeenCalled();
    expect(db.mailroomTask.updateMany).not.toHaveBeenCalled();
    expect(db.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(db.mailroomDelivery.create).not.toHaveBeenCalled();
  });

  it.each(['entity', 'read'])(
    'rejects %s access before storage reads',
    async (kind) => {
      currentActor =
        kind === 'entity'
          ? { ...actor(), entityIds: ['company-b'] }
          : actor(['mailroom:update']);
      await expect(
        service.list('clerk', { entityId: 'company-a' }),
      ).rejects.toThrow(ForbiddenException);
      expect(db.mailroomStorageRack.findMany).not.toHaveBeenCalled();
      expect(db.mailroomItem.findMany).not.toHaveBeenCalled();
    },
  );
  it('does not expose company B racks, locations or occupants', async () => {
    racks.push({ ...racks[0], id: 'foreign-rack', entityId: 'company-b' });
    locations.push({
      ...locations[0],
      id: 'foreign-location',
      entityId: 'company-b',
    });
    items.push(
      item('foreign-piece', {
        entityId: 'company-b',
        storageLocationId: 'foreign-location',
      }),
    );
    const result = await service.list('clerk', { entityId: 'company-a' });
    expect(result.racks.map((row) => row.id)).toEqual(['rack-a']);
    expect(
      result.locations.flatMap((row) => row.items).map((row) => row.id),
    ).toEqual(['piece-a']);
    expect(result.counts).toEqual({ stored: 1, unassigned: 0 });
  });
  it.each([
    { status: 'COLLECTED' },
    { status: 'DISPATCHED' },
    { status: 'STOCKED' },
    { status: 'FACTORY_RECEIVED' },
    { status: 'FACTORY_OUTBOUND' },
    { status: 'FACTORY_RETURNING' },
    {
      status: 'REPAIRING',
      repairOwnerId: 'technician',
      custodianId: 'technician',
    },
    {
      status: 'RECEIVED',
      repairWorkflow: { schema: 1, factory: { physicalCustody: 'FACTORY' } },
    },
    { status: 'UNKNOWN_LEGACY_STATUS' },
    { status: 'RECEIVED', repairWorkflow: { malformed: true } },
  ])(
    'does not claim historical shelf occupation for $status / external custody',
    async (changes) => {
      items = [item('not-here', changes)];
      const result = await service.list('clerk', { entityId: 'company-a' });
      expect(result.locations[0].items).toEqual([]);
      expect(result.unassigned).toEqual([]);
      expect(result.counts).toEqual({ stored: 0, unassigned: 0 });
    },
  );
  it('keeps legacy free text unassigned even when it spells a shelf code', async () => {
    items = [item('legacy', { storageLocationId: null, location: 'A1' })];
    const result = await service.list('clerk', { entityId: 'company-a' });
    expect(result.locations[0].items).toEqual([]);
    expect(result.unassigned[0]).toMatchObject({
      id: 'legacy',
      location: 'A1',
      storageLocationId: null,
    });
  });
  it('search highlights matching goods without removing the rack layout or changing counts', async () => {
    items.push(item('other-piece'));
    const result = await service.list('clerk', {
      entityId: 'company-a',
      search: 'CASE-piece-a',
    });
    expect(result.racks).toHaveLength(1);
    expect(result.locations[0].items.map((row) => row.id)).toEqual(['piece-a']);
    expect(result.counts).toEqual({ stored: 2, unassigned: 0 });
  });
  it('returns move permission only for the current holder and never exposes command logs', async () => {
    items.push(item('other-piece', { custodianId: 'other' }));
    const result = await service.list('clerk', { entityId: 'company-a' });
    expect(result.locations[0].items.map((row) => row.canMove)).toEqual([
      true,
      false,
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /commandKeys|commands|requestHash/,
    );
    currentActor = actor(['mailroom:read']);
    const readOnly = await service.list('clerk', { entityId: 'company-a' });
    expect(readOnly.canManage).toBe(false);
    expect(readOnly.locations[0].items.every((row) => !row.canMove)).toBe(true);
  });
  it('creates an explicit grid once and replays the exact create response', async () => {
    const first = await service.createRack('clerk', rackRequest());
    expect(first).toMatchObject({
      rack: { code: 'B', rows: 2, columns: 2, zone: 'OUTBOUND' },
      duplicate: false,
    });
    expect(
      locations.slice(1).map((row) => [row.code, row.level, row.slot]),
    ).toEqual([
      ['B1', 1, 1],
      ['B2', 1, 2],
      ['B3', 2, 1],
      ['B4', 2, 2],
    ]);
    const repeated = await service.createRack('clerk', rackRequest());
    expect(repeated).toEqual({ ...first, duplicate: true });
    expect(db.mailroomStorageRack.create).toHaveBeenCalledTimes(1);
    expect(db.mailroomStorageLocation.create).toHaveBeenCalledTimes(4);
  });
  it('rejects reusing a committed setting key for different content or target', async () => {
    await service.createRack('clerk', rackRequest());
    await expect(
      service.createRack('clerk', rackRequest({ name: 'different' })),
    ).rejects.toThrow('內容不同');
    await expect(
      service.updateRack('clerk', 'rack-a', {
        entityId: 'company-a',
        requestId: 'rack-create-01',
        expectedVersion: 1,
        name: 'different',
      }),
    ).rejects.toThrow('內容不同');
    expect(db.mailroomStorageRack.create).toHaveBeenCalledTimes(1);
  });
  it('edits layout without moving, rewriting or notifying goods', async () => {
    const before = structuredClone(items);
    await service.updateRack('clerk', 'rack-a', {
      entityId: 'company-a',
      requestId: 'rack-layout-01',
      expectedVersion: 1,
      name: '新架名',
      layoutX: 400,
      layoutY: 80,
    });
    expect(racks[0]).toMatchObject({
      name: '新架名',
      layoutX: 400,
      layoutY: 80,
      version: 2,
    });
    expect(items).toEqual(before);
    expect(db.mailroomItem.update).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
  it.each(['rack', 'location'])(
    'prevents disabling an occupied %s',
    async (kind) => {
      const body = {
        entityId: 'company-a',
        requestId: 'disable-place-01',
        expectedVersion: 1,
        isActive: false,
      };
      const operation =
        kind === 'rack'
          ? service.updateRack('clerk', 'rack-a', body)
          : service.updateLocation('clerk', 'location-a', body);
      await expect(operation).rejects.toThrow('仍有物品');
      expect(racks[0].isActive).toBe(true);
      expect(locations[0].isActive).toBe(true);
    },
  );
  it('allows disabling a shelf after its historical goods have left', async () => {
    items[0].status = 'DISPATCHED';
    await service.updateLocation('clerk', 'location-a', {
      entityId: 'company-a',
      requestId: 'disable-empty-01',
      expectedVersion: 1,
      isActive: false,
    });
    expect(locations[0].isActive).toBe(false);
    expect(items[0].storageLocationId).toBe('location-a');
    expect(db.mailroomItem.update).not.toHaveBeenCalled();
  });
  it('cannot shrink a grid over existing locations', async () => {
    locations[0].slot = 2;
    await expect(
      service.updateRack('clerk', 'rack-a', {
        entityId: 'company-a',
        requestId: 'shrink-rack-01',
        expectedVersion: 1,
        columns: 1,
      }),
    ).rejects.toThrow('現有儲位');
    expect(racks[0].columns).toBe(2);
  });
  it('adds a custom location only to an active same-company empty coordinate', async () => {
    await service.createLocation('clerk', {
      entityId: 'company-a',
      requestId: 'new-location-01',
      rackId: 'rack-a',
      code: 'SPECIAL',
      name: '特殊格',
      level: 1,
      slot: 2,
    });
    expect(locations[1]).toMatchObject({
      code: 'SPECIAL',
      name: '特殊格',
      rackId: 'rack-a',
      level: 1,
      slot: 2,
    });
    racks.push({ ...racks[0], id: 'foreign', entityId: 'company-b' });
    await expect(
      service.createLocation('clerk', {
        entityId: 'company-a',
        requestId: 'new-location-02',
        rackId: 'foreign',
        code: 'FOREIGN',
        name: 'foreign',
        level: 1,
        slot: 1,
      }),
    ).rejects.toThrow('此公司');
    racks[0].isActive = false;
    await expect(
      service.createLocation('clerk', {
        entityId: 'company-a',
        requestId: 'new-location-03',
        rackId: 'rack-a',
        code: 'INACTIVE',
        name: 'inactive',
        level: 1,
        slot: 1,
      }),
    ).rejects.toThrow('已停用');
    expect(db.mailroomStorageLocation.create).toHaveBeenCalledTimes(1);
  });
  it.each(['location', 'rack'])(
    'rejects placing goods in an inactive %s',
    async (kind) => {
      (kind === 'rack' ? racks[0] : locations[0]).isActive = false;
      await expect(service.move('clerk', 'piece-a', move())).rejects.toThrow(
        '已停用',
      );
      expect(db.mailroomItem.update).not.toHaveBeenCalled();
      expect(actions).toEqual([]);
    },
  );
  it('rejects a foreign location and foreign item without modifying either company', async () => {
    locations.push({
      ...locations[0],
      id: 'foreign-location',
      entityId: 'company-b',
    });
    items.push(item('foreign-piece', { entityId: 'company-b' }));
    await expect(
      service.move(
        'clerk',
        'piece-a',
        move('move-foreign-01', { storageLocationId: 'foreign-location' }),
      ),
    ).rejects.toThrow('此公司');
    await expect(
      service.move('clerk', 'foreign-piece', move('move-foreign-02')),
    ).rejects.toThrow('此公司');
    expect(db.mailroomItem.update).not.toHaveBeenCalled();
  });
  it.each([
    { custodianId: 'other' },
    { status: 'REPAIRING', repairOwnerId: 'clerk' },
    { status: 'DISPATCHED' },
    { status: 'STOCKED' },
    { status: 'COLLECTED' },
  ])(
    'does not take goods from another holder or external custody',
    async (changes) => {
      Object.assign(items[0], changes);
      await expect(service.move('clerk', 'piece-a', move())).rejects.toThrow(
        '目前保管',
      );
      expect(db.mailroomItem.update).not.toHaveBeenCalled();
    },
  );
  it('moves only shelf and item version, records one audit, and replays exact key/body', async () => {
    items[0].storageLocationId = null;
    items[0].location = 'legacy shelf';
    const prior = structuredClone(items[0]);
    const first = await service.move('clerk', 'piece-a', move());
    expect(first).toMatchObject({
      item: {
        storageLocationId: 'location-a',
        location: 'A1',
        version: 2,
        canMove: true,
      },
      duplicate: false,
    });
    expect(items[0]).toEqual({
      ...prior,
      storageLocationId: 'location-a',
      location: 'A1',
      version: 2,
    });
    expect(actions[0]).toMatchObject({
      action: 'move_storage',
      fromStatus: 'RECEIVED',
      toStatus: 'RECEIVED',
      version: 2,
    });
    const repeated = await service.move('clerk', 'piece-a', move());
    expect(repeated).toEqual({ ...first, duplicate: true });
    expect(actions).toHaveLength(1);
    expect(db.mailroomItem.update).toHaveBeenCalledTimes(1);
    expect(
      db.$queryRaw.mock.calls.some(
        ([sql]) =>
          sql.sql.includes('mailroom_items') && sql.sql.includes('FOR UPDATE'),
      ),
    ).toBe(true);
  });
  it('rejects changed body for the same move key and version conflict for a new key', async () => {
    await service.move('clerk', 'piece-a', move());
    await expect(
      service.move(
        'clerk',
        'piece-a',
        move('move-request-01', { storageLocationId: null, location: 'other' }),
      ),
    ).rejects.toThrow('內容不同');
    await expect(
      service.move('clerk', 'piece-a', move('move-request-02')),
    ).rejects.toThrow('資料已更新');
    expect(db.mailroomItem.update).toHaveBeenCalledTimes(1);
  });
  it('explicitly unassigns goods with a real free-text position and preserves custody', async () => {
    await service.move(
      'clerk',
      'piece-a',
      move('move-to-desk-01', {
        storageLocationId: null,
        location: '行政桌旁',
      }),
    );
    expect(items[0]).toMatchObject({
      storageLocationId: null,
      location: '行政桌旁',
      custodianId: 'clerk',
      status: 'RECEIVED',
    });
    await expect(
      service.move(
        'clerk',
        'piece-a',
        move('move-to-desk-02', {
          expectedVersion: 2,
          storageLocationId: null,
          location: '  ',
        }),
      ),
    ).rejects.toThrow('存放位置');
  });
  it('rechecks permissions after item row-lock waiting and performs zero writes if revoked', async () => {
    db.$queryRaw.mockImplementation(async (sql) => {
      if (sql.sql.includes('mailroom_items'))
        currentActor = actor(['mailroom:read']);
      return [];
    });
    await expect(service.move('clerk', 'piece-a', move())).rejects.toThrow(
      ForbiddenException,
    );
    expect(db.mailroomItem.update).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
  it('rejects replays when the user no longer holds the goods or has lost company access', async () => {
    await service.move('clerk', 'piece-a', move());
    items[0].custodianId = 'other';
    await expect(service.move('clerk', 'piece-a', move())).rejects.toThrow(
      '目前保管',
    );
    currentActor = { ...actor(), entityIds: ['company-b'] };
    await expect(service.move('clerk', 'piece-a', move())).rejects.toThrow(
      '公司',
    );
    expect(db.mailroomItem.update).toHaveBeenCalledTimes(1);
  });
  it('setting writes and committed replays retain current authorization', async () => {
    await service.createRack('clerk', rackRequest());
    currentActor = actor(['mailroom:read']);
    await expect(service.createRack('clerk', rackRequest())).rejects.toThrow(
      ForbiddenException,
    );
    expect(db.mailroomStorageRack.create).toHaveBeenCalledTimes(1);
  });
  it.each(['rack', 'location'])(
    'rejects stale %s edits without changing configuration',
    async (kind) => {
      const body = {
        entityId: 'company-a',
        requestId: 'stale-place-01',
        expectedVersion: 2,
        name: 'stale name',
      };
      await expect(
        kind === 'rack'
          ? service.updateRack('clerk', 'rack-a', body)
          : service.updateLocation('clerk', 'location-a', body),
      ).rejects.toThrow('資料已更新');
      expect(db.mailroomStorageRack.update).not.toHaveBeenCalled();
      expect(db.mailroomStorageLocation.update).not.toHaveBeenCalled();
    },
  );
  it.each(['rack', 'location'])(
    'rechecks %s edit authorization after lock waiting',
    async (kind) => {
      db.$queryRaw.mockImplementation(async (sql) => {
        if (
          sql.sql.includes(
            kind === 'rack'
              ? 'mailroom_storage_racks'
              : 'mailroom_storage_locations',
          )
        )
          currentActor = actor(['mailroom:read']);
        return [];
      });
      const body = {
        entityId: 'company-a',
        requestId: 'revoke-edit-01',
        expectedVersion: 1,
        name: 'never save',
      };
      await expect(
        kind === 'rack'
          ? service.updateRack('clerk', 'rack-a', body)
          : service.updateLocation('clerk', 'location-a', body),
      ).rejects.toThrow(ForbiddenException);
      expect(db.mailroomStorageRack.update).not.toHaveBeenCalled();
      expect(db.mailroomStorageLocation.update).not.toHaveBeenCalled();
    },
  );
  it('replays a layout update without a second version bump', async () => {
    const input = {
      entityId: 'company-a',
      requestId: 'replay-layout-01',
      expectedVersion: 1,
      layoutX: 99,
    };
    const first = await service.updateRack('clerk', 'rack-a', input);
    const again = await service.updateRack('clerk', 'rack-a', input);
    expect(again).toEqual({ ...first, duplicate: true });
    expect(racks[0].version).toBe(2);
    expect(db.mailroomStorageRack.update).toHaveBeenCalledTimes(1);
  });
  it('blocks using a move key for settings or a setting key for a move', async () => {
    await service.move('clerk', 'piece-a', move('cross-operation-01'));
    await expect(
      service.createRack(
        'clerk',
        rackRequest({ requestId: 'cross-operation-01' }),
      ),
    ).rejects.toThrow('其他操作');
    await service.createRack(
      'clerk',
      rackRequest({ requestId: 'cross-operation-02' }),
    );
    await expect(
      service.move(
        'clerk',
        'piece-a',
        move('cross-operation-02', { expectedVersion: 2 }),
      ),
    ).rejects.toThrow('其他操作');
    expect(actions).toHaveLength(1);
  });
  it('rolls back a whole rack grid if a generated code collides with an existing location', async () => {
    locations.push({
      ...locations[0],
      id: 'existing-b2',
      code: 'B2',
      name: 'B2',
      slot: 2,
    });
    await expect(service.createRack('clerk', rackRequest())).rejects.toThrow(
      '已存在',
    );
    expect(racks.map((row) => row.code)).toEqual(['A']);
    expect(locations.map((row) => row.code)).toEqual(['A1', 'B2']);
    expect(actions).toEqual([]);
  });
  it('blocks duplicate coordinates and leaves the original location unchanged', async () => {
    await expect(
      service.createLocation('clerk', {
        entityId: 'company-a',
        requestId: 'duplicate-grid-01',
        rackId: 'rack-a',
        code: 'OTHER',
        name: 'other name',
        level: 1,
        slot: 1,
      }),
    ).rejects.toThrow('已存在');
    expect(locations.map((row) => row.code)).toEqual(['A1']);
  });
  it('rechecks authority after target shelf lock waiting before moving goods', async () => {
    db.$queryRaw.mockImplementation(async (sql) => {
      if (sql.sql.includes('mailroom_storage_locations'))
        currentActor = actor(['mailroom:read']);
      return [];
    });
    await expect(service.move('clerk', 'piece-a', move())).rejects.toThrow(
      ForbiddenException,
    );
    expect(db.mailroomItem.update).not.toHaveBeenCalled();
  });
  it('validates dimensions and refuses coerced string boolean active flags', () => {
    const options = { enableImplicitConversion: true };
    const wrongRack = plainToInstance(
      UpdateStorageRackDto,
      {
        entityId: 'company-a',
        requestId: 'boolean-test-01',
        expectedVersion: 1,
        isActive: 'false',
      },
      options,
    );
    const wrongLocation = plainToInstance(
      UpdateStorageLocationDto,
      {
        entityId: 'company-a',
        requestId: 'boolean-test-01',
        expectedVersion: 1,
        isActive: 'true',
      },
      options,
    );
    expect(
      validateSync(wrongRack).some((error) => error.property === 'isActive'),
    ).toBe(true);
    expect(
      validateSync(wrongLocation).some(
        (error) => error.property === 'isActive',
      ),
    ).toBe(true);
    expect(
      validateSync(
        plainToInstance(CreateStorageRackDto, rackRequest({ rows: 9 })),
      ).some((error) => error.property === 'rows'),
    ).toBe(true);
  });
});
