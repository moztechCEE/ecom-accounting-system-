import 'reflect-metadata';
import {
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'node:http';
import request from 'supertest';
import { B2bAwareJwtAuthGuard } from '../b2b/b2b-auth.guard';
import { B2bService } from '../b2b/b2b.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuthService } from '../auth/auth.service';
import { MailroomController } from './mailroom.controller';
import { MailroomIntakeService } from './mailroom-intake.service';
import { MailroomService } from './mailroom.service';
import type { MailroomQuery } from './mailroom.dto';
import {
  REPAIR_LIST_SCOPES,
  REPAIR_PHOTO_MAX_BYTES,
  repairConditions,
  repairOverview,
  repairPhoto,
} from './repair-list.contract';

const COMPANY = 'synthetic-company';
const USER = 'synthetic-technician';
const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const dataPhoto = (buffer = PNG, type = 'png') =>
  `data:image/${type};base64,${buffer.toString('base64')}`;
type PopulationFilter = {
  OR: [unknown, { OR: [{ status: { in: string[] } }, unknown] }];
};
type StatusFilter = { status: { in: string[] } };

function piece(
  id: string,
  category = 'REPAIR',
  status = 'INSPECTING',
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    entityId: COMPANY,
    label: 'MR-' + id,
    productName: id,
    sku: 'SKU-' + id,
    serialNumber: 'SN-' + id,
    status,
    version: 2,
    matchResult: 'MATCH',
    grade: null,
    disposition: null,
    conditionNote: null,
    returnInspection: null,
    repairInspection: null,
    repairReport: null,
    repairWorkflow: null,
    evidence: [dataPhoto()] as unknown,
    location: 'synthetic-shelf',
    custodianId: 'synthetic-clerk',
    nextUserId: null,
    repairOwnerId: null,
    recipientId: USER,
    receipt: {
      id: 'receipt-' + id,
      entityId: COMPANY,
      number: 'RECEIPT-' + id,
      category,
      sourceCaseId: ('source-' + id) as string | null,
      sourceNumber: 'CASE-' + id,
      sourceSnapshot: {
        id: 'source-' + id,
        type: category,
        customerLabel: 'Original Customer',
        customerPhone: '0912345678',
        financialNote: 'FINANCE_SECRET',
        attachments: [
          { fileUrl: 'https://example.invalid/PRIVATE_ATTACHMENT' },
        ],
      } as unknown,
      customerServiceUserId: null,
      carrier: null,
      trackingNumber: null,
      senderLabel: 'Courier Sender (not customer)',
      receivedAt: new Date('2026-10-08T00:00:00Z'),
      receivedById: 'synthetic-clerk',
    },
    ...extra,
  };
}

// Independent fixture filtering observes the production WHERE; expected queue
// membership below is explicit and does not use the production helper.
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function matches(row: unknown, where: unknown): boolean {
  const filter = record(where);
  if (!filter) return row === where;
  const object = record(row) || {};
  return Object.entries(filter).every(([key, value]) => {
    if (key === 'AND' || key === 'OR') {
      const parts: unknown[] = Array.isArray(value) ? value : [value];
      return key === 'AND'
        ? parts.every((part) => matches(row, part))
        : parts.some((part) => matches(row, part));
    }
    const condition = record(value);
    if (condition) {
      if (Array.isArray(condition.in))
        return condition.in.includes(object[key]);
      if ('not' in condition) return object[key] !== condition.not;
      if (typeof condition.contains === 'string') {
        const actual = object[key];
        return (
          typeof actual === 'string' &&
          actual.toLowerCase().includes(condition.contains.toLowerCase())
        );
      }
      return matches(object[key], value);
    }
    return object[key] === value;
  });
}

