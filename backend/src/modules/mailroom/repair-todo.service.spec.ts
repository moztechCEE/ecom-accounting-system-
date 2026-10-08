import 'reflect-metadata';
import {
  ForbiddenException,
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
import type { Actor, SourceCase } from './mailroom.contract';
import { MailroomService } from './mailroom.service';
import { RepairWorkbenchController } from './repair-workbench.controller';
import { RepairWorkbenchService } from './repair-workbench.service';
import {
  inspectionPlanHash,
  type InspectionDocument,
} from './repair-document.contract';
import {
  repairTodoDecision,
  repairTodoSourceDecision,
} from './repair-todo.contract';
import { RepairTodoService } from './repair-todo.service';
import type { RepairTodoQuery } from './repair-todo.dto';

const COMPANY = 'synthetic-company';
const FOREIGN = 'synthetic-other-company';
const USER = 'synthetic-technician';
const OTHER = 'synthetic-other-technician';
const READ = 'repair_workbench:read';
const UPDATE = 'repair_workbench:update';
const actor = (permissions = [READ, UPDATE]): Actor => ({
  id: USER,
  name: 'Synthetic Technician',
  entityIds: [COMPANY],
  permissions: new Set(permissions),
});

function inspection(plan: InspectionDocument['data']['plan'] = 'REPAIR') {
  const doc: InspectionDocument = {
    number: 'INS-SYNTHETIC',
    revision: 3,
    status: 'SUBMITTED',
    authorId: USER,
    authorName: 'Synthetic Technician',
    updatedAt: '2026-10-08T00:00:00Z',
    data: {
      complaint: 'Synthetic fault',
      reproduction: 'YES',
      testConditions: 'Offline conditions',
      checks: [
        { name: 'Power', result: 'PASS', observation: 'Offline result' },
      ],
      diagnosis: 'Synthetic diagnosis',
      causeStatus: 'CONFIRMED',
      plan,
      planNote: 'Synthetic plan',
      feeSuggestion: 'FREE',
      estimateNote: '',
      ...(plan === 'REPLACE'
        ? {
            replacementCondition: 'REFURBISHED',
            replacementSku: 'SKU-SYNTHETIC',
          }
        : {}),
    },
  };
  doc.review = {
    inspectionRevision: doc.revision,
    planHash: inspectionPlanHash(doc),
    quoteRevision: 4,
    decision: 'APPROVE',
    actorId: 'synthetic-csr',
    name: 'Synthetic CSR',
    confirmedAt: '2026-10-08T00:00:00Z',
  };
  return doc;
}

function piece(id: string, status = 'INSPECTING') {
  const doc = inspection();
  return {
    id,
    entityId: COMPANY,
    label: 'MR-' + id,
    productName: 'Device ' + id,
    sku: 'SKU-' + id,
    serialNumber: 'SN-' + id,
    status,
    version: 7,
    matchResult: 'MATCH',
    grade: null,
    disposition: null,
    conditionNote: null,
    declared: null,
    returnInspection: null,
    repairInspection: doc as unknown,
    repairReport: null as unknown,
    repairWorkflow: {
      schema: 1,
      csr: {
        status: 'RESOLVED',
        inspectionRevision: doc.revision,
        estimateRevision: doc.revision,
        planHash: inspectionPlanHash(doc),
        quoteRevision: 4,
        decision: 'APPROVE',
        sentToUserId: 'synthetic-csr',
        sentAt: '2026-10-08T00:00:00Z',
        sentBy: USER,
      },
    } as unknown,
    evidence: [] as unknown,
    location: 'synthetic-shelf',
    custodianId: USER,
    nextUserId: USER as string | null,
    repairOwnerId: USER as string | null,
    recipientId: null,
    createdAt: new Date('2026-10-08T00:00:00Z'),
    updatedAt: new Date('2026-10-08T00:00:00Z'),
    receiptId: 'receipt-' + id,
    receipt: {
      id: 'receipt-' + id,
      entityId: COMPANY,
      number: 'RECEIPT-' + id,
      category: 'REPAIR',
      sourceCaseId: ('source-' + id) as string | null,
      sourceNumber: 'CASE-' + id,
      sourceSnapshot: {
        id: 'source-' + id,
        type: 'REPAIR',
        customerLabel: 'Synthetic Customer',
        customerPhone: '0912345678',
        financialNote: 'PRIVATE_FINANCIAL_SNAPSHOT',
        repairAllowed: true,
      },
      customerServiceUserId: 'synthetic-csr',
      carrier: null,
      trackingNumber: null as string | null,
      senderLabel: 'Synthetic sender',
      receivedAt: new Date('2026-10-08T00:00:00Z'),
      receivedById: 'synthetic-mailroom',
    },
  };
}
type Piece = ReturnType<typeof piece>;
function source(id: string): SourceCase {
  return {
    id,
    number: 'CASE-' + id,
    type: 'REPAIR',
    brand: 'SYNTHETIC',
    version: 'source-current-v9',
    status: 'READY_FOR_REPAIR',
    customerLabel: 'Synthetic Customer',
    repairAllowed: true,
    releaseInfo: {
      quoteRevision: 4,
      customerApprovedQuoteRevision: 4,
      customerApprovedAt: '2026-10-08T00:00:00Z',
      amount: 100,
      currency: 'TWD',
      confirmedPaymentQuoteRevision: 4,
    },
    items: [
      {
        id: 'synthetic-source-item',
        name: 'Device',
        sku: null,
        serialNumber: null,
        quantity: 1,
      },
    ],
  };
}
function workflow(row: Piece) {
  return row.repairWorkflow as {
    schema: number;
    csr?: Record<string, unknown>;
    factory?: Record<string, unknown>;
  };
}
function setPlan(row: Piece, plan: InspectionDocument['data']['plan']) {
  const doc = inspection(plan);
  row.repairInspection = doc;
  workflow(row).csr!.planHash = inspectionPlanHash(doc);
  return row;
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
// Independent synthetic DB matching evaluates the produced WHERE and cursor.
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
      return matches(object[key], condition);
    }
    return object[key] === value;
  });
}

