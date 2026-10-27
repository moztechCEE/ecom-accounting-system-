/* Dynamic Prisma doubles emulate async methods and exercise malformed runtime boundaries. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  repairEvidenceFixture,
  EVIDENCE_COMPANY,
  EVIDENCE_TIME,
} from './repair-evidence.test.fixture';
import { RepairWorkbenchService } from './repair-workbench.service';
import {
  repairTemplateHash,
  type RepairTestTemplate,
} from './repair-template.contract';
import { inspectionPlanHash } from './repair-document.contract';
import { fingerprint } from './mailroom.contract';
import { buildRepairProposalEvent } from './repair-proposal.contract';
import * as authority from './repair-assessment-release';

type Row = Record<string, any>;
const tokenFrom = (link: string) =>
  new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND')
      return (Array.isArray(value) ? value : [value]).every((q) =>
        matches(row, q),
      );
    if (key === 'OR') return value.some((q: Row) => matches(row, q));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('path' in value)
        return (
          fingerprint(
            value.path.reduce(
              (selected: any, part: string) => selected?.[part],
              row[key],
            ),
          ) === fingerprint(value.equals)
        );
      if ('in' in value) return value.in.includes(row[key]);
      if ('lte' in value) return row[key] <= value.lte;
      if ('gte' in value) return row[key] >= value.gte;
    }
    return row[key] === value;
  });
}
function fixture(
  conclusion:
    | 'USER_CAUSED'
    | 'PRODUCT_FAULT'
    | 'UNDETERMINED'
    | 'LEGACY' = 'USER_CAUSED',
) {
  const f = repairEvidenceFixture();
  const tx = f.tx as unknown as Row,
    prisma = f.prisma as unknown as Row;
  const item = f.item as unknown as Row;
  if (conclusion === 'LEGACY') {
    item.id = '11111111-1111-4111-8111-111111111111';
    item.receiptId = '22222222-2222-4222-8222-222222222222';
    for (const asset of f.assets) {
      asset.itemId = item.id;
      asset.objectKey = `repair-media/${EVIDENCE_COMPANY}/${item.id}/${String(asset.id)}`;
    }
  }
  const template: RepairTestTemplate = {
    schema: 1,
    id: 'fair-report-template',
    revision: 1,
    contentHash: '',
    status: 'REVIEWED',
    entityId: EVIDENCE_COMPANY,
    productId: item.productId,
    sku: item.sku,
    reviewedById: 'technical-owner',
    reviewedAt: '2026-10-12T00:00:00.000Z',
    checks: [
      {
        key: 'power',
        name: '電源',
        requiredForInspection: true,
        requiredForCompletion: true,
        requiresCalibration: false,
        standard: { kind: 'OBSERVATION', instruction: '合成實際電源測試' },
      },
    ],
  };
  template.contentHash = repairTemplateHash(template);
  item.repairInspection.data.templateBinding = {
    id: template.id,
    revision: template.revision,
    contentHash: template.contentHash,
  };
  if (conclusion !== 'LEGACY') {
    item.repairInspection.data.assessment = {
      schema: 1,
      conclusion,
      basis: conclusion === 'UNDETERMINED' ? '' : '已核對本次異常',
      causalExplanation: item.repairInspection.data.diagnosis,
      checkKeys: conclusion === 'UNDETERMINED' ? [] : ['power'],
      mediaIds: conclusion === 'USER_CAUSED' ? ['inspection-media'] : [],
    };
    item.repairInspection.data.causeStatus =
      conclusion === 'UNDETERMINED' ? 'UNKNOWN' : 'CONFIRMED';
    if (conclusion !== 'UNDETERMINED')
      item.repairInspection.data.isAccidentalDamage =
        conclusion === 'USER_CAUSED';
  } else {
    item.repairInspection.data.isAccidentalDamage = false;
  }
  f.refresh();
  if (conclusion !== 'LEGACY') {
    item.repairWorkflow.assessmentPolicy = {
      schema: 1,
      inspectionRevision: item.repairInspection.revision,
      planHash: inspectionPlanHash(item.repairInspection),
    };
  }
  const actions: Row[] = [];
  const snapshot = () => structuredClone(item);
  const submission = snapshot();
  submission.version = 5;
  submission.repairWorkflow = {
    schema: 1,
    ...(conclusion !== 'LEGACY'
      ? {
          assessmentPolicy: structuredClone(
            item.repairWorkflow.assessmentPolicy,
          ),
        }
      : {}),
  };
  delete submission.repairInspection.review;
  actions.push({
    id: 'native-submit',
    entityId: EVIDENCE_COMPANY,
    itemId: item.id,
    action: 'submit_repair_inspection',
    actorId: 'tech',
    actorName: item.repairInspection.authorName,
    version: 5,
    requestId: 'synthetic-original-submit',
    requestHash: fingerprint({
      kind: 'inspection',
      data: item.repairInspection.data,
    }),
    fromStatus: 'INSPECTING',
    toStatus: 'INSPECTING',
    createdAt: new Date(item.repairInspection.submittedAt),
    snapshot: submission,
  });
  const addApprovedReceipt = () => {
    item.repairWorkflow.assessmentReview = {
      schema: 1,
      inspectionRevision: item.repairInspection.revision,
      planHash: inspectionPlanHash(item.repairInspection),
      reviewerId: 'csr',
      reviewerName: 'csr',
      reviewedAt: '2026-10-13T03:15:00.000Z',
      decision: 'APPROVE',
      note: '已核對原因與真實佐證',
    };
    const reviewed = snapshot();
    reviewed.version = 6;
    reviewed.status = 'WAITING_CUSTOMER';
    reviewed.repairWorkflow.csr.status = 'ACCEPTED';
    delete reviewed.repairWorkflow.csr.decision;
    delete reviewed.repairInspection.review;
    actions.push({
      id: 'native-review',
      entityId: EVIDENCE_COMPANY,
      itemId: item.id,
      action: 'review_assessment',
      actorId: 'csr',
      actorName: 'csr',
      version: 6,
      requestId: 'synthetic-original-review',
      requestHash: fingerprint(item.repairWorkflow.assessmentReview),
      fromStatus: 'WAITING_CUSTOMER',
      toStatus: 'WAITING_CUSTOMER',
      note: item.repairWorkflow.assessmentReview.note,
      createdAt: new Date(item.repairWorkflow.assessmentReview.reviewedAt),
      snapshot: reviewed,
    });
  };
  if (conclusion === 'USER_CAUSED') addApprovedReceipt();
  const find = ({ where, orderBy, take }: Row = {}) =>
    actions
      .filter((row) => matches(row, where))
      .sort((a, b) =>
        orderBy?.version === 'asc'
          ? a.version - b.version
          : b.version - a.version,
      )
      .slice(0, take ?? actions.length)
      .map((row) => structuredClone(row));
  tx.mailroomAction = {
    findFirst: jest.fn(async (q: Row) => find(q)[0] ?? null),
    findMany: jest.fn(async (q: Row) => find(q)),
    findUnique: jest.fn(async ({ where }: Row) =>
      structuredClone(
        actions.find((row) =>
          matches(row, where.entityId_actorId_requestId ?? where),
        ) ?? null,
      ),
    ),
  };
  const deliveries: Row[] = [];
  if (conclusion === 'LEGACY') {
    const event = buildRepairProposalEvent({
      eventId: '33333333-3333-4333-8333-333333333333',
      occurredAt: '2026-10-13T03:05:00.000Z',
      actor: {
        id: 'tech',
        name: '合成維修師',
        permissions: new Set(['repair_workbench:update']),
        entityIds: [EVIDENCE_COMPANY],
      },
      item: { ...item, version: 6, status: 'WAITING_CUSTOMER' } as never,
      source: f.source,
    });
    deliveries.push({
      entityId: EVIDENCE_COMPANY,
      itemId: item.id,
      eventId: event.eventId,
      target: 'AFTER_SALES',
      status: 'DELIVERED',
      deliveredAt: new Date('2026-10-13T03:06:00.000Z'),
      payload: event,
    });
  }
  tx.mailroomDelivery = {
    findFirst: jest.fn(async ({ where }: Row) =>
      structuredClone(deliveries.find((row) => matches(row, where)) ?? null),
    ),
    findMany: jest.fn(async ({ where }: Row) =>
      structuredClone(deliveries.filter((row) => matches(row, where))),
    ),
  };
  Object.assign(prisma, {
    mailroomAction: tx.mailroomAction,
    mailroomDelivery: tx.mailroomDelivery,
  });
  tx.employee.findFirst.mockImplementation(async ({ where }: Row) =>
    ['tech', 'csr', 'other-csr'].includes(where.userId)
      ? {
          id: 'employee-' + where.userId,
          userId: where.userId,
          entityId: EVIDENCE_COMPANY,
          isActive: true,
        }
      : null,
  );
  tx.mailroomItem.update = jest.fn(async ({ where, data }: Row) => {
    if (where.id !== item.id) throw Error('Wrong item mutation');
    const { version, ...values } = structuredClone(data);
    Object.assign(item, values);
    if (version?.increment) item.version += version.increment;
    return snapshot();
  });
  const record = jest.fn(
    async (
      _tx: unknown,
      actor: Row,
      updated: Row,
      action: string,
      requestId: string,
      requestHash: string,
      fromStatus: string,
      note: string,
    ) => {
      actions.push({
        id: 'action-' + actions.length,
        entityId: EVIDENCE_COMPANY,
        itemId: item.id,
        action,
        actorId: actor.id,
        actorName: actor.name,
        version: updated.version,
        requestId,
        requestHash,
        fromStatus,
        toStatus: updated.status,
        note,
        createdAt: new Date(),
        snapshot: structuredClone(updated),
      });
      return [];
    },
  );
  Object.assign(f.mailroom, { record, publish: jest.fn() });
  const transaction = f.prisma.$transaction.getMockImplementation()!;
  f.prisma.$transaction.mockImplementation(async (run: any) => {
    const beforeItem = snapshot(),
      beforeActions = structuredClone(actions);
    try {
      return await transaction(run);
    } catch (error) {
      for (const key of Object.keys(item)) delete item[key];
      Object.assign(item, beforeItem);
      actions.splice(0, actions.length, ...beforeActions);
      throw error;
    }
  });
  const prerequisites = {
    recordValidation: jest.fn(async () => ({
      state: 'KNOWN',
      template,
      context: {
        entityId: EVIDENCE_COMPANY,
        productId: item.productId,
        sku: item.sku,
        binding: item.repairInspection.data.templateBinding,
      },
      calibrations: [],
    })),
  };
  const workflow = new RepairWorkbenchService(
    prisma as never,
    f.mailroom as never,
    f.sync as never,
    prerequisites as never,
    f.media,
  );
  const review = (
    decision: 'APPROVE' | 'DECLINE',
    id = 'fair-report-review-' + decision,
  ) => ({
    entityId: EVIDENCE_COMPANY,
    requestId: id,
    expectedVersion: item.version,
    action: 'review_assessment' as const,
    inspectionRevision: item.repairInspection.revision,
    decision,
    note: decision === 'APPROVE' ? '已重新核對原因佐證' : '原因需補充',
  });
  const acceptAgain = () => {
    item.status = 'WAITING_CUSTOMER';
    item.repairWorkflow.csr.status = 'ACCEPTED';
    delete item.repairWorkflow.csr.decision;
  };
  return {
    ...f,
    item,
    actions,
    deliveries,
    addApprovedReceipt,
    tx,
    workflow,
    record,
    review,
    acceptAgain,
  };
}

describe('proposed report current-assessment guards in isolated /tmp mocks, not a deployed Source wire', () => {
  const keys = [
    'REPAIR_REPORT_LINK_SECRET',
    'REPAIR_REPORT_PUBLIC_ORIGIN',
    'REPAIR_PUBLIC_REPORT_ENABLED',
  ] as const;
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldFetch = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(EVIDENCE_TIME));
    process.env.REPAIR_REPORT_LINK_SECRET =
      'SYNTHETIC_REPORT_SECRET_32_CHARACTERS_ONLY';
    process.env.REPAIR_REPORT_PUBLIC_ORIGIN =
      'https://synthetic-report.invalid';
    process.env.REPAIR_PUBLIC_REPORT_ENABLED = 'true';
    global.fetch = jest.fn(async () => {
      throw Error('NO_EXTERNAL_HTTP_IN_TMP_FIXTURE');
    });
  });
  afterEach(() => {
    expect(global.fetch).not.toHaveBeenCalled();
    global.fetch = oldFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });

  it.each(['UNDETERMINED', 'PRODUCT_FAULT'] as const)(
    'publishes %s explanation without demanding a second reviewer or paid repair release',
    async (conclusion) => {
      const f = fixture(conclusion);
      f.refresh('APPROVE', 'ACCEPTED');
      Object.assign(f.source.releaseInfo, {
        customerApprovedQuoteRevision: null,
        customerApprovedAt: null,
        confirmedPaymentQuoteRevision: null,
        invoiceSatisfied: false,
        invoiceStatus: 'PENDING',
      });
      f.source.repairAllowed = false;
      const result = await f.report.publish('csr', f.item.id, f.publish());
      expect(
        await f.report.publicView(result.reportId, tokenFrom(result.shareLink)),
      ).toMatchObject({ reportId: result.reportId });
      expect(f.item.repairWorkflow.assessmentReview).toBeUndefined();
      expect(f.item.repairWorkflow.release).toBeUndefined();
      expect(
        f.tx.mailroomAction.findMany.mock.calls.every(
          ([q]: [Row]) => q.where.action !== 'review_assessment',
        ),
      ).toBe(true);
    },
  );
  it('publishes current human finding with immutable independent APPROVE before customer consent, then guards view and media', async () => {
    const f = fixture();
    f.refresh('APPROVE', 'ACCEPTED');
    Object.assign(f.source.releaseInfo, {
      customerApprovedQuoteRevision: null,
      customerApprovedAt: null,
      confirmedPaymentQuoteRevision: null,
    });
    f.source.repairAllowed = false;
    const result = await f.report.publish('csr', f.item.id, f.publish()),
      token = tokenFrom(result.shareLink);
    expect(await f.report.publicView(result.reportId, token)).toMatchObject({
      reportId: result.reportId,
    });
    await f.report.publicMedia(result.reportId, 'inspection-media', token);
    expect(f.storage.stream).toHaveBeenCalledTimes(1);
  });
  it('keeps the approved diagnosis readable when the customer declines the repair', async () => {
    const f = fixture();
    f.refresh('DECLINE', 'RESOLVED');
    f.source.repairAllowed = false;
    Object.assign(f.source.releaseInfo, {
      customerApprovedQuoteRevision: null,
      customerApprovedAt: null,
      confirmedPaymentQuoteRevision: null,
      invoiceSatisfied: false,
      invoiceStatus: 'PENDING',
    });
    const published = await f.report.publish('csr', f.item.id, f.publish());
    expect(
      await f.report.publicView(
        published.reportId,
        tokenFrom(published.shareLink),
      ),
    ).toMatchObject({ reportId: published.reportId });
    expect(f.item.repairWorkflow.release).toBeUndefined();
  });
  it.each([
    'missing',
    'REVISE',
    'stale-revision',
    'stale-hash',
    'self',
    'receipt-absent',
    'foreign-receipt',
    'receipt-tamper',
    'missing-policy',
    'missing-assessment',
  ])(
    'rejects new publish with %s assessment authority and produces no report/operation',
    async (kind) => {
      const f = fixture();
      if (kind === 'missing') delete f.item.repairWorkflow.assessmentReview;
      if (kind === 'REVISE')
        f.item.repairWorkflow.assessmentReview.decision = 'REVISE';
      if (kind === 'stale-revision')
        f.item.repairWorkflow.assessmentReview.inspectionRevision--;
      if (kind === 'stale-hash')
        f.item.repairWorkflow.assessmentReview.planHash = 'f'.repeat(64);
      if (kind === 'self')
        f.item.repairWorkflow.assessmentReview.reviewerId = 'tech';
      if (kind === 'receipt-absent') f.actions.pop();
      if (kind === 'foreign-receipt') f.actions[1].entityId = 'foreign';
      if (kind === 'receipt-tamper')
        f.actions[1].snapshot.repairWorkflow.assessmentReview.note =
          'Not the saved proof';
      if (kind === 'missing-policy')
        delete f.item.repairWorkflow.assessmentPolicy;
      if (kind === 'missing-assessment')
        delete f.item.repairInspection.data.assessment;
      await expect(
        f.report.publish('csr', f.item.id, f.publish()),
      ).rejects.toThrow();
      expect(f.reports).toHaveLength(0);
      expect(f.operations).toHaveLength(0);
    },
  );
  it('rechecks current review for both public routes and never opens media after authority is withdrawn', async () => {
    const f = fixture(),
      result = await f.report.publish('csr', f.item.id, f.publish()),
      token = tokenFrom(result.shareLink);
    f.item.repairWorkflow.assessmentReview.decision = 'REVISE';
    await expect(f.report.publicView(result.reportId, token)).rejects.toThrow();
    await expect(
      f.report.publicMedia(result.reportId, 'inspection-media', token),
    ).rejects.toThrow();
    expect(f.storage.stream).not.toHaveBeenCalled();
  });
  it('keeps an otherwise current historical approval valid after reviewer employment or permission later changes', async () => {
    const f = fixture(),
      result = await f.report.publish('csr', f.item.id, f.publish());
    f.tx.employee.findFirst.mockResolvedValue(null);
    f.permissions.get('csr')!.clear();
    f.tx.employee.findFirst.mockClear();
    expect(
      await f.report.publicView(result.reportId, tokenFrom(result.shareLink)),
    ).toMatchObject({ reportId: result.reportId });
    expect(f.tx.employee.findFirst).not.toHaveBeenCalled();
  });
  it('an old exact publish UUID replay remains before the new guard; a new UUID receives no downgrade', async () => {
    const f = fixture('UNDETERMINED'),
      input = f.publish(),
      first = await f.report.publish('csr', f.item.id, input);
    delete f.item.repairInspection.data.assessment;
    delete f.item.repairWorkflow.assessmentPolicy;
    f.item.version++;
    const guard = jest.spyOn(authority, 'requireAssessmentRelease');
    expect(await f.report.publish('csr', f.item.id, input)).toEqual({
      ...first,
      duplicate: true,
    });
    expect(guard).not.toHaveBeenCalled();
    await expect(
      f.report.publish('csr', f.item.id, {
        ...input,
        requestId: 'new-not-replay',
        expectedVersion: f.item.version,
      }),
    ).rejects.toThrow();
    expect(f.reports).toHaveLength(1);
    expect(f.operations).toHaveLength(1);
  });
  it('same revision REVISE atomically revokes both document kinds and re-APPROVE cannot revive old token or UUID', async () => {
    const f = fixture(),
      input = f.publish(),
      first = await f.report.publish('csr', f.item.id, input),
      token = tokenFrom(first.shareLink);
    f.reports.push({
      ...structuredClone(f.reports[0]),
      id: 'same-inspection-repair-report',
      reportRevision: 2,
    });
    f.reports.push({
      ...structuredClone(f.reports[0]),
      id: 'foreign-item-report',
      itemId: 'foreign-item',
    });
    f.acceptAgain();
    const decline = f.review('DECLINE');
    await f.workflow.workflow('csr', f.item.id, decline);
    expect(f.item.status).toBe('INSPECTING');
    expect(f.item.nextUserId).toBe('tech');
    expect(f.item.repairWorkflow.assessmentReview.decision).toBe('REVISE');
    expect(
      f.reports.slice(0, 2).every((report) => report.status === 'REVOKED'),
    ).toBe(true);
    expect(f.reports[2].status).toBe('PUBLISHED');
    await expect(f.report.publicView(first.reportId, token)).rejects.toThrow();
    await expect(
      f.report.publicMedia(first.reportId, 'inspection-media', token),
    ).rejects.toThrow();
    f.acceptAgain();
    await f.workflow.workflow('csr', f.item.id, f.review('APPROVE'));
    expect(f.item.repairWorkflow.assessmentReview.decision).toBe('APPROVE');
    expect(f.item.repairInspection.revision).toBe(3);
    await expect(f.report.publicView(first.reportId, token)).rejects.toThrow();
    await expect(f.report.publish('csr', f.item.id, input)).rejects.toThrow(
      '撤回',
    );
    const next = await f.report.publish(
      'csr',
      f.item.id,
      f.publish('inspection', 'new-after-reapproval'),
    );
    expect(next.reportId).not.toBe(first.reportId);
    expect(next.shareLink).not.toBe(first.shareLink);
    expect(
      await f.report.publicView(next.reportId, tokenFrom(next.shareLink)),
    ).toMatchObject({ reportId: next.reportId });
    expect(await f.workflow.workflow('csr', f.item.id, decline)).toMatchObject({
      duplicate: true,
    });
    expect(
      f.reports.find((report) => report.id === next.reportId)?.status,
    ).toBe('PUBLISHED');
  });
  it('REVISE rollback restores reports, current approval and item when a later native action write fails', async () => {
    const f = fixture(),
      published = await f.report.publish('csr', f.item.id, f.publish());
    f.acceptAgain();
    const beforeVersion = f.item.version;
    f.record.mockRejectedValueOnce(Error('synthetic action write failure'));
    await expect(
      f.workflow.workflow('csr', f.item.id, f.review('DECLINE')),
    ).rejects.toThrow('action write failure');
    expect(f.item.version).toBe(beforeVersion);
    expect(f.item.repairWorkflow.assessmentReview.decision).toBe('APPROVE');
    expect(f.reports[0].status).toBe('PUBLISHED');
    expect(
      await f.report.publicView(
        published.reportId,
        tokenFrom(published.shareLink),
      ),
    ).toMatchObject({ reportId: published.reportId });
  });
  it('failed revocation prevents REVISE from committing rather than leaving a live capability behind', async () => {
    const f = fixture();
    await f.report.publish('csr', f.item.id, f.publish());
    f.acceptAgain();
    const beforeVersion = f.item.version;
    f.tx.repairCustomerReport.updateMany.mockRejectedValueOnce(
      Error('synthetic report revoke failure'),
    );
    await expect(
      f.workflow.workflow('csr', f.item.id, f.review('DECLINE')),
    ).rejects.toThrow('report revoke failure');
    expect(f.item.version).toBe(beforeVersion);
    expect(f.item.repairWorkflow.assessmentReview.decision).toBe('APPROVE');
    expect(f.reports[0].status).toBe('PUBLISHED');
    expect(f.record).not.toHaveBeenCalled();
  });
  it('re-reads report status after item lock so a cached candidate cannot survive an interleaved REVISE and reapproval', async () => {
    const f = fixture(),
      published = await f.report.publish('csr', f.item.id, f.publish());
    const query = f.tx.$queryRaw.getMockImplementation();
    f.tx.$queryRaw.mockImplementationOnce(async (sql: any) => {
      await query(sql);
      f.reports[0].status = 'REVOKED';
      f.item.repairWorkflow.assessmentReview.decision = 'APPROVE';
      return [];
    });
    await expect(
      f.report.publicView(published.reportId, tokenFrom(published.shareLink)),
    ).rejects.toThrow();
    expect(f.storage.stream).not.toHaveBeenCalled();
  });
  it.each(['CLOSED', 'COMPLETED'])(
    'keeps a genuine immutable legacy report readable after Source %s without allowing a new publication',
    async (status) => {
      const f = fixture('LEGACY');
      expect(f.item.repairInspection.data).not.toHaveProperty('assessment');
      expect(f.item.repairWorkflow).not.toHaveProperty('assessmentPolicy');
      expect(f.actions[0].snapshot.repairInspection.data).not.toHaveProperty(
        'assessment',
      );
      expect(f.actions[0].snapshot.repairWorkflow).not.toHaveProperty(
        'assessmentPolicy',
      );
      expect(f.deliveries).toHaveLength(1);
      const published = await f.report.publish('csr', f.item.id, f.publish());
      f.source.status = status;
      const token = tokenFrom(published.shareLink);
      expect(
        await f.report.publicView(published.reportId, token),
      ).toMatchObject({ reportId: published.reportId });
      await f.report.publicMedia(published.reportId, 'inspection-media', token);
      expect(f.storage.stream).toHaveBeenCalledTimes(1);
      await expect(
        f.report.publish(
          'csr',
          f.item.id,
          f.publish('inspection', 'terminal-new-publish'),
        ),
      ).rejects.toThrow('案件已結束');
      expect(f.reports).toHaveLength(1);
      expect(f.operations).toHaveLength(1);
    },
  );
  it.each([
    'CANCELLED',
    'expired',
    'revoked',
    'missing-submit',
    'missing-delivery',
    'foreign-delivery',
    'stale-binding',
    'duplicate-binding',
  ])(
    'never uses public legacy read purpose to bypass %s authority',
    async (fault) => {
      const f = fixture('LEGACY'),
        published = await f.report.publish('csr', f.item.id, f.publish()),
        token = tokenFrom(published.shareLink);
      f.source.status = 'COMPLETED';
      if (fault === 'CANCELLED') f.source.status = 'CANCELLED';
      if (fault === 'expired') f.reports[0].expiresAt = new Date(EVIDENCE_TIME);
      if (fault === 'revoked') f.reports[0].status = 'REVOKED';
      if (fault === 'missing-submit') f.actions.splice(0, f.actions.length);
      if (fault === 'missing-delivery')
        f.deliveries.splice(0, f.deliveries.length);
      if (fault === 'foreign-delivery')
        f.deliveries[0].entityId = 'foreign-company';
      if (fault === 'stale-binding')
        f.source.releaseInfo.quoteBindings[0].planHash = 'f'.repeat(64);
      if (fault === 'duplicate-binding')
        f.source.releaseInfo.quoteBindings.push(
          structuredClone(f.source.releaseInfo.quoteBindings[0]),
        );
      await expect(
        f.report.publicView(published.reportId, token),
      ).rejects.toThrow();
      await expect(
        f.report.publicMedia(published.reportId, 'inspection-media', token),
      ).rejects.toThrow();
      expect(f.storage.stream).not.toHaveBeenCalled();
    },
  );
  it('independent review never bypasses repair finance or true completion gates', async () => {
    const f = fixture();
    f.complete();
    Object.assign(f.source.releaseInfo, {
      confirmedPaymentQuoteRevision: null,
      invoiceSatisfied: false,
    });
    await expect(
      f.report.publish('csr', f.item.id, f.publish('repair')),
    ).rejects.toThrow();
    expect(f.reports).toHaveLength(0);
  });
});