function fixture() {
  const rows = [
    piece('pool', 'REPAIR', 'WAITING_REPAIR_ACCEPTANCE'),
    piece('mine', 'REPAIR', 'INSPECTING', { repairOwnerId: USER }),
    piece('assigned', 'REPAIR', 'REPAIR_RECEIVED', { nextUserId: USER }),
    piece('other', 'REPAIR', 'REPAIRING', { repairOwnerId: 'other-tech' }),
    piece('customer', 'REPAIR', 'WAITING_CUSTOMER'),
    piece('factory-out', 'REPAIR', 'FACTORY_OUTBOUND'),
    piece('factory-in', 'REPAIR', 'FACTORY_RECEIVED'),
    piece('factory-return', 'REPAIR', 'FACTORY_RETURNING'),
    piece('handoff', 'REPAIR', 'WAITING_RETURN_ACCEPTANCE'),
    piece('ready', 'REPAIR', 'READY_FOR_DISPATCH'),
    piece('dispatched', 'REPAIR', 'DISPATCHED'),
    piece('welfare', 'REPAIR', 'PENDING_WELFARE_STOCK'),
    piece('refurbish', 'RETURN', 'PENDING_REFURBISH'),
    piece('refurbished', 'RETURN', 'PENDING_WELFARE_STOCK'),
    piece('stocked', 'RETURN', 'STOCKED'),
    piece('return-owner', 'RETURN', 'DISPATCHED', {
      repairOwnerId: 'other-tech',
    }),
    piece('unprocessed-return', 'RETURN', 'PENDING_RESTOCK'),
    piece('letter', 'LETTER', 'WAITING_PICKUP'),
    piece('parcel', 'PARCEL', 'WAITING_PICKUP'),
    piece('foreign', 'REPAIR', 'WAITING_REPAIR_ACCEPTANCE', {
      entityId: 'foreign-company',
    }),
  ];
  const state = {
    exists: true,
    active: true,
    mustChangePassword: false,
    employeeActive: null as boolean | null,
    entities: [COMPANY],
    permissions: ['repair_workbench:read', 'mailroom:read'],
  };
  const forbiddenWrite = () =>
    jest.fn().mockRejectedValue(new Error('GET attempted a business write'));
  const writes = {
    transaction: forbiddenWrite(),
    itemUpdate: forbiddenWrite(),
    receiptUpdate: forbiddenWrite(),
    actionCreate: forbiddenWrite(),
    taskUpdate: forbiddenWrite(),
    deliveryCreate: forbiddenWrite(),
    inventoryCreate: forbiddenWrite(),
    notify: forbiddenWrite(),
    sync: forbiddenWrite(),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          state.exists
            ? {
                id: USER,
                name: 'Synthetic Technician',
                isActive: state.active,
                mustChangePassword: state.mustChangePassword,
                employee:
                  state.employeeActive === null
                    ? null
                    : {
                        entityId: COMPANY,
                        isActive: state.employeeActive,
                        department: null,
                      },
                entityMemberships: state.entities.map((entityId) => ({
                  entityId,
                })),
                roles: [
                  {
                    role: {
                      code: 'SYNTHETIC_READER',
                      permissions: state.permissions.map((key) => {
                        const [resource, action] = key.split(':');
                        return { permission: { resource, action } };
                      }),
                    },
                  },
                ],
              }
            : null,
        ),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    mailroomItem: {
      count: jest.fn(({ where }: { where: unknown }) =>
        Promise.resolve(rows.filter((row) => matches(row, where)).length),
      ),
      findMany: jest.fn(
        ({
          where,
          skip = 0,
          take,
        }: {
          where: unknown;
          skip?: number;
          take?: number;
        }) =>
          Promise.resolve(
            rows
              .filter((row) => matches(row, where))
              .slice(skip, take === undefined ? undefined : skip + take),
          ),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((row) => row.id === where.id) || null),
      ),
      update: writes.itemUpdate,
    },
    afterSalesStockUnit: { findMany: jest.fn().mockResolvedValue([]) },
    mailroomReceipt: { update: writes.receiptUpdate },
    mailroomAction: { create: writes.actionCreate },
    mailroomTask: { updateMany: writes.taskUpdate },
    mailroomDelivery: { createMany: writes.deliveryCreate },
    inventoryTransaction: { create: writes.inventoryCreate },
    $transaction: writes.transaction,
  };
  type Dependencies = ConstructorParameters<typeof MailroomService>;
  const service = new MailroomService(
    prisma as unknown as Dependencies[0],
    { sendToUser: writes.notify } as unknown as Dependencies[1],
    { cases: writes.sync } as unknown as Dependencies[2],
  );
  const list = (query: Partial<MailroomQuery> = {}) =>
    service.list(USER, {
      entityId: COMPANY,
      view: 'repair',
      ...query,
    });
  const photo = (id = 'mine', entityId = COMPANY) =>
    service.repairPhoto(USER, entityId, id);
  return { service, prisma, rows, state, writes, list, photo };
}

const EXPECTED_COUNTS = {
  all: 16,
  acceptance: 2,
  mine: 2,
  waiting: 4,
  delivery: 1,
  records: 5,
};
const MEMBERSHIP = {
  all: [
    'pool',
    'mine',
    'assigned',
    'other',
    'customer',
    'factory-out',
    'factory-in',
    'factory-return',
    'handoff',
    'ready',
    'dispatched',
    'welfare',
    'refurbish',
    'refurbished',
    'stocked',
    'return-owner',
  ],
  acceptance: ['pool', 'refurbish'],
  mine: ['mine', 'assigned'],
  waiting: ['customer', 'factory-out', 'factory-in', 'factory-return'],
  delivery: ['handoff'],
  records: ['ready', 'dispatched', 'welfare', 'refurbished', 'return-owner'],
};