function selectedProjection(
  row: Piece,
  select: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(select).map(([key, rule]) => {
      const value = (row as unknown as Record<string, unknown>)[key];
      if (rule === true) return [key, value];
      const fields = record(record(rule)?.select);
      return [
        key,
        fields
          ? Object.fromEntries(
              Object.keys(fields).map((field) => [
                field,
                record(value)?.[field],
              ]),
            )
          : undefined,
      ];
    }),
  );
}
const fixtures: { writes: Record<string, jest.Mock> }[] = [];
function fixture(rows = [piece('ready')]) {
  const state = {
    active: true,
    mustChangePassword: false,
    employeeActive: true,
    employeeEntity: COMPANY as string | null,
    entities: [COMPANY],
    permissions: [READ, UPDATE],
    role: 'SYNTHETIC_TECHNICIAN',
  };
  const forbiddenWrite = () =>
    jest.fn().mockRejectedValue(new Error('GET attempted a write'));
  const writes = {
    transaction: forbiddenWrite(),
    itemUpdate: forbiddenWrite(),
    receiptUpdate: forbiddenWrite(),
    actionCreate: forbiddenWrite(),
    taskUpdate: forbiddenWrite(),
    deliveryCreate: forbiddenWrite(),
    stockReserve: forbiddenWrite(),
    stockPost: forbiddenWrite(),
    notify: forbiddenWrite(),
    sendEvent: forbiddenWrite(),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: USER,
          name: 'Synthetic Technician',
          isActive: state.active,
          mustChangePassword: state.mustChangePassword,
          employee: {
            entityId: state.employeeEntity,
            isActive: state.employeeActive,
            department: null,
          },
          entityMemberships: state.entities.map((entityId) => ({ entityId })),
          roles: [
            {
              role: {
                code: state.role,
                permissions: state.permissions.map((key) => {
                  const [resource, action] = key.split(':');
                  return { permission: { resource, action } };
                }),
              },
            },
          ],
        }),
      ),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: USER, name: 'Synthetic Technician' }]),
    },
    mailroomItem: {
      count: jest.fn(({ where }: { where: unknown }) =>
        Promise.resolve(rows.filter((row) => matches(row, where)).length),
      ),
      findMany: jest.fn(
        ({
          where,
          take,
          skip = 0,
          cursor,
          select,
        }: {
          where: unknown;
          take?: number;
          skip?: number;
          cursor?: { id: string };
          select?: Record<string, unknown>;
          include?: Record<string, unknown>;
        }) => {
          const selected = rows.filter((row) => matches(row, where));
          const start = cursor
            ? selected.findIndex((row) => row.id === cursor.id) + skip
            : skip;
          const sliced = selected.slice(
            start,
            take === undefined ? undefined : start + take,
          );
          return Promise.resolve(
            structuredClone(
              select
                ? sliced.map((row) => selectedProjection(row, select))
                : sliced,
            ),
          );
        },
      ),
      update: writes.itemUpdate,
    },
    mailroomReceipt: { update: writes.receiptUpdate },
    mailroomAction: { create: writes.actionCreate },
    mailroomTask: { updateMany: writes.taskUpdate },
    mailroomDelivery: { createMany: writes.deliveryCreate },
    afterSalesStockUnit: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: writes.transaction,
  };
  const sources = new Map<string, unknown>(
    rows.map((row) => [
      row.receipt.sourceCaseId!,
      source(row.receipt.sourceCaseId!),
    ]),
  );
  const sync = {
    cases: jest.fn((entityId: string, search: string, id: string) => {
      const result = sources.get(id);
      return Promise.resolve({ items: result ? [result] : [] });
    }),
    enqueue: writes.sendEvent,
  };
  type MailroomDependencies = ConstructorParameters<typeof MailroomService>;
  const mailroom = new MailroomService(
    prisma as unknown as MailroomDependencies[0],
    { sendToUser: writes.notify } as unknown as MailroomDependencies[1],
    sync as unknown as MailroomDependencies[2],
  );
  const views = jest.spyOn(mailroom, 'views');
  type Dependencies = ConstructorParameters<typeof RepairTodoService>;
  const service = new RepairTodoService(
    prisma as unknown as Dependencies[0],
    mailroom,
    sync as unknown as Dependencies[2],
  );
  const list = (query: Partial<RepairTodoQuery> = {}) =>
    service.list(USER, { entityId: COMPANY, ...query });
  const result = {
    rows,
    state,
    writes,
    prisma,
    sources,
    sync,
    mailroom,
    views,
    service,
    list,
  };
  fixtures.push(result);
  return result;
}

