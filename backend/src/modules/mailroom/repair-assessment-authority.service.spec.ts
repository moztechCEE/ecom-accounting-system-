/* eslint-disable @typescript-eslint/require-await -- Prisma-compatible local mocks intentionally return promises without IO. */
import {
  assessmentReleaseForItem,
  localAssessmentReleaseForItem,
  requireAssessmentRelease,
} from './repair-assessment-release';
import { RepairTodoService } from './repair-todo.service';
import {
  buildRepairProposalEvent,
  repairSourceBindingForItem,
  type RepairProposalItem,
} from './repair-proposal.contract';
import type { SourceCase } from './mailroom.contract';
import type { SaveRepairDto } from './repair-document.dto';
import type { MailroomCommandDto } from './mailroom.dto';
import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { fingerprint, type Actor } from './mailroom.contract';
import { MailroomService } from './mailroom.service';
import type { MailroomSyncService } from './mailroom-sync.service';
import type {
  AssessmentReview,
  InspectionAssessment,
} from './repair-assessment.contract';
import {
  inspectionPlanHash,
  type FinalizedRepairMedia,
  type InspectionData,
  type InspectionDocument,
} from './repair-document.contract';
import { SaveInspectionDto } from './repair-document.dto';
import type { RepairMaterialsService } from './repair-materials.service';
import type { RepairMediaService } from './repair-media.service';
import { RepairPrerequisitesService } from './repair-prerequisites.service';
import {
  repairTemplateHash,
  type RepairTestTemplate,
} from './repair-template.contract';
import { RepairTestRegistryService } from './repair-test-registry.service';
import {
  sentCustomerWorkflow,
  type RepairWorkflow,
} from './repair-workflow.contract';
import { RepairWorkflowDto } from './repair-workflow.dto';
import { RepairWorkbenchService } from './repair-workbench.service';

const NOW = '2026-10-15T02:00:00.000Z';
const COMPANY = 'synthetic-company';
const ITEM = '22222222-2222-4222-8222-222222222222';
const MEDIA = '11111111-1111-4111-8111-111111111111';
type FairData = InspectionData & { assessment?: InspectionAssessment };
type FairDocument = InspectionDocument & { data: FairData };
type FairWorkflow = RepairWorkflow & {
  assessmentReview?: AssessmentReview;
  assessmentPolicy?: {
    schema: 1;
    inspectionRevision: number;
    planHash: string;
  };
};
type FairItem = {
  id: string;
  entityId: string;
  receiptId: string;
  label: string;
  version: number;
  status: string;
  productId: string;
  productName: string;
  sku: string;
  serialNumber: string;
  location: string;
  repairOwnerId: string;
  custodianId: string;
  nextUserId: string | null;
  repairInspection: FairDocument;
  repairReport: null;
  repairWorkflow: FairWorkflow;
  receipt: {
    entityId: string;
    category: 'REPAIR';
    sourceCaseId: string;
    sourceNumber: string;
    customerServiceUserId: string;
  };
};
type Employee = {
  id: string;
  userId: string;
  entityId: string;
  isActive: boolean;
};
type ActionReceipt = {
  entityId: string;
  actorId: string;
  actorName: string;
  requestId: string;
  version: number;
  fromStatus: string;
  toStatus: string;
  itemId: string;
  requestHash: string;
  action: string;
  snapshot: FairItem;
};
type Update = Partial<Omit<FairItem, 'version'>> & {
  version: { increment: number };
};

function assessment(
  conclusion: InspectionAssessment['conclusion'] = 'UNDETERMINED',
): InspectionAssessment {
  return conclusion === 'UNDETERMINED'
    ? {
        schema: 1,
        conclusion,
        basis: '',
        causalExplanation: '',
        checkKeys: [],
        mediaIds: [],
      }
    : {
        schema: 1,
        conclusion,
        basis:
          'Observed damage at the tested connection in this synthetic case',
        causalExplanation:
          'The observed connection damage interrupts this tested function; a mark alone is insufficient',
        checkKeys: ['connection'],
        mediaIds: [MEDIA],
      };
}

function reviewedTemplate(): RepairTestTemplate {
  const template: RepairTestTemplate = {
    schema: 1,
    status: 'REVIEWED',
    id: 'synthetic-reviewed-standard',
    revision: 1,
    entityId: COMPANY,
    productId: 'synthetic-product',
    sku: 'SYNTHETIC-SKU',
    reviewedById: 'standard-manager',
    reviewedAt: '2026-10-14T02:00:00.000Z',
    checks: [
      {
        key: 'connection',
        name: 'Synthetic connection observation',
        requiredForInspection: true,
        requiredForCompletion: true,
        requiresCalibration: false,
        standard: {
          kind: 'OBSERVATION',
          instruction: 'Synthetic test definition; no manufacturer limit',
        },
      },
    ],
    contentHash: '',
  };
  template.contentHash = repairTemplateHash(template);
  return template;
}

function inspectionData(template: RepairTestTemplate): FairData {
  return {
    protocol: 2,
    materialPlan: { mode: 'NONE', lines: [] },
    complaint: 'Synthetic function fails',
    reproduction: 'YES',
    testConditions: 'Recorded synthetic observation conditions',
    checks: [
      {
        key: 'connection',
        name: template.checks[0].name,
        result: 'FAIL',
        observation: 'Actual synthetic observation of a damaged connection',
      },
    ],
    templateBinding: {
      id: template.id,
      revision: template.revision,
      contentHash: template.contentHash,
    },
    diagnosis: 'The cause has not been established',
    causeStatus: 'UNKNOWN',
    plan: 'REPAIR',
    planNote: 'Submit the actual findings for customer-service review',
    feeSuggestion: 'REVIEW',
    estimateNote: 'A technical observation does not set the customer charge',
    assessment: {
      ...assessment(),
      causalExplanation: 'The cause has not been established',
    },
  };
}

function humanData(template: RepairTestTemplate): FairData {
  const finding = assessment('USER_CAUSED');
  return {
    ...inspectionData(template),
    diagnosis: finding.causalExplanation,
    causeStatus: 'CONFIRMED',
    isAccidentalDamage: true,
    assessment: finding,
    mediaRefs: [
      { mediaId: MEDIA, phase: 'DIAGNOSTIC', checkKey: 'connection' },
    ],
  };
}

