/* eslint-disable @typescript-eslint/require-await -- Local Prisma-compatible mocks return promises without IO. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Mutable malformed database fixtures exercise runtime validation through the actual service. */
/* eslint-disable @typescript-eslint/unbound-method -- Method references are passed only to Nest and Reflect metadata inspection. */
import { ServiceUnavailableException } from '@nestjs/common';
import {
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { writeFileSync } from 'node:fs';
import { B2bAwareJwtAuthGuard } from '../b2b/b2b-auth.guard';
import type { B2bService } from '../b2b/b2b.service';
import * as readerAuth from './mailroom.auth';
import {
  fingerprint,
  signRequest,
  type Actor,
  type SourceCase,
} from './mailroom.contract';
import {
  inspectionPlanHash,
  type InspectionData,
} from './repair-document.contract';
import {
  buildRepairProposalEvent,
  type RepairProposalItem,
} from './repair-proposal.contract';
import {
  deliveredRepairProposalBinding,
  verifiedDeliveredRepairProposal,
} from './repair-assessment-release';
import { validateAssessmentAuthorityResponse } from './repair-assessment-reader.contract';
import { RepairAssessmentReaderController } from './repair-assessment-reader.controller';
import {
  ASSESSMENT_READER_CLOCK,
  RepairAssessmentReaderService,
} from './repair-assessment-reader.service';

const NOW = '2026-10-15T10:00:00.000Z';
const ENTITY = 'synthetic-company';
const CASE = 'synthetic-source-case';
const NUMBER = 'SYNTHETIC-REPAIR-CASE';
const SECRET = 'synthetic-local-reader-secret-at-least-32-characters';
const id = (prefix: number, index: number) =>
  `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const actor: Actor = {
  id: 'tech',
  name: 'PRIVATE_TECH_NAME',
  entityIds: [ENTITY],
  permissions: new Set(['repair_workbench:update']),
};

function piece(
  index = 1,
  mode:
    | 'USER_CAUSED'
    | 'PRODUCT_FAULT'
    | 'UNDETERMINED'
    | 'LEGACY' = 'USER_CAUSED',
) {
  const data: InspectionData = {
    protocol: 2,
    materialPlan: { mode: 'NONE', lines: [] },
    complaint: 'PRIVATE_COMPLAINT',
    reproduction: 'YES',
    testConditions: 'PRIVATE_CONDITIONS',
    checks: [
      {
        key: 'functional',
        name: 'Synthetic observation',
        result: 'PASS',
        observation: 'PRIVATE_OBSERVATION',
      },
    ],
    diagnosis: 'PRIVATE_CAUSAL_EXPLANATION',
    causeStatus: mode === 'UNDETERMINED' ? 'UNKNOWN' : 'CONFIRMED',
    plan: 'REPAIR',
    planNote: 'PRIVATE_PLAN',
    feeSuggestion: 'FREE',
    estimateNote: 'PRIVATE_ESTIMATE',
    ...(mode === 'UNDETERMINED'
      ? {}
      : { isAccidentalDamage: mode === 'USER_CAUSED' || mode === 'LEGACY' }),
    ...(mode === 'LEGACY'
      ? {}
      : {
          assessment: {
            schema: 1,
            conclusion: mode,
            basis: mode === 'UNDETERMINED' ? '' : 'PRIVATE_BASIS',
            causalExplanation: 'PRIVATE_CAUSAL_EXPLANATION',
            checkKeys: mode === 'UNDETERMINED' ? [] : ['functional'],
            mediaIds: [],
          },
        }),
  };
  const item = {
    id: id(1, index),
    entityId: ENTITY,
    receiptId: id(2, index),
    version: 8,
    status: 'WAITING_CUSTOMER',
    label: 'SYNTHETIC-' + index,
    productName: 'PRIVATE_PRODUCT',
    productId: 'synthetic-product',
    sku: 'SYNTHETIC-SKU',
    serialNumber: 'PRIVATE_SERIAL',
    declared: { id: 'source-line-' + index },
    repairOwnerId: 'tech',
    custodianId: 'tech',
    repairInspection: {
      number: 'INS-SYNTHETIC-' + index,
      revision: 1,
      status: 'SUBMITTED',
      authorId: 'tech',
      authorName: actor.name,
      updatedAt: '2026-10-15T09:00:00.000Z',
      submittedAt: '2026-10-15T09:00:00.000Z',
      data,
    },
    repairWorkflow: { schema: 1 } as Record<string, any>,
    receipt: {
      entityId: ENTITY,
      category: 'REPAIR',
      sourceCaseId: CASE,
      sourceNumber: NUMBER,
    },
  };
  const hash = inspectionPlanHash(item.repairInspection as any);
  if (mode !== 'LEGACY')
    item.repairWorkflow.assessmentPolicy = {
      schema: 1,
      inspectionRevision: 1,
      planHash: hash,
    };
  const submission = structuredClone(item);
  submission.version = 5;
  submission.status = 'INSPECTING';
  const submitAction = {
    id: id(3, index),
    entityId: ENTITY,
    itemId: item.id,
    actorId: 'tech',
    actorName: actor.name,
    requestId: 'original-submit-' + index,
    requestHash: fingerprint({
      kind: 'inspection',
      entityId: ENTITY,
      requestId: 'original-submit-' + index,
      expectedVersion: 4,
      status: 'SUBMITTED',
      data,
    }),
    action: 'submit_repair_inspection',
    fromStatus: 'INSPECTING',
    toStatus: 'INSPECTING',
    version: 5,
    snapshot: submission,
  };
  const actions: any[] = [submitAction];
  if (mode === 'USER_CAUSED') {
    item.repairWorkflow.csr = {
      status: 'ACCEPTED',
      ownerId: 'csr',
      inspectionRevision: 1,
      estimateRevision: 1,
      quoteRevision: null,
      planHash: hash,
    };
    item.repairWorkflow.assessmentReview = {
      schema: 1,
      inspectionRevision: 1,
      planHash: hash,
      reviewerId: 'csr',
      reviewerName: 'PRIVATE_CSR_NAME',
      reviewedAt: '2026-10-15T09:30:00.000Z',
      decision: 'APPROVE',
      note: 'PRIVATE_REVIEW_NOTE',
    };
    actions.push({
      id: id(4, index),
      entityId: ENTITY,
      itemId: item.id,
      actorId: 'csr',
      actorName: 'PRIVATE_CSR_NAME',
      requestId: 'independent-review-' + index,
      requestHash: fingerprint({ synthetic: 'independent-review-' + index }),
      action: 'review_assessment',
      fromStatus: 'WAITING_CUSTOMER',
      toStatus: 'WAITING_CUSTOMER',
      version: 8,
      snapshot: structuredClone(item),
    });
  }
  const source: SourceCase = {
    id: CASE,
    number: NUMBER,
    type: 'REPAIR',
    status: 'INSPECTING',
    version: 'source-current-version',
    customerLabel: 'PRIVATE_CUSTOMER',
    repairAllowed: false,
    items: [
      {
        id: 'source-line-' + index,
        name: 'PRIVATE_PRODUCT',
        sku: item.sku,
        serialNumber: item.serialNumber,
        quantity: 1,
      },
    ],
    releaseInfo: {
      quoteRevision: 1,
      customerApprovedQuoteRevision: null,
      customerApprovedAt: null,
      amount: null,
      currency: 'TWD',
      confirmedPaymentQuoteRevision: null,
    },
  };
  const event = buildRepairProposalEvent({
    eventId: id(5, index),
    occurredAt: '2026-10-15T09:15:00.000Z',
    actor,
    item: { ...item, version: 6 } as unknown as RepairProposalItem,
    source,
  });
  const delivery = {
    id: id(6, index),
    entityId: ENTITY,
    itemId: item.id,
    eventId: event.eventId,
    target: 'AFTER_SALES',
    status: 'DELIVERED',
    deliveredAt: new Date('2026-10-15T09:16:00.000Z'),
    createdAt: new Date('2026-10-15T09:15:00.000Z'),
    payload: structuredClone(event),
  };
  return { item, actions, delivery, event };
}

function fixture(pieces = [piece()]) {
  let monotonic = 0;
  const rows = pieces.map((p) => p.item),
    actions = pieces.flatMap((p) => p.actions),
    deliveries = pieces.map((p) => p.delivery);
  const db = {
    $executeRaw: jest.fn(async () => 0),
    $queryRaw: jest.fn(async () => [{ set_config: '750' }]),
    $transaction: jest.fn(),
    mailroomItem: { findMany: jest.fn(async () => structuredClone(rows)) },
    mailroomAction: { findMany: jest.fn(async () => structuredClone(actions)) },
    mailroomDelivery: {
      findMany: jest.fn(async () => structuredClone(deliveries)),
    },
  };
  db.$transaction.mockImplementation(
    (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
  );
  const clock = {
    wallNow: () => Date.parse(NOW),
    monotonicNow: () => monotonic,
  };
  const service = new RepairAssessmentReaderService(
    db as unknown as PrismaService,
    clock,
  );
  return {
    rows,
    actions,
    deliveries,
    db,
    clock,
    service,
    advance: (ms: number) => {
      monotonic = ms;
    },
    pieces,
  };
}
async function expectUnavailable(work: Promise<unknown>) {
  try {
    await work;
    throw new Error('expected unavailable');
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      message: 'REPAIR_ASSESSMENT_AUTHORITY_UNAVAILABLE',
    });
  }
}

describe('local assessment authority reader uses actual immutable contracts', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());
  it.each(['USER_CAUSED', 'PRODUCT_FAULT', 'UNDETERMINED', 'LEGACY'] as const)(
    'returns a strict minimal verified %s response without Source or provider reads',
    async (mode) => {
      const f = fixture([piece(1, mode)]),
        result = await f.service.read(ENTITY, CASE),
        row = result.items[0];
      expect(validateAssessmentAuthorityResponse(result)).toEqual(result);
      expect(result).toMatchObject({
        schema: 'corely.repair.assessment-authority.v1',
        entityId: ENTITY,
        sourceCaseId: CASE,
        sourceNumber: NUMBER,
        observedAt: NOW,
        complete: true,
        itemCount: 1,
      });
      expect(row.nativeVersion).toBe(8);
      expect(row.proposalBinding).toEqual({
        eventId: f.pieces[0].event.eventId,
        receiptId: row.receiptId,
        itemId: row.itemId,
        sourceVersion: 6,
        planVersion: 1,
        planHash: row.inspectionRef!.planHash,
        proposalHash: f.pieces[0].event.proposal.proposalHash,
      });
      expect(row.authority).toMatchObject({
        state: 'READY',
        policy: mode === 'LEGACY' ? 'PROVEN_LEGACY_SUBMISSION' : 'FAIR_V1',
        conclusion: mode === 'LEGACY' ? null : mode,
      });
      if (mode === 'USER_CAUSED')
        expect(row.authority.review).toEqual({
          decision: 'APPROVE',
          inspectionRevision: 1,
          planHash: row.inspectionRef!.planHash,
          actionId: id(4, 1),
          actionVersion: 8,
        });
      else expect(row.authority.review).toBeNull();
      const json = JSON.stringify(result);
      for (const privateText of [
        'PRIVATE_TECH_NAME',
        'PRIVATE_CSR_NAME',
        'PRIVATE_BASIS',
        'PRIVATE_REVIEW_NOTE',
        'PRIVATE_CAUSAL_EXPLANATION',
        'PRIVATE_CUSTOMER',
        'PRIVATE_PRODUCT',
        'PRIVATE_SERIAL',
      ])
        expect(json).not.toContain(privateText);
      expect(f.db.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: 'RepeatableRead',
        maxWait: 250,
        timeout: 750,
      });
      expect(f.db.$executeRaw.mock.calls).toHaveLength(1);
      expect(f.db.$executeRaw.mock.calls[0][0].sql).toBe(
        'SET TRANSACTION READ ONLY',
      );
      expect(
        f.db.$queryRaw.mock.calls.every(([sql]) =>
          sql.sql.includes("set_config('statement_timeout'"),
        ),
      ).toBe(true);
    },
  );
  it.each(['USER_CAUSED', 'PRODUCT_FAULT', 'UNDETERMINED', 'LEGACY'] as const)(
    'never grants %s readiness without a DELIVERED original proposal',
    async (mode) => {
      const f = fixture([piece(1, mode)]);
      f.deliveries.length = 0;
      expect((await f.service.read(ENTITY, CASE)).items[0]).toMatchObject({
        proposalBinding: null,
        authority: {
          state: 'UNKNOWN',
          policy: null,
          conclusion: null,
          review: null,
        },
      });
    },
  );
  it.each([
    'MISSING',
    'REVISE',
    'STALE_HASH',
    'SELF',
    'MISSING_ACTION',
    'ACTION_ID_MISSING',
  ] as const)(
    'does not turn %s human approval into a READY result',
    async (fault) => {
      const f = fixture(),
        workflow = f.rows[0].repairWorkflow;
      if (fault === 'MISSING') delete workflow.assessmentReview;
      if (fault === 'REVISE') workflow.assessmentReview.decision = 'REVISE';
      if (fault === 'STALE_HASH')
        workflow.assessmentReview.planHash = 'a'.repeat(64);
      if (fault === 'SELF') workflow.assessmentReview.reviewerId = 'tech';
      if (fault === 'MISSING_ACTION') f.actions.splice(1, 1);
      if (fault === 'ACTION_ID_MISSING') delete f.actions[1].id;
      const row = (await f.service.read(ENTITY, CASE)).items[0];
      expect(row.authority.state).not.toBe('READY');
      expect(row.authority.policy).toBeNull();
      expect(row.authority.conclusion).toBeNull();
      expect(row.authority.review).toBeNull();
    },
  );
  it('does not convert a missing new policy or changed current inspection into legacy', async () => {
    const f = fixture();
    delete f.rows[0].repairWorkflow.assessmentPolicy;
    expect((await f.service.read(ENTITY, CASE)).items[0].authority).toEqual({
      state: 'UNKNOWN',
      policy: null,
      conclusion: null,
      review: null,
    });
    f.rows[0].repairInspection.data.diagnosis = 'changed current finding';
    expect((await f.service.read(ENTITY, CASE)).items[0].authority.state).toBe(
      'UNKNOWN',
    );
  });
  it('keeps the existing legacy wrapper at exactly four fields and derives metadata from the same validated receipt', async () => {
    const p = piece(1, 'LEGACY');
    const db = {
      mailroomDelivery: { findFirst: jest.fn(async () => p.delivery) },
    } as unknown as Parameters<typeof deliveredRepairProposalBinding>[1];
    const binding = await deliveredRepairProposalBinding(
      p.item as unknown as RepairProposalItem,
      db,
    );
    expect(Object.keys(binding!).sort()).toEqual([
      'itemId',
      'planHash',
      'planVersion',
      'proposalHash',
    ]);
    const verified = await verifiedDeliveredRepairProposal(
      p.item as unknown as RepairProposalItem,
      db,
    );
    expect(verified).toEqual({
      binding,
      eventId: p.delivery.eventId,
      receiptId: p.event.receiptId,
      sourceVersion: p.event.version,
    });
  });
  it.each([
    'rowEventId',
    'payloadEventId',
    'receiptId',
    'itemId',
    'sourceVersion',
    'notDelivered',
  ] as const)(
    'rejects a same-hash delivery with mismatched %s metadata',
    async (fault) => {
      const f = fixture(),
        delivery = f.deliveries[0];
      if (fault === 'rowEventId') delivery.eventId = id(9, 1);
      if (fault === 'payloadEventId') delivery.payload.eventId = id(9, 2);
      if (fault === 'receiptId') delivery.payload.receiptId = id(9, 3);
      if (fault === 'itemId') delivery.payload.itemId = id(9, 4);
      if (fault === 'sourceVersion') delivery.payload.version = 9;
      if (fault === 'notDelivered') delivery.status = 'PENDING';
      expect(
        (await f.service.read(ENTITY, CASE)).items[0].authority.state,
      ).toBe('UNKNOWN');
    },
  );
  it('includes the complete 200-item set with a fixed number of local batched reads', async () => {
    const f = fixture(
      Array.from({ length: 200 }, (_, index) =>
        piece(index + 1, 'UNDETERMINED'),
      ),
    );
    const result = await f.service.read(ENTITY, CASE);
    expect(result.items).toHaveLength(200);
    expect(result.itemCount).toBe(200);
    expect(f.db.mailroomItem.findMany).toHaveBeenCalledTimes(1);
    expect(f.db.mailroomAction.findMany).toHaveBeenCalledTimes(1);
    expect(f.db.mailroomDelivery.findMany).toHaveBeenCalledTimes(1);
  });
  it.each([
    'overflow',
    'duplicate',
    'foreignEntity',
    'foreignReceipt',
    'wrongSource',
    'sourceNumber',
    'empty',
  ] as const)(
    'fails the complete batch for %s without truncation or partial success',
    async (fault) => {
      const f = fixture();
      if (fault === 'overflow')
        f.rows.push(
          ...Array.from(
            { length: 200 },
            (_, i) => piece(i + 2, 'UNDETERMINED').item,
          ),
        );
      if (fault === 'duplicate') f.rows.push(structuredClone(f.rows[0]));
      if (fault === 'foreignEntity') f.rows[0].entityId = 'foreign-company';
      if (fault === 'foreignReceipt')
        f.rows[0].receipt.entityId = 'foreign-company';
      if (fault === 'wrongSource')
        f.rows[0].receipt.sourceCaseId = 'foreign-case';
      if (fault === 'sourceNumber') {
        f.rows.push(piece(2).item);
        f.rows[1].receipt.sourceNumber = 'foreign-number';
      }
      if (fault === 'empty') f.rows.length = 0;
      await expectUnavailable(f.service.read(ENTITY, CASE));
      expect(f.db.mailroomAction.findMany).not.toHaveBeenCalled();
    },
  );
  it('enforces the UTF8 response limit after full validation rather than returning a partial set', async () => {
    const f = fixture(
      Array.from({ length: 200 }, (_, index) => {
        const p = piece(index + 1, 'LEGACY');
        p.item.repairInspection.number = '測'.repeat(200);
        p.actions[0].snapshot.repairInspection.number =
          p.item.repairInspection.number;
        p.delivery.payload.proposal.inspectionDocumentId =
          p.item.repairInspection.number;
        // Rebuild the original strict hash after changing the synthetic document number.
        const source: SourceCase = {
          id: CASE,
          number: NUMBER,
          type: 'REPAIR',
          status: 'INSPECTING',
          version: NOW,
          customerLabel: 'SYNTHETIC',
          repairAllowed: false,
          items: [
            {
              id: 'source-line-' + (index + 1),
              name: p.item.productName,
              quantity: 1,
              sku: p.item.sku,
              serialNumber: p.item.serialNumber,
            },
          ],
          releaseInfo: {
            quoteRevision: 1,
            customerApprovedQuoteRevision: null,
            customerApprovedAt: null,
            amount: null,
            currency: 'TWD',
            confirmedPaymentQuoteRevision: null,
          },
        };
        p.delivery.payload = structuredClone(
          buildRepairProposalEvent({
            eventId: p.event.eventId,
            occurredAt: p.event.occurredAt,
            actor,
            item: { ...p.item, version: 6 } as unknown as RepairProposalItem,
            source,
          }),
        );
        return p;
      }),
    );
    await expectUnavailable(f.service.read(ENTITY, CASE));
  });
  it('includes acquisition in the one-second budget and performs no read after deadline', async () => {
    const f = fixture();
    f.db.$transaction.mockImplementationOnce(
      (callback: (tx: typeof f.db) => Promise<unknown>) => {
        f.advance(1001);
        return callback(f.db);
      },
    );
    await expectUnavailable(f.service.read(ENTITY, CASE));
    expect(f.db.$executeRaw).not.toHaveBeenCalled();
  });
  it('sets bounded SQL/transaction timeouts and aborts subsequent work after a hung mocked read', async () => {
    const f = fixture();
    let finish: (value: any) => void = () => {};
    f.db.mailroomItem.findMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const assertion = expectUnavailable(f.service.read(ENTITY, CASE));
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    finish(structuredClone(f.rows));
    await Promise.resolve();
    await Promise.resolve();
    expect(f.db.mailroomAction.findMany).not.toHaveBeenCalled();
    expect(f.db.mailroomDelivery.findMany).not.toHaveBeenCalled();
    const options = f.db.$transaction.mock.calls[0][1];
    expect(options.maxWait + options.timeout).toBeLessThanOrEqual(1000);
    expect(f.db.$queryRaw.mock.calls[0][0].values[0]).toBe('750');
  });
  it('does not expose a DB/provider error or cached authority when a fresh local read fails', async () => {
    const f = fixture();
    await f.service.read(ENTITY, CASE);
    f.db.mailroomAction.findMany.mockRejectedValueOnce(
      new Error('PRIVATE_DB_PASSWORD_AND_PROVIDER_URL'),
    );
    await expectUnavailable(f.service.read(ENTITY, CASE));
  });
  it('rejects strict-schema extra fields and impossible authority discriminants', async () => {
    const result = await fixture().service.read(ENTITY, CASE);
    expect(() =>
      validateAssessmentAuthorityResponse({ ...result, employeeId: 'private' }),
    ).toThrow();
    const bad = structuredClone(result);
    Object.assign(bad.items[0].authority, {
      policy: 'PROVEN_LEGACY_SUBMISSION',
      conclusion: 'USER_CAUSED',
    });
    expect(() => validateAssessmentAuthorityResponse(bad)).toThrow();
  });
  it('validates sanitized wire conformance samples from actual service executions', async () => {
    const samples: { name: string; response: unknown }[] = [];
    for (const mode of [
      'USER_CAUSED',
      'PRODUCT_FAULT',
      'UNDETERMINED',
      'LEGACY',
    ] as const) {
      samples.push({
        name:
          mode === 'USER_CAUSED'
            ? 'FAIR_USER_APPROVED'
            : mode === 'LEGACY'
              ? 'PROVEN_LEGACY'
              : `FAIR_${mode}`,
        response: await fixture([piece(1, mode)]).service.read(ENTITY, CASE),
      });
    }
    const blocked = fixture();
    delete blocked.rows[0].repairWorkflow.assessmentReview;
    samples.push({
      name: 'BLOCKED_USER_REVIEW',
      response: await blocked.service.read(ENTITY, CASE),
    });
    const unknown = fixture();
    unknown.deliveries.length = 0;
    samples.push({
      name: 'UNKNOWN_DELIVERY',
      response: await unknown.service.read(ENTITY, CASE),
    });
    const output = {
      interfaceSHA256:
        '0c77f91b25b80482bb5e5cc3ce5a58e9ceff3d21456fdd6e9c4ebf2f6c3d841b',
      fixture: {
        entityId: ENTITY,
        sourceCaseId: CASE,
        sourceNumber: NUMBER,
        observedAt: NOW,
      },
      samples,
    };
    const text = JSON.stringify(output, null, 2) + '\n';
    for (const denied of [
      SECRET,
      'PRIVATE_TECH_NAME',
      'PRIVATE_CSR_NAME',
      'PRIVATE_BASIS',
      'PRIVATE_REVIEW_NOTE',
      'PRIVATE_CUSTOMER',
    ])
      expect(text).not.toContain(denied);
    const samplePath = process.env.REPAIR_ASSESSMENT_SAMPLE_PATH;
    if (samplePath) writeFileSync(samplePath, text, { mode: 0o600 });
    expect(samples).toHaveLength(6);
  });
});

describe('actual Nest controller, global guard branch and HMAC contract with mocked HTTP', () => {
  let authSpy: jest.SpyInstance;
  const authenticate = readerAuth.authenticateMailroomReader;
  const env = {
    MAILROOM_ENABLED: 'true',
    MAILROOM_READERS: JSON.stringify([
      { keyId: 'synthetic-source-reader', entityId: ENTITY, secret: SECRET },
    ]),
  };
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
    env.MAILROOM_READERS = JSON.stringify([
      { keyId: 'synthetic-source-reader', entityId: ENTITY, secret: SECRET },
    ]);
    authSpy = jest
      .spyOn(readerAuth, 'authenticateMailroomReader')
      .mockImplementation((req) => authenticate(req, env));
  });
  afterEach(() => {
    authSpy.mockRestore();
    jest.useRealTimers();
  });
  const request = (
    path = `/api/v1/mailroom/integration/cases/${CASE}/repair-assessments`,
    method = 'GET',
  ) => {
    const time = String(Date.parse(NOW) / 1000);
    return {
      method,
      originalUrl: path,
      headers: {
        'x-mailroom-key': 'synthetic-source-reader',
        'x-mailroom-entity': ENTITY,
        'x-mailroom-time': time,
        'x-mailroom-signature': signRequest(
          SECRET,
          method,
          path,
          time,
          '',
          ENTITY,
        ),
      } as Record<string, string>,
      mailroomEntityId: 'untrusted-before-guard',
      user: { id: 'not-reader-authority' },
    };
  };
  async function mount() {
    const f = fixture();
    const module = await Test.createTestingModule({
      controllers: [RepairAssessmentReaderController],
      providers: [
        RepairAssessmentReaderService,
        { provide: PrismaService, useValue: f.db },
        { provide: ASSESSMENT_READER_CLOCK, useValue: f.clock },
      ],
    }).compile();
    const controller = module.get(RepairAssessmentReaderController),
      guard = new B2bAwareJwtAuthGuard(new Reflector(), {} as B2bService);
    const invoke = async (req: ReturnType<typeof request>) => {
      const context = new ExecutionContextHost(
        [req],
        RepairAssessmentReaderController,
        controller.read,
      );
      expect(guard.canActivate(context)).toBe(true);
      return controller.read(req, CASE);
    };
    return { f, module, controller, guard, invoke };
  }
  it('resolves real DI and authenticates the exact GET using the trusted entry instead of JWT/body company', async () => {
    const m = await mount();
    try {
      const req = request(),
        result = await m.invoke(req);
      expect(req.mailroomEntityId).toBe(ENTITY);
      expect(result.entityId).toBe(ENTITY);
      expect(
        Reflect.getMetadata(PATH_METADATA, RepairAssessmentReaderController),
      ).toBe('mailroom/integration/cases');
      expect(Reflect.getMetadata(PATH_METADATA, m.controller.read)).toBe(
        ':sourceCaseId/repair-assessments',
      );
      expect(Reflect.getMetadata(METHOD_METADATA, m.controller.read)).toBe(0);
      expect(Reflect.getMetadata(HEADERS_METADATA, m.controller.read)).toEqual(
        expect.arrayContaining([
          { name: 'Cache-Control', value: 'no-store' },
          { name: 'Content-Type', value: 'application/json' },
        ]),
      );
    } finally {
      await m.module.close();
    }
  });
  it.each([
    'unsigned',
    'foreignEntity',
    'wrongKey',
    'stale',
    'query',
    'trailingSlash',
    'otherChild',
    'wrongMethod',
    'body',
    'ambiguousEntry',
  ] as const)('rejects %s before any local DB read', async (fault) => {
    const m = await mount();
    try {
      const req = request();
      if (fault === 'unsigned') delete req.headers['x-mailroom-signature'];
      if (fault === 'foreignEntity')
        req.headers['x-mailroom-entity'] = 'foreign-company';
      if (fault === 'wrongKey') req.headers['x-mailroom-key'] = 'other-reader';
      if (fault === 'stale')
        req.headers['x-mailroom-time'] = String(Date.parse(NOW) / 1000 - 61);
      if (fault === 'query') req.originalUrl += '?entityId=foreign';
      if (fault === 'trailingSlash') req.originalUrl += '/';
      if (fault === 'otherChild') req.originalUrl += '/any';
      if (fault === 'wrongMethod') req.method = 'POST';
      if (fault === 'body') req.headers['content-length'] = '2';
      if (fault === 'ambiguousEntry')
        env.MAILROOM_READERS = JSON.stringify([
          {
            keyId: 'synthetic-source-reader',
            entityId: ENTITY,
            secret: SECRET,
          },
          {
            keyId: 'synthetic-source-reader',
            entityId: ENTITY,
            secret: SECRET,
          },
        ]);
      await expect(m.invoke(req)).rejects.toThrow('MAILROOM_SIGNATURE_INVALID');
      expect(m.f.db.$transaction).not.toHaveBeenCalled();
    } finally {
      await m.module.close();
    }
  });
  it('rechecks a removed reader entry on the next request without changing runtime environment or feature flags', async () => {
    const m = await mount();
    try {
      await m.invoke(request());
      env.MAILROOM_READERS = '[]';
      await expect(m.invoke(request())).rejects.toThrow(
        'MAILROOM_SIGNATURE_INVALID',
      );
      expect(m.f.db.$transaction).toHaveBeenCalledTimes(1);
    } finally {
      await m.module.close();
    }
  });
  it('preserves the original exact case-progress HMAC route and does not allow a generic integration child', () => {
    const progress = request(`/api/v1/mailroom/integration/cases/${CASE}`);
    expect(authenticate(progress, env)).toBe(true);
    const foreign = request(
      `/api/v1/mailroom/integration/cases/${CASE}/documents`,
    );
    expect(() => authenticate(foreign, env)).toThrow(
      'MAILROOM_SIGNATURE_INVALID',
    );
  });
});