let externalFetch: jest.SpyInstance;
const originalEnabled = process.env.MAILROOM_ENABLED;
beforeEach(() => {
  process.env.MAILROOM_ENABLED = 'true';
  externalFetch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('No external HTTP permitted'));
});
afterEach(() => {
  for (const f of fixtures.splice(0))
    for (const write of Object.values(f.writes))
      expect(write).not.toHaveBeenCalled();
  expect(externalFetch).not.toHaveBeenCalled();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (originalEnabled === undefined) delete process.env.MAILROOM_ENABLED;
  else process.env.MAILROOM_ENABLED = originalEnabled;
});

describe('repair todo native read projection', () => {
  it.each([
    ['read only', [READ]],
    ['update only', [UPDATE]],
    ['mailroom reader', ['mailroom:read', 'mailroom:update']],
    ['CSR reviewer', ['mailroom:review']],
    ['similarly named permission', ['repair_workbench:reading', UPDATE]],
  ])('never grants todo through %s', (_name, permissions) => {
    expect(
      repairTodoDecision(actor(permissions), COMPANY, piece('weak')).state,
    ).toBe('blocked');
  });
  it.each([
    [
      'different owner',
      (row: Piece) => {
        row.repairOwnerId = OTHER;
      },
    ],
    [
      'different custodian',
      (row: Piece) => {
        row.custodianId = OTHER;
      },
    ],
    [
      'different next technician',
      (row: Piece) => {
        row.nextUserId = OTHER;
      },
    ],
    [
      'different company',
      (row: Piece) => {
        row.entityId = FOREIGN;
      },
    ],
    [
      'different receipt company',
      (row: Piece) => {
        row.receipt.entityId = FOREIGN;
      },
    ],
    [
      'unclaimed',
      (row: Piece) => {
        row.repairOwnerId = null;
      },
    ],
    [
      'non repair category',
      (row: Piece) => {
        row.receipt.category = 'PARCEL';
      },
    ],
    [
      'claimed but not signed',
      (row: Piece) => {
        row.status = 'WAITING_REPAIR_ACCEPTANCE';
        row.custodianId = OTHER;
      },
    ],
    [
      'factory physical custody',
      (row: Piece) => {
        workflow(row).factory = { physicalCustody: 'FACTORY' };
      },
    ],
    [
      'factory carrier custody',
      (row: Piece) => {
        workflow(row).factory = { physicalCustody: 'FACTORY_CARRIER' };
      },
    ],
  ])('excludes %s even with wildcard', (_name, mutate) => {
    const row = piece('scope');
    mutate(row);
    expect(repairTodoDecision(actor(['*']), COMPANY, row).state).toBe(
      'blocked',
    );
  });
  it.each([
    'WAITING_CUSTOMER',
    'FACTORY_OUTBOUND',
    'FACTORY_RECEIVED',
    'WAITING_RETURN_ACCEPTANCE',
    'READY_FOR_DISPATCH',
    'DISPATCHED',
    'PENDING_WELFARE_STOCK',
    'STOCKED',
    'PENDING_REFURBISH',
  ])('does not promote waiting/finished %s through mine', (status) => {
    expect(
      repairTodoDecision(actor(), COMPANY, piece('status', status)).state,
    ).toBe('blocked');
  });
  it('lists initial and revised inspections, actual work and factory return receipt without declaring completion', () => {
    const initial = piece('initial', 'REPAIR_RECEIVED');
    initial.repairWorkflow = null;
    const revised = piece('revised');
    (revised.repairInspection as InspectionDocument).revision++;
    const factory = piece('factory', 'FACTORY_RETURNING');
    workflow(factory).factory = {
      stage: 'RETURNING',
      physicalCustody: 'FACTORY_CARRIER',
    };
    expect(repairTodoDecision(actor(), COMPANY, initial)).toEqual({
      state: 'ready',
      kind: 'INSPECTION',
    });
    expect(repairTodoDecision(actor(), COMPANY, revised)).toEqual({
      state: 'ready',
      kind: 'INSPECTION',
    });
    expect(
      repairTodoDecision(actor(), COMPANY, piece('working', 'REPAIRING')),
    ).toEqual({ state: 'ready', kind: 'REPAIR_WORK' });
    const refurb = piece('refurb', 'REFURBISHING');
    refurb.receipt.category = 'RETURN';
    expect(repairTodoDecision(actor(), COMPANY, refurb)).toEqual({
      state: 'ready',
      kind: 'REPAIR_WORK',
    });
    expect(repairTodoDecision(actor(), COMPANY, factory)).toEqual({
      state: 'ready',
      kind: 'FACTORY_RETURN_RECEIPT',
    });
    const returned = setPlan(piece('returned'), 'FACTORY');
    workflow(returned).factory = {
      stage: 'RETURNED',
      physicalCustody: 'TECHNICIAN',
      inspectionRevision: 3,
    };
    returned.receipt.sourceCaseId = null;
    expect(repairTodoDecision(actor(), COMPANY, returned)).toEqual({
      state: 'ready',
      kind: 'REPAIR_WORK',
    });
  });
  it.each(['SENT', 'ACCEPTED'])(
    'keeps CSR %s in the case instead of technician todo',
    (status) => {
      const row = piece('csr');
      workflow(row).csr!.status = status;
      expect(repairTodoDecision(actor(), COMPANY, row).state).toBe('blocked');
    },
  );
  it('uses native return_original even if original plan was repair and customer declined', () => {
    const row = piece('decline');
    workflow(row).csr!.decision = 'DECLINE';
    (row.repairInspection as InspectionDocument).review!.decision = 'DECLINE';
    row.receipt.sourceCaseId = null;
    expect(repairTodoDecision(actor(), COMPANY, row)).toEqual({
      state: 'ready',
      kind: 'RETURN_ORIGINAL',
    });
  });
  it.each(['REPAIR', 'REPLACE', 'FACTORY'] as const)(
    'names approved %s work only after fresh source consent/payment',
    (plan) => {
      const row = setPlan(piece('plan'), plan);
      expect(repairTodoDecision(actor(), COMPANY, row).state).toBe('source');
      const result = repairTodoSourceDecision(
        actor(),
        COMPANY,
        row,
        source(row.receipt.sourceCaseId!),
      );
      expect(result).toEqual({
        state: 'ready',
        kind:
          plan === 'REPAIR'
            ? 'START_REPAIR'
            : plan === 'REPLACE'
              ? 'START_REPLACEMENT'
              : 'SEND_FACTORY',
      });
    },
  );
  it.each([
    [
      'customer approval pending',
      (s: SourceCase) => {
        s.releaseInfo!.customerApprovedQuoteRevision = null;
        s.releaseInfo!.customerApprovedAt = null;
      },
    ],
    [
      'old approval',
      (s: SourceCase) => {
        s.releaseInfo!.customerApprovedQuoteRevision = 3;
      },
    ],
    [
      'missing approved date',
      (s: SourceCase) => {
        s.releaseInfo!.customerApprovedAt = null;
      },
    ],
    [
      'old paid quote',
      (s: SourceCase) => {
        s.releaseInfo!.confirmedPaymentQuoteRevision = 3;
      },
    ],
    [
      'payment pending',
      (s: SourceCase) => {
        s.releaseInfo!.confirmedPaymentQuoteRevision = null;
      },
    ],
    [
      'not released',
      (s: SourceCase) => {
        s.repairAllowed = false;
      },
    ],
    [
      'new quote',
      (s: SourceCase) => {
        s.releaseInfo!.quoteRevision = 5;
        s.releaseInfo!.customerApprovedQuoteRevision = 5;
        s.releaseInfo!.confirmedPaymentQuoteRevision = 5;
      },
    ],
  ])(
    'knows %s is blocked regardless of snapshot or PAID status',
    (_name, mutate) => {
      const row = piece('gated');
      const current = source(row.receipt.sourceCaseId!);
      current.status = 'PAID';
      mutate(current);
      expect(
        repairTodoSourceDecision(actor(), COMPANY, row, current).state,
      ).toBe('blocked');
    },
  );
  it('FREE still requires current consent, but not a payment confirmation for zero amount', () => {
    const row = piece('free');
    const current = source(row.receipt.sourceCaseId!);
    current.releaseInfo!.amount = 0;
    current.releaseInfo!.confirmedPaymentQuoteRevision = null;
    expect(repairTodoSourceDecision(actor(), COMPANY, row, current).state).toBe(
      'ready',
    );
    current.releaseInfo!.customerApprovedQuoteRevision = null;
    expect(repairTodoSourceDecision(actor(), COMPANY, row, current).state).toBe(
      'blocked',
    );
  });
  it.each([
    ['missing source', () => undefined],
    ['source array', () => []],
    ['wrong case', (s: SourceCase) => ({ ...s, id: 'foreign-case' })],
    ['wrong type', (s: SourceCase) => ({ ...s, type: 'RETURN' })],
    ['missing release', (s: SourceCase) => ({ ...s, releaseInfo: undefined })],
    ['null release', (s: SourceCase) => ({ ...s, releaseInfo: null })],
    ['missing version', (s: SourceCase) => ({ ...s, version: undefined })],
    [
      'string repairAllowed',
      (s: SourceCase) => ({ ...s, repairAllowed: 'true' }),
    ],
    [
      'string amount',
      (s: SourceCase) => ({
        ...s,
        releaseInfo: { ...s.releaseInfo, amount: '100' },
      }),
    ],
    [
      'null amount',
      (s: SourceCase) => ({
        ...s,
        releaseInfo: { ...s.releaseInfo, amount: null },
      }),
    ],
    [
      'bad date',
      (s: SourceCase) => ({
        ...s,
        releaseInfo: { ...s.releaseInfo, customerApprovedAt: 'not-a-date' },
      }),
    ],
    [
      'bad revision',
      (s: SourceCase) => ({
        ...s,
        releaseInfo: { ...s.releaseInfo, quoteRevision: 4.5 },
      }),
    ],
    [
      'missing payment metadata',
      (s: SourceCase) => ({
        ...s,
        releaseInfo: {
          ...s.releaseInfo,
          confirmedPaymentQuoteRevision: undefined,
        },
      }),
    ],
  ])('marks %s unknown rather than authoritative zero', (_name, mutate) => {
    const row = piece('unknown');
    expect(
      repairTodoSourceDecision(
        actor(),
        COMPANY,
        row,
        mutate(source(row.receipt.sourceCaseId!)),
      ).state,
    ).toBe('unknown');
  });
  it.each([
    'inspectionRevision',
    'estimateRevision',
    'planHash',
    'quoteRevision',
    'decision',
  ])('never source-releases inconsistent CSR %s', (key) => {
    const row = piece('stale');
    workflow(row).csr![key] = key.includes('Revision') ? 2 : 'wrong';
    expect(repairTodoDecision(actor(), COMPANY, row)).toEqual({
      state: 'ready',
      kind: 'INSPECTION',
    });
  });
  it('does not mutate either workflow/document/source or grant through missing company membership', () => {
    const row = piece('pure');
    const current = source(row.receipt.sourceCaseId!);
    const before = structuredClone({ row, current });
    const foreignActor = actor();
    foreignActor.entityIds = [FOREIGN];
    expect(
      repairTodoSourceDecision(foreignActor, COMPANY, row, current).state,
    ).toBe('blocked');
    expect(repairTodoSourceDecision(actor(), COMPANY, row, current).state).toBe(
      'ready',
    );
    expect({ row, current }).toEqual(before);
  });
});