describe('repair list totals, native identity and authorized photo', () => {
  const originalEnabled = process.env.MAILROOM_ENABLED;
  beforeEach(() => {
    process.env.MAILROOM_ENABLED = 'true';
  });
  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = originalEnabled;
  });

  it.each(REPAIR_LIST_SCOPES)(
    'retains exact native %s membership and unfiltered totals',
    async (scope) => {
      const f = fixture();
      const result = await f.list({ repairScope: scope });
      expect(result.items.map((item) => item.id)).toEqual(MEMBERSHIP[scope]);
      expect(result.total).toBe(MEMBERSHIP[scope].length);
      expect(result.queueCounts).toEqual(EXPECTED_COUNTS);
      for (const write of Object.values(f.writes))
        expect(write).not.toHaveBeenCalled();
    },
  );

  it('keeps six totals independent of search, status and the second page', async () => {
    const f = fixture();
    for (let i = 0; i < 51; i++)
      f.rows.push(piece('extra-' + i, 'REPAIR', 'WAITING_REPAIR_ACCEPTANCE'));
    const second = await f.list({ page: 2 });
    expect(second.items).toHaveLength(17);
    expect(second.total).toBe(67);
    expect(second.queueCounts).toEqual({
      ...EXPECTED_COUNTS,
      all: 67,
      acceptance: 53,
    });
    const search = await f.list({ search: 'mine', status: 'INSPECTING' });
    expect(search.items.map((item) => item.id)).toEqual(['mine']);
    expect(search.total).toBe(1);
    expect(search.queueCounts).toEqual(second.queueCounts);
  });

  it('keeps same-source native pieces separate and takes contact from the exact source snapshot', async () => {
    const f = fixture();
    const first = f.rows[0];
    const other = piece(
      'same-source-other',
      'REPAIR',
      'WAITING_REPAIR_ACCEPTANCE',
    );
    other.receipt = { ...first.receipt };
    other.evidence = [dataPhoto(Buffer.from('ffd8ff0001', 'hex'), 'jpeg')];
    f.rows.push(other);
    const result = await f.list({ repairScope: 'acceptance' });
    expect(result.items.map((item) => item.id)).toEqual([
      'pool',
      'refurbish',
      'same-source-other',
    ]);
    expect(result.queueCounts?.acceptance).toBe(3);
    expect(result.items[0].repairOverview).toEqual({
      customerName: 'Original Customer',
      customerPhone: '0912345678',
      photoUrl: '/mailroom/items/pool/repair-photo',
    });
    expect(result.items[2].repairOverview?.photoUrl).toBe(
      '/mailroom/items/same-source-other/repair-photo',
    );
    expect(JSON.stringify(result)).not.toMatch(
      /FINANCE_SECRET|PRIVATE_ATTACHMENT|sourceSnapshot/,
    );
    expect(result.items[0]).not.toHaveProperty('evidence');
    expect(first.evidence).toEqual([dataPhoto()]);
    expect(first.receipt.sourceSnapshot).toMatchObject({
      customerPhone: '0912345678',
    });
  });

  it('does not leak overview or queue totals through mailroom, personal or default views even with repair permission', async () => {
    const f = fixture();
    for (const view of ['mailroom', 'mine', undefined] as const) {
      const result = await f.list({ view });
      expect(result).not.toHaveProperty('queueCounts');
      for (const item of result.items)
        expect(item).not.toHaveProperty('repairOverview');
    }
  });

  it('refuses mailroom-only access rather than adding a repair projection', async () => {
    const f = fixture();
    f.state.permissions = ['mailroom:read'];
    await expect(f.list()).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.prisma.mailroomItem.count).not.toHaveBeenCalled();
    expect(f.prisma.mailroomItem.findMany).not.toHaveBeenCalled();
  });

  it.each([
    'missing',
    'inactive',
    'password',
    'employee',
    'revoked',
    'company',
    'disabled',
  ])('rejects %s before any list or photo row read', async (kind) => {
    const f = fixture();
    if (kind === 'missing') f.state.exists = false;
    if (kind === 'inactive') f.state.active = false;
    if (kind === 'password') f.state.mustChangePassword = true;
    if (kind === 'employee') f.state.employeeActive = false;
    if (kind === 'revoked') f.state.permissions = [];
    if (kind === 'company') f.state.entities = ['other-company'];
    if (kind === 'disabled') process.env.MAILROOM_ENABLED = 'false';
    await expect(f.list()).rejects.toThrow();
    await expect(f.photo()).rejects.toThrow();
    expect(f.prisma.mailroomItem.count).not.toHaveBeenCalled();
    expect(f.prisma.mailroomItem.findMany).not.toHaveBeenCalled();
    expect(f.prisma.mailroomItem.findUnique).not.toHaveBeenCalled();
  });

  it('returns only bounded native image bytes and original MIME after fresh read authorization', async () => {
    const f = fixture();
    const result = await f.photo();
    expect(result).toEqual({ buffer: PNG, type: 'image/png' });
    expect(f.prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(f.prisma.mailroomItem.findUnique).toHaveBeenCalledWith({
      where: { id: 'mine' },
      include: { receipt: true },
    });
    for (const write of Object.values(f.writes))
      expect(write).not.toHaveBeenCalled();
  });

  it('allows native repair RETURN photos while rejecting unprocessed/general/unknown and foreign physical rows', async () => {
    const f = fixture();
    await expect(f.photo('refurbish')).resolves.toEqual({
      buffer: PNG,
      type: 'image/png',
    });
    await expect(f.photo('return-owner')).resolves.toEqual({
      buffer: PNG,
      type: 'image/png',
    });
    for (const id of [
      'unprocessed-return',
      'letter',
      'parcel',
      'unknown',
      'foreign',
    ])
      await expect(f.photo(id)).rejects.toBeInstanceOf(NotFoundException);
    f.rows[1].receipt.entityId = 'foreign-company';
    await expect(f.photo()).rejects.toBeInstanceOf(NotFoundException);
    f.state.permissions = ['mailroom:read'];
    await expect(f.photo('pool')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    null,
    [],
    ['https://example.invalid/photo.png'],
    ['data:image/svg+xml;base64,PHN2Zy8+'],
    ['data:image/png;base64,AAAA'],
    [null, dataPhoto()],
  ])(
    'returns 404 without falling back to source attachment for missing/malformed native evidence %j',
    async (evidence) => {
      const f = fixture();
      f.rows[1].evidence = evidence;
      await expect(f.photo()).rejects.toBeInstanceOf(NotFoundException);
      const result = await f.list({ search: 'mine' });
      expect(result.items[0].repairOverview?.photoUrl).toBeNull();
    },
  );

  it('preserves count failures instead of returning fabricated zero totals', async () => {
    const f = fixture();
    f.prisma.mailroomItem.count.mockRejectedValueOnce(
      new Error('native count failed'),
    );
    await expect(f.list()).rejects.toThrow('native count failed');
  });
});