function fixture() {
  const template = reviewedTemplate();
  const accounts = new Map<string, Actor>();
  const employees = new Map<string, Employee>();
  for (const userId of ['tech', 'csr', 'other-csr', 'author']) {
    accounts.set(userId, {
      id: userId,
      name: userId,
      entityIds: [COMPANY],
      permissions: new Set(
        userId === 'tech'
          ? ['repair_workbench:read', 'repair_workbench:update']
          : ['mailroom:review'],
      ),
    });
    employees.set(userId, {
      id: 'employee-' + userId,
      userId,
      entityId: COMPANY,
      isActive: true,
    });
  }
  let row: FairItem = {
    id: ITEM,
    entityId: COMPANY,
    receiptId: '33333333-3333-4333-8333-333333333333',
    label: 'SYNTHETIC-FAIR',
    version: 5,
    status: 'INSPECTING',
    productId: template.productId,
    productName: 'Synthetic actual product',
    sku: template.sku,
    serialNumber: 'SYNTHETIC-ORIGINAL-SN',
    location: 'Synthetic technician station',
    repairOwnerId: 'tech',
    custodianId: 'tech',
    nextUserId: 'tech',
    repairInspection: {
      number: 'INS-SYNTHETIC-FAIR',
      revision: 3,
      status: 'SUBMITTED',
      authorId: 'tech',
      authorName: 'tech',
      updatedAt: '2026-10-14T03:00:00.000Z',
      submittedAt: '2026-10-14T03:00:00.000Z',
      data: humanData(template),
    },
    repairReport: null,
    repairWorkflow: { schema: 1 },
    receipt: {
      entityId: COMPANY,
      category: 'REPAIR',
      sourceCaseId: 'synthetic-source-case',
      sourceNumber: 'SYNTHETIC-SOURCE',
      customerServiceUserId: 'csr',
    },
  };
  let standard = {
    id: template.id,
    entityId: template.entityId,
    productId: template.productId,
    sku: template.sku,
    revision: template.revision,
    status: template.status,
    data: { checks: structuredClone(template.checks) },
    contentHash: template.contentHash,
    createdById: 'standard-manager',
    createdAt: new Date(template.reviewedAt),
    reviewedById: template.reviewedById,
    reviewedAt: new Date(template.reviewedAt),
    retiredById: null,
    retiredAt: null,
    commandKeys: [],
    commands: {},
  };
  row.repairWorkflow.assessmentPolicy = {
    schema: 1,
    inspectionRevision: row.repairInspection.revision,
    planHash: inspectionPlanHash(row.repairInspection),
  };
  const events = new Map<string, ActionReceipt>();
  let proofPatch: Partial<FinalizedRepairMedia> = {};
  let missingMedia = false;
  const prisma = {
    mailroomItem: {
      findUnique: jest.fn(async () => structuredClone(row)),
      update: jest.fn(async ({ data }: { data: Update }) => {
        row = {
          ...row,
          ...data,
          version: row.version + data.version.increment,
        };
        return structuredClone(row);
      }),
    },
    mailroomAction: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { entityId_actorId_requestId: Record<string, string> };
        }) => {
          const key = where.entityId_actorId_requestId;
          return (
            events.get(`${key.entityId}:${key.actorId}:${key.requestId}`) ||
            null
          );
        },
      ),
    },
    employee: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { userId: string; entityId: string; isActive?: boolean };
        }) => {
          const employee = employees.get(where.userId);
          return employee &&
            employee.entityId === where.entityId &&
            (where.isActive === undefined ||
              employee.isActive === where.isActive)
            ? structuredClone(employee)
            : null;
        },
      ),
    },
    product: {
      findMany: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const product = {
            id: template.productId,
            entityId: COMPANY,
            sku: template.sku,
            isActive: true,
          };
          return Object.entries(where).every(
            ([key, value]) => product[key as keyof typeof product] === value,
          )
            ? [product]
            : [];
        },
      ),
    },
    repairTestStandard: {
      findMany: jest.fn(async () => [structuredClone(standard)]),
    },
    repairCalibrationRecord: { findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(async () => []),
    $executeRaw: jest.fn(async () => 0),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) => {
      const before = structuredClone(row);
      const previous = new Map(events);
      try {
        return await callback(prisma);
      } catch (error) {
        row = before;
        events.clear();
        for (const [key, receipt] of previous) events.set(key, receipt);
        throw error;
      }
    },
  );
  const mailroom = {
    enabled: jest.fn(),
    actor: jest.fn(async (userId: string) => {
      const actor = accounts.get(userId);
      if (!actor) throw new ForbiddenException('Synthetic unavailable account');
      return {
        ...actor,
        permissions: new Set(actor.permissions),
        entityIds: actor.entityIds === null ? null : [...actor.entityIds],
      };
    }),
    record: jest.fn(
      async (
        _tx: unknown,
        actor: Actor,
        updated: FairItem,
        action: string,
        requestId: string,
        hash: string,
        fromStatus: string,
      ) => {
        events.set(`${updated.entityId}:${actor.id}:${requestId}`, {
          entityId: updated.entityId,
          actorId: actor.id,
          actorName: actor.name,
          requestId,
          version: updated.version,
          fromStatus,
          toStatus: updated.status,
          itemId: updated.id,
          requestHash: hash,
          action,
          snapshot: structuredClone(updated),
        });
        return [];
      },
    ),
    publish: jest.fn(),
  };
  const registry = new RepairTestRegistryService(
    prisma as unknown as PrismaService,
    mailroom as unknown as MailroomService,
  );
  const materials = {
    projectionForItem: jest.fn(async () => ({
      start: { state: 'READY', reason: 'NOT_REQUIRED', requiredCount: 0 },
      completion: { state: 'READY', reason: 'NOT_REQUIRED', requiredCount: 0 },
    })),
  };
  const prerequisites = new RepairPrerequisitesService(
    registry,
    materials as unknown as RepairMaterialsService,
  );
  const media = {
    attach: jest.fn(
      async (
        _tx: unknown,
        item: FairItem,
        kind: 'inspection' | 'repair',
        revision: number,
        refs: FairData['mediaRefs'],
      ): Promise<FinalizedRepairMedia[]> =>
        missingMedia
          ? []
          : (refs || []).map((ref) => ({
              ...ref,
              entityId: item.entityId,
              itemId: item.id,
              kind,
              documentRevision: revision,
              status: 'FINALIZED' as const,
              sha256: 'd'.repeat(64),
              contentType: 'image/png',
              sizeBytes: 128,
              ...proofPatch,
            })),
    ),
  };
  const sync = { cases: jest.fn(async () => ({ items: [] as SourceCase[] })) };
  const service = new RepairWorkbenchService(
    prisma as unknown as PrismaService,
    mailroom as unknown as MailroomService,
    sync as unknown as MailroomSyncService,
    prerequisites,
    media as unknown as RepairMediaService,
  );
  const saveInput = (
    data = inspectionData(template),
    status: SaveInspectionDto['status'] = 'SUBMITTED',
  ): SaveInspectionDto => ({
    entityId: COMPANY,
    requestId: 'fair-inspection-save-1',
    expectedVersion: row.version,
    status,
    data,
  });
  const reviewInput = (
    decision: 'APPROVE' | 'DECLINE' = 'APPROVE',
  ): RepairWorkflowDto => ({
    entityId: COMPANY,
    requestId: 'fair-assessment-review-1',
    expectedVersion: row.version,
    action: 'review_assessment' as RepairWorkflowDto['action'],
    inspectionRevision: row.repairInspection.revision,
    decision,
    note: 'Reviewed the actual synthetic finding and its causal basis',
  });
  const accepted = (ownerId = 'csr') => {
    row.status = 'WAITING_CUSTOMER';
    row.nextUserId = ownerId;
    const sent = sentCustomerWorkflow(row, accounts.get('tech')!, NOW);
    row.repairWorkflow = {
      ...sent,
      csr: { ...sent.csr!, status: 'ACCEPTED', ownerId, acceptedAt: NOW },
    };
  };
  return {
    service,
    sync,
    materials,
    prisma,
    mailroom,
    media,
    prerequisites,
    accounts,
    employees,
    events,
    template,
    saveInput,
    reviewInput,
    accepted,
    row: () => row,
    changeProof: (patch: Partial<FinalizedRepairMedia>) => {
      proofPatch = patch;
    },
    removeMedia: () => {
      missingMedia = true;
    },
    reviseStandard: () => {
      const next = { ...template, id: 'new-standard', revision: 2 };
      next.contentHash = repairTemplateHash(next);
      standard = {
        ...standard,
        id: next.id,
        revision: next.revision,
        contentHash: next.contentHash,
      };
    },
  };
}