describe('repair todo complete population and bounded fresh source reads', () => {
  it('filters 65 ready pieces after 210 blocked pieces before count/page and keeps global badges independent of search', async () => {
    const blocked = Array.from({ length: 210 }, (_, i) =>
      piece('blocked-' + i),
    );
    const ready = Array.from({ length: 65 }, (_, i) => piece('ready-' + i));
    for (const row of ready) row.receipt.sourceCaseId = 'shared-ready-case';
    for (const row of blocked) row.receipt.sourceCaseId = 'shared-blocked-case';
    for (const row of ready.slice(0, 40)) row.productName = 'Find This Device';
    const acceptance = piece('unclaimed', 'WAITING_REPAIR_ACCEPTANCE');
    acceptance.repairOwnerId = null;
    acceptance.nextUserId = null;
    const sign = piece('assigned-signature', 'WAITING_REPAIR_ACCEPTANCE');
    sign.repairOwnerId = null;
    sign.custodianId = OTHER;
    const f = fixture([...blocked, ...ready, acceptance, sign]);
    f.sources.set('shared-blocked-case', {
      ...source('shared-blocked-case'),
      repairAllowed: false,
    });
    const first = await f.list();
    expect(first).toMatchObject({
      total: 65,
      page: 1,
      countExact: true,
      unknownCount: 0,
      queueCounts: { todo: 65, acceptance: 2 },
    });
    expect(first.items).toHaveLength(50);
    expect(first.items[0].id).toBe('ready-0');
    expect(
      first.items.every(
        (item) =>
          item.status === 'INSPECTING' && item.todoKind === 'START_REPAIR',
      ),
    ).toBe(true);
    expect(f.prisma.mailroomItem.findMany).toHaveBeenCalledTimes(5);
    const reads = f.prisma.mailroomItem.findMany.mock.calls.map(
      ([query]) => query,
    );
    const scans = reads.filter((query) => !!query.select);
    expect(scans).toHaveLength(4);
    for (const scan of scans) {
      expect(scan).not.toHaveProperty('include');
      expect(scan.select).not.toHaveProperty('evidence');
      expect(scan.select).not.toHaveProperty('repairReport');
      expect(scan.select).not.toHaveProperty('receipt.select.sourceSnapshot');
    }
    const hydration = reads.filter((query) => !!query.include);
    expect(hydration).toHaveLength(1);
    expect(hydration[0].where).toMatchObject({
      entityId: COMPANY,
      custodianId: USER,
      repairOwnerId: USER,
    });
    const versionRows = (
      hydration[0].where as { OR: { id: string; version: number }[] }
    ).OR;
    expect(versionRows).toHaveLength(50);
    expect(versionRows).toEqual(
      ready.slice(0, 50).map((row) => ({ id: row.id, version: 7 })),
    );
    expect(f.views.mock.calls[0][0]).toHaveLength(50);
    expect(f.prisma.mailroomItem.findMany.mock.calls[0][0].take).toBe(200);
    expect(f.prisma.mailroomItem.findMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: 'blocked-199' },
      skip: 1,
    });
    expect(f.sync.cases.mock.calls).toEqual([
      [COMPANY, '', 'shared-blocked-case'],
      [COMPANY, '', 'shared-ready-case'],
    ]);
    const second = await f.list({ page: 2 });
    expect(second.items).toHaveLength(15);
    expect(second.total).toBe(65);
    const search = await f.list({ search: ' Find This ' });
    expect(search).toMatchObject({
      total: 40,
      queueCounts: { todo: 65, acceptance: 2 },
    });
    expect(search.items).toHaveLength(40);
    expect(JSON.stringify(first)).not.toContain('PRIVATE_FINANCIAL_SNAPSHOT');
    expect(JSON.stringify(first)).not.toContain('releaseInfo');
  });
  it('summary omits views/items but retains the same source predicates, count and search', async () => {
    const f = fixture([piece('ready'), piece('blocked'), piece('unknown')]);
    f.sources.set('source-blocked', {
      ...source('source-blocked'),
      repairAllowed: false,
    });
    f.sources.delete('source-unknown');
    const result = await f.list({ summary: 'true', search: 'ready' });
    expect(result).toEqual({
      items: [],
      total: 1,
      page: 1,
      queueCounts: { acceptance: 0 },
      countExact: false,
      unknownCount: 1,
    });
    expect(f.views).not.toHaveBeenCalled();
    expect(f.sync.cases).toHaveBeenCalledTimes(3);
    expect(
      f.prisma.mailroomItem.findMany.mock.calls.every(
        ([query]) => !query.include && !!query.select,
      ),
    ).toBe(true);
  });
  it('network errors and absent/malformed detail count affected pieces unknown, without masking known work', async () => {
    const initial = piece('initial', 'REPAIR_RECEIVED');
    initial.repairWorkflow = null;
    const one = piece('one');
    const two = piece('two');
    two.receipt.sourceCaseId = one.receipt.sourceCaseId;
    const f = fixture([
      initial,
      one,
      two,
      piece('missing'),
      piece('malformed'),
    ]);
    f.sync.cases.mockRejectedValueOnce(new Error('synthetic network failure'));
    f.sources.delete('source-missing');
    f.sources.set('source-malformed', {
      ...source('source-malformed'),
      releaseInfo: null,
    });
    const result = await f.list();
    expect(result).toMatchObject({
      total: 1,
      countExact: false,
      unknownCount: 4,
      queueCounts: { acceptance: 0 },
    });
    expect(result.queueCounts).not.toHaveProperty('todo');
    expect(result.items.map((item) => item.id)).toEqual(['initial']);
    expect(f.sync.cases).toHaveBeenCalledTimes(3);
  });
  it('never fetches source for unclaimed/signature, foreign company/custody, CSR wait, outward factory or finished records', async () => {
    const statuses = [
      'WAITING_REPAIR_ACCEPTANCE',
      'PENDING_REFURBISH',
      'WAITING_CUSTOMER',
      'FACTORY_OUTBOUND',
      'FACTORY_RECEIVED',
      'READY_FOR_DISPATCH',
      'DISPATCHED',
    ];
    const rows = statuses.map((status) => piece(status, status));
    rows.push(
      piece('foreign'),
      piece('foreign-receipt'),
      piece('other-custody'),
    );
    rows[7].entityId = FOREIGN;
    rows[8].receipt.entityId = FOREIGN;
    rows[9].custodianId = OTHER;
    const f = fixture(rows);
    const result = await f.list();
    expect(result).toMatchObject({
      total: 0,
      countExact: true,
      unknownCount: 0,
      queueCounts: { todo: 0, acceptance: 2 },
    });
    expect(f.sync.cases).not.toHaveBeenCalled();
  });
  it.each([
    [
      'inactive account',
      (f: ReturnType<typeof fixture>) => {
        f.state.active = false;
      },
    ],
    [
      'password setup required',
      (f: ReturnType<typeof fixture>) => {
        f.state.mustChangePassword = true;
      },
    ],
    [
      'inactive employee',
      (f: ReturnType<typeof fixture>) => {
        f.state.employeeActive = false;
      },
    ],
    [
      'revoked read grant',
      (f: ReturnType<typeof fixture>) => {
        f.state.permissions = [UPDATE];
      },
    ],
    [
      'wrong company',
      (f: ReturnType<typeof fixture>) => {
        f.state.employeeEntity = FOREIGN;
        f.state.entities = [FOREIGN];
      },
    ],
  ])(
    'rejects %s before DB population or fresh source reads',
    async (_name, mutate) => {
      const f = fixture();
      mutate(f);
      await expect(f.list()).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.prisma.mailroomItem.findMany).not.toHaveBeenCalled();
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );
  it('read-only users see no actionable todo and preserve the original company-wide acceptance count', async () => {
    const f = fixture([
      piece('approved'),
      piece('signature', 'WAITING_REPAIR_ACCEPTANCE'),
    ]);
    f.state.permissions = [READ];
    expect(await f.list()).toMatchObject({
      total: 0,
      countExact: true,
      queueCounts: { todo: 0, acceptance: 1 },
    });
    expect(f.prisma.mailroomItem.findMany).not.toHaveBeenCalled();
    expect(f.sync.cases).not.toHaveBeenCalled();
  });
  it.each(['permission', 'entity', 'active'])(
    'rechecks fresh %s after source returns before projecting views',
    async (kind) => {
      const f = fixture();
      f.sync.cases.mockImplementationOnce(() => {
        if (kind === 'permission') f.state.permissions = [UPDATE];
        if (kind === 'entity') {
          f.state.entities = [FOREIGN];
          f.state.employeeEntity = FOREIGN;
        }
        if (kind === 'active') f.state.active = false;
        return Promise.resolve({ items: [source('source-ready')] });
      });
      await expect(f.list()).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.views).not.toHaveBeenCalled();
    },
  );
  it('update revocation during source read removes actionability while preserving authorized read count', async () => {
    const f = fixture();
    f.sync.cases.mockImplementationOnce(() => {
      f.state.permissions = [READ];
      return Promise.resolve({ items: [source('source-ready')] });
    });
    expect(await f.list()).toMatchObject({
      total: 0,
      countExact: true,
      queueCounts: { todo: 0 },
    });
  });
  it.each(['status', 'custody', 'owner', 'next', 'inspection'])(
    'uses native %s after a source wait instead of the old scanned row',
    async (kind) => {
      const row = piece('ready');
      const f = fixture([row]);
      f.sync.cases.mockImplementationOnce(() => {
        if (kind === 'status') {
          row.status = 'WAITING_CUSTOMER';
          workflow(row).csr!.status = 'SENT';
        }
        if (kind === 'custody') row.custodianId = OTHER;
        if (kind === 'owner') row.repairOwnerId = OTHER;
        if (kind === 'next') row.nextUserId = OTHER;
        if (kind === 'inspection')
          (row.repairInspection as InspectionDocument).revision++;
        return Promise.resolve({ items: [source('source-ready')] });
      });
      const result = await f.list();
      expect(result).toMatchObject({
        total: kind === 'inspection' ? 1 : 0,
        countExact: true,
        unknownCount: 0,
      });
      if (kind === 'inspection')
        expect(result.items[0].todoKind).toBe('INSPECTION');
      else expect(result.items).toEqual([]);
      expect(f.sync.cases).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps requests at five in parallel and stops launches at 16 seconds, marking every unlaunched piece unknown', async () => {
    jest.useFakeTimers();
    const f = fixture(
      Array.from({ length: 25 }, (_, i) => piece('budget-' + i)),
    );
    let running = 0;
    let peak = 0;
    f.sync.cases.mockImplementation(
      (_entityId, _search, id) =>
        new Promise((resolve) => {
          running++;
          peak = Math.max(peak, running);
          setTimeout(() => {
            running--;
            resolve({ items: [source(id)] });
          }, 7999);
        }),
    );
    const promise = f.list();
    await jest.advanceTimersByTimeAsync(23998);
    const result = await promise;
    expect(peak).toBe(5);
    expect(f.sync.cases).toHaveBeenCalledTimes(15);
    expect(result).toMatchObject({
      total: 15,
      countExact: false,
      unknownCount: 10,
    });
    expect(result.queueCounts).not.toHaveProperty('todo');
    expect(jest.getTimerCount()).toBe(0);
  });
  it('bounds hung reads at eight seconds per launch and never launches another wave after the deadline', async () => {
    jest.useFakeTimers();
    const f = fixture(Array.from({ length: 20 }, (_, i) => piece('hang-' + i)));
    f.sync.cases.mockImplementation(() => new Promise(() => undefined));
    const promise = f.list();
    await jest.advanceTimersByTimeAsync(16000);
    expect(await promise).toMatchObject({
      total: 0,
      countExact: false,
      unknownCount: 20,
    });
    expect(f.sync.cases).toHaveBeenCalledTimes(10);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('does not collapse transport rejection into valid empty data, nor use receipt snapshot as release', async () => {
    const f = fixture();
    f.sync.cases.mockRejectedValue(new Error('synthetic unavailable'));
    const result = await f.list({ summary: 'true' });
    expect(result).toMatchObject({
      countExact: false,
      unknownCount: 1,
      total: 0,
    });
    expect(result.queueCounts).not.toHaveProperty('todo');
  });
  it('counts candidate scan time within the request launch budget instead of extending it', async () => {
    const f = fixture();
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(16000);
    const result = await f.list();
    expect(result).toMatchObject({
      total: 0,
      countExact: false,
      unknownCount: 1,
    });
    expect(result.queueCounts).not.toHaveProperty('todo');
    expect(f.sync.cases).not.toHaveBeenCalled();
  });
  it.each(['version', 'custody', 'owner', 'next', 'status', 'receipt entity'])(
    'withholds a late changed %s at page hydration without returning stale data or an exact badge',
    async (kind) => {
      const row = piece('ready');
      const f = fixture([row]);
      const read = f.prisma.mailroomItem.findMany.getMockImplementation()!;
      f.prisma.mailroomItem.findMany.mockImplementation((query) => {
        if (query.include) {
          if (kind === 'version') row.version++;
          if (kind === 'custody') row.custodianId = OTHER;
          if (kind === 'owner') row.repairOwnerId = OTHER;
          if (kind === 'next') row.nextUserId = OTHER;
          if (kind === 'status') row.status = 'WAITING_CUSTOMER';
          if (kind === 'receipt entity') row.receipt.entityId = FOREIGN;
        }
        return read(query);
      });
      const result = await f.list();
      expect(result).toMatchObject({
        items: [],
        total: 0,
        countExact: false,
        unknownCount: 1,
      });
      expect(result.queueCounts).not.toHaveProperty('todo');
      expect(f.sync.cases).toHaveBeenCalledTimes(1);
    },
  );
});