describe('pure repair read projection contracts', () => {
  it('returns fresh nested WHERE values and never modifies native status membership', () => {
    const first = repairConditions('acceptance', USER);
    (first[0] as PopulationFilter).OR[1].OR[0].status.in.length = 0;
    (first[1] as StatusFilter).status.in.push('DISPATCHED');
    const next = repairConditions('acceptance', USER);
    expect((next[0] as PopulationFilter).OR[1].OR[0].status.in).toContain(
      'STOCKED',
    );
    expect((next[1] as StatusFilter).status.in).toEqual([
      'WAITING_REPAIR_ACCEPTANCE',
      'PENDING_REFURBISH',
    ]);
  });

  it.each([
    'missing',
    'foreign-id',
    'wrong-type',
    'foreign-receipt',
    'array',
    'legacy-phone',
  ])(
    'takes only matching native snapshot contact for %s and never courier sender',
    (kind) => {
      const row = piece('case/id');
      if (kind === 'missing') row.receipt.sourceCaseId = null;
      if (kind === 'foreign-id')
        record(row.receipt.sourceSnapshot)!.id = 'other-source';
      if (kind === 'wrong-type')
        record(row.receipt.sourceSnapshot)!.type = 'RETURN';
      if (kind === 'foreign-receipt') row.receipt.entityId = 'other-company';
      if (kind === 'array') row.receipt.sourceSnapshot = [];
      if (kind === 'legacy-phone')
        delete record(row.receipt.sourceSnapshot)!.customerPhone;
      const overview = repairOverview(row);
      expect(overview.customerName).toBe(
        kind === 'legacy-phone' ? 'Original Customer' : null,
      );
      expect(overview.customerPhone).toBeNull();
      expect(overview.photoUrl).toBe(
        kind === 'foreign-receipt'
          ? null
          : '/mailroom/items/case%2Fid/repair-photo',
      );
    },
  );

  it('accepts native PNG/JPEG/WebP magic, caps bytes at 1 MiB and rejects spoofed MIME', () => {
    const webp = Buffer.from('524946460000000057454250', 'hex');
    expect(repairPhoto([dataPhoto(PNG)])?.type).toBe('image/png');
    expect(
      repairPhoto([dataPhoto(Buffer.from('ffd8ff00', 'hex'), 'jpeg')])?.type,
    ).toBe('image/jpeg');
    expect(repairPhoto([dataPhoto(webp, 'webp')])?.type).toBe('image/webp');
    expect(repairPhoto([dataPhoto(PNG, 'jpeg')])).toBeNull();
    const maximum = Buffer.alloc(REPAIR_PHOTO_MAX_BYTES);
    PNG.copy(maximum);
    expect(repairPhoto([dataPhoto(maximum)])?.buffer.length).toBe(
      REPAIR_PHOTO_MAX_BYTES,
    );
    const oversized = Buffer.alloc(REPAIR_PHOTO_MAX_BYTES + 1);
    PNG.copy(oversized);
    expect(repairPhoto([dataPhoto(oversized)])).toBeNull();
    expect(repairPhoto([dataPhoto(PNG, 'gif')])).toBeNull();
    expect(
      repairPhoto(['data:image/png;base64,' + '!'.repeat(100)]),
    ).toBeNull();
  });
});