function authorityFixture() {
  const f = fixture();
  Object.assign(f.row(), {
    declared: { id: 'synthetic-source-line' },
    matchResult: 'MATCH',
    evidence: [],
  });
  Object.assign(f.row().receipt, {
    receivedById: 'clerk',
    receivedAt: new Date(NOW),
  });
  const deliveries: Record<string, unknown>[] = [];
  const history = () => [...f.events.values()];
  const findHistory = ({
    where,
  }: {
    where: {
      action: string;
      actorId?: string;
      snapshot?: { equals?: unknown };
    };
  }) =>
    history().filter(
      (action) =>
        action.action === where.action &&
        (!where.actorId || action.actorId === where.actorId) &&
        (where.action === 'submit_repair_inspection'
          ? action.snapshot.repairInspection.revision === where.snapshot?.equals
          : action.snapshot.repairWorkflow.assessmentReview?.reviewedAt ===
            where.snapshot?.equals),
    );
  const actionReader = Object.assign(f.prisma.mailroomAction, {
    findMany: jest.fn(async (query: Parameters<typeof findHistory>[0]) =>
      findHistory(query),
    ),
    findFirst: jest.fn(
      async (query: Parameters<typeof findHistory>[0]) =>
        findHistory(query).at(-1) || null,
    ),
  });
  const deliveryReader = {
    findFirst: jest.fn(async () => deliveries.at(-1) || null),
    createMany: jest.fn(
      async ({ data }: { data: Record<string, unknown>[] }) => {
        deliveries.push(...structuredClone(data));
        return { count: data.length };
      },
    ),
  };
  const nativeItem = Object.assign(f.prisma.mailroomItem, {
    findUniqueOrThrow: jest.fn(async () => structuredClone(f.row())),
    count: jest.fn(async () => 0),
    findMany: jest.fn(
      async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: { version?: boolean; repairInspection?: boolean };
      }) => {
        if (
          where.id &&
          typeof where.id === 'object' &&
          'in' in where.id &&
          !(where.id as { in: string[] }).in.includes(ITEM)
        )
          return [];
        const choices = where.OR as
          | { id: string; version: number }[]
          | undefined;
        if (
          choices &&
          !choices.some(
            (row) => row.id === ITEM && row.version === f.row().version,
          )
        )
          return [];
        if (select?.version && !select.repairInspection)
          return [{ id: ITEM, version: f.row().version }];
        return [structuredClone(f.row())];
      },
    ),
  });
  const db = Object.assign(f.prisma, {
    mailroomAction: actionReader,
    mailroomItem: nativeItem,
    mailroomDelivery: deliveryReader,
    mailroomReceipt: { update: jest.fn(async () => ({})) },
  });
  const source: SourceCase = {
    id: f.row().receipt.sourceCaseId,
    number: f.row().receipt.sourceNumber,
    type: 'REPAIR',
    status: 'INSPECTING',
    brand: 'MOZTECH',
    version: NOW,
    customerLabel: 'Synthetic customer',
    repairAllowed: true,
    items: [
      {
        id: 'synthetic-source-line',
        name: f.row().productName,
        sku: f.row().sku,
        serialNumber: f.row().serialNumber,
        quantity: 1,
      },
    ],
    releaseInfo: {
      quoteRevision: 2,
      customerApprovedQuoteRevision: 2,
      customerApprovedAt: NOW,
      amount: 50,
      currency: 'TWD',
      confirmedPaymentQuoteRevision: 2,
      invoiceRequired: true,
      invoiceStatus: 'ISSUED',
      invoiceSatisfied: true,
      invoiceQuoteRevision: 2,
      quoteBindings: [],
    },
  };
  f.sync.cases.mockImplementation(async () => ({ items: [source] }));
  const item = () => f.row() as unknown as RepairProposalItem;
  const rebind = () => {
    source.releaseInfo!.quoteBindings = [
      { ...repairSourceBindingForItem(item(), source), quoteRevision: 2 },
    ];
  };
  const native = new MailroomService(
    db as unknown as PrismaService,
    {} as never,
    f.sync as unknown as MailroomSyncService,
    undefined,
    undefined,
    f.prerequisites,
  );
  jest.spyOn(native, 'enabled').mockImplementation(() => {});
  jest.spyOn(native, 'actor').mockImplementation(f.mailroom.actor);
  jest
    .spyOn(native, 'record')
    .mockImplementation(
      f.mailroom.record as unknown as MailroomService['record'],
    );
  jest.spyOn(native, 'publish').mockImplementation(() => {});
  jest.spyOn(native, 'customerService').mockResolvedValue('csr');
  const command = (
    action: MailroomCommandDto['action'],
  ): MailroomCommandDto => ({
    entityId: COMPANY,
    requestId: 'native-' + action,
    expectedVersion: f.row().version,
    action,
    note: 'Actual synthetic native work checkpoint',
  });
  const submit = async (
    conclusion: InspectionAssessment['conclusion'] = 'USER_CAUSED',
    plan: InspectionData['plan'] = 'REPAIR',
  ) => {
    const data =
      conclusion === 'USER_CAUSED'
        ? humanData(f.template)
        : inspectionData(f.template);
    if (conclusion === 'PRODUCT_FAULT') {
      data.assessment = assessment('PRODUCT_FAULT');
      data.assessment.mediaIds = [];
      data.diagnosis = data.assessment.causalExplanation;
      data.causeStatus = 'CONFIRMED';
      data.isAccidentalDamage = false;
    }
    data.checks[0].result = 'PASS';
    data.plan = plan;
    data.feeSuggestion = 'PAID';
    data.estimateAmount = 50;
    await f.service.save('tech', ITEM, 'inspection', f.saveInput(data));
    if (source.type === 'REPAIR') rebind();
  };
  const review = async (decision: 'APPROVE' | 'DECLINE' = 'APPROVE') => {
    f.accepted();
    await f.service.workflow('csr', ITEM, f.reviewInput(decision));
  };
  const resolve = async () => {
    if (!f.row().repairWorkflow.csr) f.accepted();
    await f.service.workflow('csr', ITEM, {
      ...f.reviewInput(),
      action: 'resolve_customer',
      requestId: 'actual-customer-confirmation',
    });
  };
  const report = async (
    outcome: 'REPAIRED' | 'FACTORY_REPAIRED' = 'REPAIRED',
  ) => {
    const data: SaveRepairDto['data'] = {
      protocol: 2,
      outcome,
      ...(outcome === 'FACTORY_REPAIRED'
        ? { factoryReference: f.row().repairWorkflow.factory?.reference }
        : {}),
      workPerformed: 'Performed synthetic actual work',
      parts: [],
      laborMinutes: 10,
      checks: structuredClone(f.row().repairInspection.data.checks),
      templateBinding: f.row().repairInspection.data.templateBinding,
      qcResult: 'PASS',
      qcNotes: 'Actual synthetic required checks passed',
      deliveredAccessories: 'Synthetic original accessories',
    };
    await f.service.save('tech', ITEM, 'repair', {
      entityId: COMPANY,
      expectedVersion: f.row().version,
      requestId: 'actual-repair-document',
      status: 'SUBMITTED',
      data,
    });
  };
  const release = () =>
    assessmentReleaseForItem(
      item(),
      db as unknown as Parameters<typeof assessmentReleaseForItem>[1],
      { source },
    );
  const queue = new RepairTodoService(
    db as unknown as PrismaService,
    {
      ...f.mailroom,
      views: jest.fn(async (rows: unknown[]) => rows),
    } as unknown as MailroomService,
    f.sync as unknown as MailroomSyncService,
    f.prerequisites,
  );
  return {
    ...f,
    db,
    item,
    rebind,
    source,
    deliveries,
    native,
    command,
    submit,
    review,
    resolve,
    report,
    release,
    queue,
  };
}