describe('repair todo actual Nest controller and production JWT boundary', () => {
  let app: INestApplication<Server>;
  let f: ReturnType<typeof fixture>;
  let token: string;
  const secret = 'synthetic-repair-todo-local-test-signing-key';
  const path = '/api/v1/repair-workbench/todo';
  beforeEach(async () => {
    const other = piece('foreign');
    other.entityId = FOREIGN;
    other.receipt.entityId = FOREIGN;
    f = fixture([piece('ready'), other]);
    const module = await Test.createTestingModule({
      controllers: [RepairWorkbenchController],
      providers: [
        { provide: RepairTodoService, useValue: f.service },
        { provide: RepairWorkbenchService, useValue: {} },
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
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    token = new JwtService().sign(
      { sub: USER, email: 'synthetic@example.invalid' },
      { secret, expiresIn: '5m' },
    );
  });
  afterEach(async () => {
    await app?.close();
  });
  const get = (query: Record<string, unknown> = { entityId: COMPANY }) =>
    request(app.getHttpServer())
      .get(path)
      .query(query)
      .set('Authorization', `Bearer ${token}`);
  it.each(['', 'invalid-token'])(
    'returns 401 for invalid/missing JWT (%s) before actor/DB/source',
    async (bearer) => {
      const call = request(app.getHttpServer())
        .get(path)
        .query({ entityId: COMPANY });
      if (bearer) call.set('Authorization', `Bearer ${bearer}`);
      await call.expect(401);
      expect(f.prisma.user.findUnique).not.toHaveBeenCalled();
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );
  it('returns 200 for a scoped authenticated reader and never includes foreign entity or source financial payload', async () => {
    const response = await get().expect(200);
    const body = response.body as Awaited<
      ReturnType<RepairTodoService['list']>
    >;
    expect(response.body).toMatchObject({
      total: 1,
      page: 1,
      countExact: true,
      queueCounts: { todo: 1, acceptance: 0 },
    });
    expect(body.items.map((item) => item.id)).toEqual(['ready']);
    expect(f.sync.cases.mock.calls).toEqual([[COMPANY, '', 'source-ready']]);
    expect(JSON.stringify(response.body)).not.toContain(
      'PRIVATE_FINANCIAL_SNAPSHOT',
    );
    expect(JSON.stringify(response.body)).not.toContain('releaseInfo');
  });
  it('keeps summary on the same HTTP authorization and fresh-source gate', async () => {
    const response = await get({ entityId: COMPANY, summary: 'true' }).expect(
      200,
    );
    expect(response.body).toMatchObject({
      items: [],
      total: 1,
      countExact: true,
      queueCounts: { todo: 1 },
    });
    expect(f.views).not.toHaveBeenCalled();
    expect(f.sync.cases).toHaveBeenCalledTimes(1);
  });
  it.each(['permission', 'entity', 'active', 'employee'])(
    'returns 403 for %s before source or item projection',
    async (kind) => {
      if (kind === 'permission') f.state.permissions = ['mailroom:read'];
      if (kind === 'active') f.state.active = false;
      if (kind === 'employee') f.state.employeeActive = false;
      await get({ entityId: kind === 'entity' ? FOREIGN : COMPANY }).expect(
        403,
      );
      expect(f.sync.cases).not.toHaveBeenCalled();
      expect(f.views).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { entityId: '' },
    { entityId: 'x'.repeat(129) },
    { entityId: COMPANY, page: '0' },
    { entityId: COMPANY, page: '100001' },
    { entityId: COMPANY, page: '1.5' },
    { entityId: COMPANY, page: 'not-a-page' },
    { entityId: COMPANY, search: 'x'.repeat(101) },
    { entityId: COMPANY, summary: 'TRUE' },
    { entityId: COMPANY, summary: '0' },
  ])(
    'rejects invalid query %# with production implicit conversion',
    async (query) => {
      await get(query).expect(400);
      expect(f.prisma.user.findUnique).not.toHaveBeenCalled();
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );
  it('preserves unknown count over HTTP instead of publishing zero as a complete badge', async () => {
    f.sync.cases.mockRejectedValue(new Error('synthetic unavailable'));
    const response = await get().expect(200);
    const body = response.body as Awaited<
      ReturnType<RepairTodoService['list']>
    >;
    expect(response.body).toMatchObject({
      items: [],
      total: 0,
      countExact: false,
      unknownCount: 1,
    });
    expect(body.queueCounts).not.toHaveProperty('todo');
  });
});