describe('native repair photo HTTP with production JWT boundary', () => {
  let app: INestApplication<Server>;
  let f: ReturnType<typeof fixture>;
  let token: string;
  const originalEnabled = process.env.MAILROOM_ENABLED;
  const secret = 'synthetic-repair-photo-local-test-signing-key';
  const path = '/api/v1/mailroom/items/mine/repair-photo';
  beforeEach(async () => {
    process.env.MAILROOM_ENABLED = 'true';
    f = fixture();
    const module = await Test.createTestingModule({
      controllers: [MailroomController],
      providers: [
        { provide: MailroomService, useValue: f.service },
        { provide: MailroomIntakeService, useValue: {} },
        { provide: B2bService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined),
          },
        },
        {
          provide: AuthService,
          useValue: {
            validateUser: (id: string) =>
              Promise.resolve(id === USER ? { id: USER } : null),
          },
        },
        JwtStrategy,
        { provide: APP_GUARD, useClass: B2bAwareJwtAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    token = new JwtService().sign(
      { sub: USER, email: 'synthetic@example.invalid' },
      { secret, expiresIn: '5m' },
    );
  });
  afterEach(async () => {
    await app?.close();
    if (originalEnabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = originalEnabled;
  });

  it('requires JWT before any native read and never becomes a public or signed-service route', async () => {
    for (const bearer of ['', 'invalid-token']) {
      const call = request(app.getHttpServer())
        .get(path)
        .query({ entityId: COMPANY });
      if (bearer) call.set('Authorization', `Bearer ${bearer}`);
      await call.expect(401);
    }
    expect(f.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(f.prisma.mailroomItem.findUnique).not.toHaveBeenCalled();
  });

  it('streams exact native bytes and MIME with no-store, without list/source/business payload', async () => {
    const response = await request(app.getHttpServer())
      .get(path)
      .query({ entityId: COMPANY })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-length']).toBe(String(PNG.length));
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual(PNG);
    for (const write of Object.values(f.writes))
      expect(write).not.toHaveBeenCalled();
  });

  it('returns 403/404/400 without image bytes for revoked permission, foreign or absent native photo and missing company', async () => {
    const get = (id = 'mine', entityId: string | undefined = COMPANY) => {
      const call = request(app.getHttpServer())
        .get(`/api/v1/mailroom/items/${id}/repair-photo`)
        .set('Authorization', `Bearer ${token}`);
      if (entityId) call.query({ entityId });
      return call;
    };
    f.state.permissions = ['mailroom:read'];
    await get().expect(403);
    expect(f.prisma.mailroomItem.findUnique).not.toHaveBeenCalled();
    f.state.permissions = ['repair_workbench:read'];
    f.rows[1].evidence = [];
    const missing = await get().expect(404);
    expect(missing.headers['content-type']).toMatch(/^application\/json/);
    await get('foreign').expect(404);
    await get('unprocessed-return').expect(404);
    await get('mine', '').expect(400);
    for (const write of Object.values(f.writes))
      expect(write).not.toHaveBeenCalled();
  });
});