describe('isolated authoritative fair-assessment release through native services', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  it.each(['PRODUCT_FAULT', 'UNDETERMINED'] as const)(
    'keeps %s single-person and preserves unknown rather than deriving false',
    async (conclusion) => {
      const f = authorityFixture();
      await f.submit(conclusion);
      expect(await f.release()).toEqual({
        state: 'READY',
        reason: 'INDEPENDENT_REVIEW_NOT_REQUIRED',
      });
      expect(
        [...f.events.values()].some(
          (row) => row.action === 'review_assessment',
        ),
      ).toBe(false);
      expect(f.row().repairInspection.data.isAccidentalDamage).toBe(
        conclusion === 'UNDETERMINED' ? undefined : false,
      );
      f.accepted();
      await f.resolve();
      await f.native.command('tech', ITEM, f.command('start_repair'));
      expect(f.row().status).toBe('REPAIRING');
    },
  );

  it('allows USER_CAUSED to enter native SENT for CSR before independent approval, without releasing work', async () => {
    const f = authorityFixture();
    await f.submit();
    await f.native.command('tech', ITEM, f.command('await_customer'));
    expect(f.row().status).toBe('WAITING_CUSTOMER');
    expect(f.row().repairWorkflow.csr?.status).toBe('SENT');
    expect(f.row().repairWorkflow.assessmentReview).toBeUndefined();
    expect(await f.release()).toMatchObject({ state: 'BLOCKED' });
    expect(f.deliveries).toHaveLength(1);
    expect(f.deliveries[0].target).toBe('AFTER_SALES');
    // A queued original proposal is not Source adoption or customer delivery.
  });

  it('requires the real independent review action receipt, and review approval alone changes neither CSR finance nor custody', async () => {
    const f = authorityFixture();
    await f.submit();
    await f.review();
    expect(await f.release()).toEqual({
      state: 'READY',
      reason: 'CURRENT_INDEPENDENT_APPROVAL',
    });
    expect(f.row().status).toBe('WAITING_CUSTOMER');
    expect(f.row().repairWorkflow.csr?.status).toBe('ACCEPTED');
    expect(f.row().custodianId).toBe('tech');
    expect(f.row().repairWorkflow.workStart).toBeUndefined();
    for (const [key, action] of f.events)
      if (action.action === 'review_assessment') f.events.delete(key);
    expect(await f.release()).toMatchObject({
      state: 'BLOCKED',
      reason: 'ASSESSMENT_REVIEW_PROVENANCE_MISMATCH',
    });
    await expect(f.resolve()).rejects.toThrow('覆核證據');
  });

  it.each([
    'MISSING',
    'REVISE',
    'STALE_REVISION',
    'STALE_HASH',
    'SELF',
    'NO_HISTORY',
  ] as const)(
    'blocks native positive work with %s proof despite current customer financial release',
    async (fault) => {
      const f = authorityFixture();
      await f.submit();
      await f.review();
      await f.resolve();
      if (fault === 'MISSING') delete f.row().repairWorkflow.assessmentReview;
      if (fault === 'REVISE')
        f.row().repairWorkflow.assessmentReview!.decision = 'REVISE';
      if (fault === 'STALE_REVISION')
        f.row().repairWorkflow.assessmentReview!.inspectionRevision--;
      if (fault === 'STALE_HASH')
        f.row().repairWorkflow.assessmentReview!.planHash = 'a'.repeat(64);
      if (fault === 'SELF')
        f.row().repairWorkflow.assessmentReview!.reviewerId = 'tech';
      if (fault === 'NO_HISTORY') f.events.clear();
      const before = f.db.mailroomItem.update.mock.calls.length;
      await expect(
        f.native.command('tech', ITEM, f.command('start_repair')),
      ).rejects.toThrow('覆核證據');
      expect(f.db.mailroomItem.update).toHaveBeenCalledTimes(before);
      expect(f.row().status).toBe('INSPECTING');
    },
  );

  it('retains a historical approval after reviewer deactivation while a newly revised document invalidates it', async () => {
    const f = authorityFixture();
    await f.submit();
    await f.review();
    f.employees.get('csr')!.isActive = false;
    f.accounts.get('csr')!.permissions.clear();
    expect(await f.release()).toMatchObject({ state: 'READY' });
    f.row().status = 'INSPECTING';
    await f.service.save('tech', ITEM, 'inspection', {
      ...f.saveInput(humanData(f.template)),
      requestId: 'new-inspection-revision',
    });
    expect(await f.release()).toMatchObject({
      state: 'BLOCKED',
      reason: 'ASSESSMENT_REVIEW_REQUIRED',
    });
    expect(
      [...f.events.values()].some((row) => row.action === 'review_assessment'),
    ).toBe(true);
  });

  it('keeps payment, invoice, materials, template and completion QC authoritative after cause approval', async () => {
    const f = authorityFixture();
    await f.submit();
    await f.review();
    await f.resolve();
    f.source.releaseInfo!.invoiceSatisfied = false;
    await expect(
      f.native.command('tech', ITEM, f.command('start_repair')),
    ).rejects.toThrow('發票');
    f.source.releaseInfo!.invoiceSatisfied = true;
    f.source.releaseInfo!.confirmedPaymentQuoteRevision = null;
    await expect(
      f.native.command('tech', ITEM, f.command('start_repair')),
    ).rejects.toThrow('收款');
    f.source.releaseInfo!.confirmedPaymentQuoteRevision = 2;
    f.materials.projectionForItem.mockResolvedValueOnce({
      start: { state: 'UNKNOWN', reason: 'RECEIPT_UNKNOWN', requiredCount: 1 },
      completion: {
        state: 'UNKNOWN',
        reason: 'RECEIPT_UNKNOWN',
        requiredCount: 1,
      },
    });
    await expect(
      f.native.command('tech', ITEM, f.command('start_repair')),
    ).rejects.toThrow('材料');
    await f.native.command('tech', ITEM, f.command('start_repair'));
    await expect(
      f.native.command('tech', ITEM, f.command('complete_repair')),
    ).rejects.toThrow('維修單');
    await f.report();
    if (f.row().repairReport)
      Object.assign(
        (f.row().repairReport as unknown as { data: { qcResult: string } })
          .data,
        { qcResult: 'FAIL' },
      );
    await expect(
      f.native.command('tech', ITEM, f.command('complete_repair')),
    ).rejects.toThrow('複驗');
  });

  it('keeps the real native start, repair document, completion and clerk handoff loop intact', async () => {
    const f = authorityFixture();
    await f.submit();
    await f.review();
    await f.resolve();
    await f.native.command('tech', ITEM, f.command('start_repair'));
    await f.report();
    await f.native.command('tech', ITEM, f.command('complete_repair'));
    expect(f.row().status).toBe('WAITING_RETURN_ACCEPTANCE');
    expect(f.row().nextUserId).toBe('clerk');
    expect(f.row().custodianId).toBe('tech');
    expect(f.row().repairWorkflow.release?.purpose).toBe('REPAIRED');
    f.accounts.set('clerk', {
      id: 'clerk',
      name: 'Synthetic clerk',
      entityIds: [COMPANY],
      permissions: new Set(['mailroom:read', 'mailroom:update']),
    });
    await expect(
      f.native.command('tech', ITEM, {
        ...f.command('accept_return'),
        confirmedItems: true,
        location: 'Synthetic clerk shelf',
      }),
    ).rejects.toThrow();
    expect(f.row().custodianId).toBe('tech');
    await f.native.command('clerk', ITEM, {
      ...f.command('accept_return'),
      confirmedItems: true,
      location: 'Synthetic clerk shelf',
    });
    expect(f.row().custodianId).toBe('clerk');
    expect(f.row().status).toBe('READY_FOR_DISPATCH');
  });

  it('gates exact actionable todo while retaining repair-document work that is not yet complete', async () => {
    const f = authorityFixture();
    await f.submit();
    await f.review();
    await f.resolve();
    delete f.row().repairWorkflow.assessmentReview;
    expect(
      await f.queue.list('tech', { entityId: COMPANY, summary: 'true' }),
    ).toMatchObject({ queueCounts: { todo: 0 }, countExact: true });
    const reviewEvent = [...f.events.values()].find(
      (row) => row.action === 'review_assessment',
    )!;
    f.row().repairWorkflow.assessmentReview = structuredClone(
      reviewEvent.snapshot.repairWorkflow.assessmentReview,
    );
    expect(
      await f.queue.list('tech', { entityId: COMPANY, summary: 'true' }),
    ).toMatchObject({ queueCounts: { todo: 1 }, countExact: true });
    await f.native.command('tech', ITEM, f.command('start_repair'));
    expect(f.row().repairReport).toBeNull();
    expect(
      await f.queue.list('tech', { entityId: COMPANY, summary: 'false' }),
    ).toMatchObject({
      items: [{ todoKind: 'REPAIR_WORK' }],
      queueCounts: { todo: 1 },
      countExact: true,
    });
    f.db.mailroomAction.findMany.mockRejectedValueOnce(
      new Error('synthetic provenance read unavailable'),
    );
    const unknown = await f.queue.list('tech', {
      entityId: COMPANY,
      summary: 'true',
    });
    expect(unknown.countExact).toBe(false);
    expect(unknown.queueCounts).not.toHaveProperty('todo');
  });

  it('leaves controlled RETURN start/workStart/completion and explicit null quote intact without customer finance', async () => {
    const f = authorityFixture();
    Object.assign(f.row().receipt, { category: 'RETURN' });
    f.source.type = 'RETURN';
    f.source.repairAllowed = false;
    f.source.releaseInfo!.customerApprovedQuoteRevision = null;
    f.source.releaseInfo!.confirmedPaymentQuoteRevision = null;
    f.source.releaseInfo!.invoiceSatisfied = false;
    await f.submit('UNDETERMINED');
    f.accepted();
    await f.resolve();
    expect(f.row().repairWorkflow.csr?.quoteRevision).toBeNull();
    expect(f.row().repairInspection.review?.quoteRevision).toBeNull();
    await f.service.workflow('tech', ITEM, {
      entityId: COMPANY,
      requestId: 'actual-company-start',
      expectedVersion: f.row().version,
      action: 'start_refurbishment',
    });
    expect(f.row().status).toBe('REFURBISHING');
    await f.report();
    const start = structuredClone(f.row().repairWorkflow.workStart);
    delete f.row().repairWorkflow.workStart;
    await expect(
      f.native.command('tech', ITEM, f.command('complete_refurbish')),
    ).rejects.toThrow('開工');
    f.row().repairWorkflow.workStart = start;
    await f.native.command('tech', ITEM, f.command('complete_refurbish'));
    expect(f.row().status).toBe('WAITING_RETURN_ACCEPTANCE');
    expect(f.row().custodianId).toBe('tech');
  });

  it('keeps a stale reviewed standard blocked after an independent cause approval', async () => {
    const f = authorityFixture();
    await f.submit();
    await f.review();
    await f.resolve();
    f.reviseStandard();
    await expect(
      f.native.command('tech', ITEM, f.command('start_repair')),
    ).rejects.toThrow('必要檢測');
    expect(f.row().status).toBe('INSPECTING');
  });

  it('requires current independent proof again at completion without replacing existing QC and material gates', async () => {
    const f = authorityFixture();
    await f.submit();
    await f.review();
    await f.resolve();
    await f.native.command('tech', ITEM, f.command('start_repair'));
    await f.report();
    delete f.row().repairWorkflow.assessmentReview;
    const before = f.db.mailroomItem.update.mock.calls.length;
    await expect(
      f.native.command('tech', ITEM, f.command('complete_repair')),
    ).rejects.toThrow('覆核證據');
    expect(f.db.mailroomItem.update).toHaveBeenCalledTimes(before);
    expect(f.row().status).toBe('REPAIRING');
  });

  it('blocks company USER_CAUSED refurbishment start without the exact independent receipt', async () => {
    const f = authorityFixture();
    Object.assign(f.row().receipt, { category: 'RETURN' });
    f.source.type = 'RETURN';
    await f.submit();
    await f.review();
    await f.resolve();
    delete f.row().repairWorkflow.assessmentReview;
    await expect(
      f.service.workflow('tech', ITEM, {
        entityId: COMPANY,
        requestId: 'company-human-start',
        expectedVersion: f.row().version,
        action: 'start_refurbishment',
      }),
    ).rejects.toThrow('覆核證據');
    expect(f.row().repairWorkflow.workStart).toBeUndefined();
    expect(f.row().status).toBe('INSPECTING');
  });

  it('keeps both factory handoff and factory completion behind the same proof while retaining actual factory custody steps', async () => {
    const f = authorityFixture();
    await f.submit('USER_CAUSED', 'FACTORY');
    await f.review();
    await f.resolve();
    const review = structuredClone(f.row().repairWorkflow.assessmentReview);
    const act = (action: RepairWorkflowDto['action']) =>
      f.service.workflow('tech', ITEM, {
        entityId: COMPANY,
        requestId: 'actual-factory-' + action,
        expectedVersion: f.row().version,
        action,
        note: 'Actual synthetic factory custody checkpoint',
        confirmedItems: true,
        location: 'Synthetic technician station',
        factoryName: 'Synthetic factory',
        reference: 'SYNTHETIC-FACTORY-1',
        carrier: 'Synthetic carrier',
        trackingNumber: 'SYNTHETIC-TRACK-1',
      });
    delete f.row().repairWorkflow.assessmentReview;
    await expect(act('send_factory')).rejects.toThrow('覆核證據');
    f.row().repairWorkflow.assessmentReview = review;
    await act('send_factory');
    await act('accept_factory');
    await act('request_factory_return');
    await act('receive_factory');
    expect(f.row().repairWorkflow.factory?.physicalCustody).toBe('TECHNICIAN');
    await f.report('FACTORY_REPAIRED');
    delete f.row().repairWorkflow.assessmentReview;
    await expect(act('complete_factory')).rejects.toThrow('覆核證據');
    f.row().repairWorkflow.assessmentReview = review;
    await act('complete_factory');
    expect(f.row().status).toBe('WAITING_RETURN_ACCEPTANCE');
    expect(f.row().repairWorkflow.release?.purpose).toBe('FACTORY_REPAIRED');
  });

  it.each([
    'actorId',
    'actorName',
    'version',
    'fromStatus',
    'toStatus',
    'document',
    'claimedOwner',
    'policy',
  ] as const)(
    'does not accept a mismatched immutable review receipt %s',
    async (fault) => {
      const f = authorityFixture();
      await f.submit();
      await f.review();
      const receipt = [...f.events.values()].find(
        (row) => row.action === 'review_assessment',
      )!;
      if (fault === 'actorId') receipt.actorId = 'foreign-csr';
      if (fault === 'actorName')
        receipt.actorName = 'not the recorded reviewer';
      if (fault === 'version') receipt.version++;
      if (fault === 'fromStatus') receipt.fromStatus = 'INSPECTING';
      if (fault === 'toStatus') receipt.toStatus = 'REPAIRING';
      if (fault === 'document')
        receipt.snapshot.repairInspection.data.planNote =
          'different saved plan';
      if (fault === 'claimedOwner')
        receipt.snapshot.repairWorkflow.csr!.ownerId = 'other-csr';
      if (fault === 'policy')
        receipt.snapshot.repairWorkflow.assessmentPolicy!.planHash = 'b'.repeat(
          64,
        );
      expect(await f.release()).toMatchObject({ state: 'BLOCKED' });
    },
  );

  it.each(['PRODUCT_FAULT', 'UNDETERMINED', 'USER_CAUSED'] as const)(
    'keeps missing current %s submission authority unknown rather than guessing readiness',
    async (conclusion) => {
      const f = authorityFixture();
      await f.submit(conclusion);
      f.events.clear();
      expect(await f.release()).toMatchObject({
        state: 'UNKNOWN',
        reason: 'SUBMISSION_PROVENANCE_UNAVAILABLE',
      });
    },
  );
});

function seedLegacy(f: ReturnType<typeof authorityFixture>) {
  f.row().version = 8;
  const doc = f.row().repairInspection;
  delete doc.data.assessment;
  delete f.row().repairWorkflow.assessmentPolicy;
  doc.data.checks[0].result = 'PASS';
  doc.data.feeSuggestion = 'PAID';
  doc.data.estimateAmount = 50;
  const snapshot = structuredClone(f.row());
  snapshot.version = 4;
  const receipt: ActionReceipt = {
    entityId: COMPANY,
    itemId: ITEM,
    actorId: doc.authorId,
    actorName: doc.authorName,
    requestId: 'persisted-original-submit',
    requestHash: fingerprint({ original: doc }),
    action: 'submit_repair_inspection',
    version: 4,
    fromStatus: 'INSPECTING',
    toStatus: 'INSPECTING',
    snapshot,
  };
  f.events.set('persisted-original', receipt);
  f.rebind();
  const event = buildRepairProposalEvent({
    eventId: '44444444-4444-4444-8444-444444444444',
    occurredAt: NOW,
    actor: f.accounts.get('tech')!,
    item: { ...f.item(), version: 5, status: 'WAITING_CUSTOMER' },
    source: f.source,
  });
  f.deliveries.push({
    entityId: COMPANY,
    itemId: ITEM,
    eventId: event.eventId,
    target: 'AFTER_SALES',
    status: 'DELIVERED',
    deliveredAt: new Date(NOW),
    payload: event,
  });
  return receipt;
}

describe('immutable legacy provenance through the same positive release gate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  it('accepts a truthful original legacy submission and delivered exact proposal/current binding, retaining native financial guards', async () => {
    const f = authorityFixture();
    seedLegacy(f);
    expect(await f.release()).toEqual({
      state: 'READY',
      reason: 'PROVEN_LEGACY_SUBMISSION',
    });
    f.accepted();
    await f.resolve();
    f.source.releaseInfo!.invoiceSatisfied = false;
    await expect(
      f.native.command('tech', ITEM, f.command('start_repair')),
    ).rejects.toThrow('發票');
    f.source.releaseInfo!.invoiceSatisfied = true;
    await f.native.command('tech', ITEM, f.command('start_repair'));
    expect(f.row().status).toBe('REPAIRING');
    expect(f.row().repairInspection.data.assessment).toBeUndefined();
    expect(f.row().repairWorkflow.assessmentPolicy).toBeUndefined();
  });

  it.each([
    'number',
    'status',
    'revision',
    'authorId',
    'authorName',
    'updatedAt',
    'submittedAt',
    'data',
  ] as const)(
    'never invents a missing original %s field as legacy proof',
    async (field) => {
      const f = authorityFixture();
      const original = seedLegacy(f);
      delete (
        original.snapshot.repairInspection as unknown as Record<string, unknown>
      )[field];
      expect(await f.release()).toMatchObject({ state: 'UNKNOWN' });
      await expect(
        requireAssessmentRelease(
          f.item(),
          f.db as unknown as Parameters<typeof requireAssessmentRelease>[1],
          { source: f.source },
        ),
      ).rejects.toThrow();
    },
  );

  it.each([
    'foreignEntity',
    'foreignItem',
    'foreignActor',
    'changedTime',
    'changedData',
    'newPolicy',
    'newAssessment',
    'noHistory',
    'duplicateHistory',
  ] as const)(
    'rejects %s instead of deriving legacy from absent current fields or an old-looking date',
    async (fault) => {
      const f = authorityFixture();
      const original = seedLegacy(f);
      if (fault === 'foreignEntity') original.entityId = 'foreign-company';
      if (fault === 'foreignItem') original.itemId = 'foreign-item';
      if (fault === 'foreignActor') original.actorId = 'other-person';
      if (fault === 'changedTime')
        original.snapshot.repairInspection.submittedAt =
          '2026-10-13T00:00:00.000Z';
      if (fault === 'changedData')
        original.snapshot.repairInspection.data.planNote =
          'mutated after original submission';
      if (fault === 'newPolicy')
        original.snapshot.repairWorkflow.assessmentPolicy = {
          schema: 1,
          inspectionRevision: 3,
          planHash: inspectionPlanHash(original.snapshot.repairInspection),
        };
      if (fault === 'newAssessment')
        original.snapshot.repairInspection.data.assessment = assessment();
      if (fault === 'noHistory') f.events.clear();
      if (fault === 'duplicateHistory')
        f.events.set('duplicate-submit-revision', structuredClone(original));
      expect(await f.release()).toMatchObject({ state: 'UNKNOWN' });
    },
  );

  it.each([
    'noDelivery',
    'pendingDelivery',
    'wrongProposal',
    'staleBinding',
    'duplicateBinding',
    'foreignSource',
  ] as const)(
    'does not turn %s into a signed current legacy Source receipt',
    async (fault) => {
      const f = authorityFixture();
      seedLegacy(f);
      if (fault === 'noDelivery') f.deliveries.length = 0;
      if (fault === 'pendingDelivery') f.deliveries[0].status = 'PENDING';
      if (fault === 'wrongProposal') {
        f.deliveries[0].payload = structuredClone(f.deliveries[0].payload);
        (
          f.deliveries[0].payload as { proposal: { planHash: string } }
        ).proposal.planHash = 'f'.repeat(64);
      }
      if (fault === 'staleBinding')
        f.source.releaseInfo!.quoteBindings![0].planVersion--;
      if (fault === 'duplicateBinding')
        f.source.releaseInfo!.quoteBindings!.push(
          structuredClone(f.source.releaseInfo!.quoteBindings![0]),
        );
      if (fault === 'foreignSource') f.source.id = 'foreign-source';
      expect(await f.release()).toMatchObject({ state: 'UNKNOWN' });
    },
  );

  it('cannot turn a newly saved revision into legacy by removing its current assessment and policy', async () => {
    const f = authorityFixture();
    seedLegacy(f);
    await f.submit();
    delete f.row().repairInspection.data.assessment;
    delete f.row().repairWorkflow.assessmentPolicy;
    expect(await f.release()).toMatchObject({
      state: 'UNKNOWN',
      reason: 'SUBMISSION_PROVENANCE_UNAVAILABLE',
    });
    expect(
      [...f.events.values()].some(
        (row) => row.snapshot.repairWorkflow.assessmentPolicy?.schema === 1,
      ),
    ).toBe(true);
  });

  it('separates local immutable authority from caller-owned current Source binding without any remote read', async () => {
    const f = authorityFixture();
    seedLegacy(f);
    f.sync.cases.mockClear();
    const local = await localAssessmentReleaseForItem(
      f.item(),
      f.db as unknown as Parameters<typeof localAssessmentReleaseForItem>[1],
    );
    expect(local).toMatchObject({
      state: 'READY',
      reason: 'PROVEN_LEGACY_SUBMISSION',
      legacyProposalBinding: { itemId: ITEM },
    });
    f.source.releaseInfo!.quoteBindings![0].planVersion--;
    expect(await f.release()).toMatchObject({
      state: 'UNKNOWN',
      reason: 'LEGACY_SOURCE_BINDING_UNAVAILABLE',
    });
    expect(
      (
        await localAssessmentReleaseForItem(
          f.item(),
          f.db as unknown as Parameters<
            typeof localAssessmentReleaseForItem
          >[1],
        )
      ).state,
    ).toBe('READY');
    expect(f.sync.cases).not.toHaveBeenCalled();
  });

  it.each(['CLOSED', 'COMPLETED'] as const)(
    'keeps legacy %s blocked for positive action but permits the explicit internal public-report read purpose',
    async (status) => {
      const f = authorityFixture();
      seedLegacy(f);
      f.source.status = status;
      expect(await f.release()).toMatchObject({
        state: 'UNKNOWN',
        reason: 'LEGACY_SOURCE_BINDING_UNAVAILABLE',
      });
      await expect(
        requireAssessmentRelease(
          f.item(),
          f.db as unknown as Parameters<typeof requireAssessmentRelease>[1],
          { source: f.source },
        ),
      ).rejects.toThrow();
      expect(
        await assessmentReleaseForItem(
          f.item(),
          f.db as unknown as Parameters<typeof assessmentReleaseForItem>[1],
          { source: f.source, purpose: 'PUBLIC_REPORT_READ' },
        ),
      ).toEqual({ state: 'READY', reason: 'PROVEN_LEGACY_SUBMISSION' });
    },
  );

  it('keeps CANCELLED legacy unavailable for both positive action and public report reads', async () => {
    const f = authorityFixture();
    seedLegacy(f);
    f.source.status = 'CANCELLED';
    expect(await f.release()).toMatchObject({ state: 'UNKNOWN' });
    await expect(
      requireAssessmentRelease(
        f.item(),
        f.db as unknown as Parameters<typeof requireAssessmentRelease>[1],
        { source: f.source, purpose: 'PUBLIC_REPORT_READ' },
      ),
    ).rejects.toThrow();
  });

  it.each([
    'missingSubmission',
    'missingDelivery',
    'staleBinding',
    'duplicateBinding',
    'foreignSource',
  ] as const)(
    'does not let the public-report read purpose bypass %s',
    async (fault) => {
      const f = authorityFixture();
      seedLegacy(f);
      f.source.status = 'COMPLETED';
      if (fault === 'missingSubmission') f.events.clear();
      if (fault === 'missingDelivery') f.deliveries.length = 0;
      if (fault === 'staleBinding')
        f.source.releaseInfo!.quoteBindings![0].planVersion--;
      if (fault === 'duplicateBinding')
        f.source.releaseInfo!.quoteBindings!.push(
          structuredClone(f.source.releaseInfo!.quoteBindings![0]),
        );
      if (fault === 'foreignSource') f.source.id = 'foreign-source';
      expect(
        await assessmentReleaseForItem(
          f.item(),
          f.db as unknown as Parameters<typeof assessmentReleaseForItem>[1],
          { source: f.source, purpose: 'PUBLIC_REPORT_READ' },
        ),
      ).toMatchObject({ state: 'UNKNOWN' });
    },
  );
});
