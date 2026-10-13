import { Readable } from 'node:stream';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { MailroomService } from './mailroom.service';
import type { MailroomSyncService } from './mailroom-sync.service';
import { type Actor, type SourceCase } from './mailroom.contract';
import {
  type InspectionDocument,
  type RepairData,
  type RepairDocument,
  inspectionPlanHash,
} from './repair-document.contract';
import {
  type RepairProposalItem,
  repairSourceBindingForItem,
} from './repair-proposal.contract';
import { type RepairWorkflow } from './repair-workflow.contract';
import { RepairMediaService } from './repair-media.service';
import type { RepairMediaStorageService } from './repair-media-storage.service';
import { RepairCustomerReportService } from './repair-customer-report.service';
import type {
  RepairEvidenceCommand,
  RepairMediaUploadDto,
  RepairReportPublishDto,
} from './repair-evidence.dto';

type Row = Record<string, unknown>;
type Item = Omit<RepairProposalItem, 'repairInspection'> & {
  repairInspection: InspectionDocument;
  repairReport: RepairDocument<RepairData> | null;
  repairWorkflow: RepairWorkflow;
};
type Identity = {
  companyId: string;
  caseId: string;
  brand: string;
  verifiedCustomerId: string;
  verified: boolean;
};
type FutureSourceWire = SourceCase & {
  caseBrand: 'MOZTECH' | 'BONSON';
  releaseInfo: NonNullable<SourceCase['releaseInfo']> & {
    customerIdentity?: Identity;
    quoteBindings: (ReturnType<typeof repairSourceBindingForItem> & {
      quoteRevision: number;
    })[];
    invoiceRequired: boolean;
    invoiceStatus: string;
    invoiceSatisfied: boolean;
    invoiceQuoteRevision: number | null;
  };
};
export const EVIDENCE_COMPANY = 'synthetic-erp-company';
export const EVIDENCE_ITEM = 'synthetic-item';
export const EVIDENCE_TIME = '2026-10-13T04:00:00.000Z';

function matches(row: Row, where: Row) {
  return Object.entries(where).every(([key, expected]) => {
    if (
      expected !== null &&
      typeof expected === 'object' &&
      !(expected instanceof Date)
    ) {
      const filter = expected as Row;
      if ('gt' in filter)
        return row[key] instanceof Date && row[key] > (filter.gt as Date);
      if ('in' in filter) return (filter.in as unknown[]).includes(row[key]);
    }
    return row[key] === expected;
  });
}

/** In-memory rollback emulates transactional state; it proves neither PostgreSQL locking nor provider behavior. */
export function repairEvidenceFixture() {
  const assets: Row[] = [],
    reports: Row[] = [],
    operations: Row[] = [];
  const permissions = new Map<string, Set<string>>([
    ['tech', new Set(['repair_workbench:read', 'repair_workbench:update'])],
    ['csr', new Set(['mailroom:review', 'repair_workbench:read'])],
    [
      'other-tech',
      new Set(['repair_workbench:read', 'repair_workbench:update']),
    ],
    ['other-csr', new Set(['mailroom:review'])],
  ]);
  const companies = new Map<string, string[]>([
    ['tech', [EVIDENCE_COMPANY]],
    ['csr', [EVIDENCE_COMPANY]],
    ['other-tech', [EVIDENCE_COMPANY]],
    ['other-csr', [EVIDENCE_COMPANY]],
  ]);
  let employeeActive = true;
  const item: Item = {
    id: EVIDENCE_ITEM,
    entityId: EVIDENCE_COMPANY,
    receiptId: 'synthetic-receipt',
    version: 7,
    label: 'SYNTHETIC-REPAIR',
    productName: 'SYNTHETIC actual product',
    productId: 'synthetic-product',
    sku: 'SYNTHETIC-SKU',
    serialNumber: 'SYNTHETIC-SN',
    declared: { id: 'synthetic-source-line' },
    status: 'INSPECTING',
    repairOwnerId: 'tech',
    custodianId: 'tech',
    receipt: {
      category: 'REPAIR',
      sourceCaseId: 'synthetic-case',
      sourceNumber: 'SYNTHETIC-CASE',
    },
    repairInspection: {
      number: 'SYNTHETIC-INS',
      revision: 3,
      status: 'SUBMITTED',
      authorId: 'tech',
      authorName: '合成維修師',
      updatedAt: '2026-10-13T03:00:00.000Z',
      submittedAt: '2026-10-13T03:00:00.000Z',
      data: {
        protocol: 2,
        complaint: '合成故障',
        reproduction: 'YES',
        testConditions: '合成測試環境',
        checks: [
          {
            key: 'power',
            name: '電源',
            result: 'FAIL',
            observation: '合成實測未通過',
          },
        ],
        diagnosis: '合成故障診斷',
        causeStatus: 'CONFIRMED',
        plan: 'REPAIR',
        planNote: '合成修理建議',
        feeSuggestion: 'PAID',
        estimateAmount: 500,
        estimateNote: '合成估價',
        materialPlan: { mode: 'NONE', lines: [] },
        mediaRefs: [
          {
            mediaId: 'inspection-media',
            phase: 'DIAGNOSTIC',
            checkKey: 'power',
          },
        ],
        customerReportDraft: {
          findings: ' 合成故障說明 ',
          handling: ' 合成處理說明 ',
          verification: ' 合成檢測說明 ',
          mediaIds: ['inspection-media'],
        },
      },
    },
    repairReport: null,
    repairWorkflow: { schema: 1 },
  };
  // FUTURE AGREED WIRE fixture only: current Source feed has no authoritative parent identity yet.
  // These unit positives do not assert actual Source serializer parity or cross-service acceptance.
  const source: FutureSourceWire = {
    id: 'synthetic-case',
    number: 'SYNTHETIC-CASE',
    type: 'REPAIR',
    brand: '合成客服窗口',
    caseBrand: 'MOZTECH',
    version: EVIDENCE_TIME,
    status: 'WAITING_CUSTOMER',
    customerLabel: '合成顧客',
    repairAllowed: true,
    releaseInfo: {
      quoteRevision: 4,
      customerApprovedQuoteRevision: 4,
      customerApprovedAt: '2026-10-13T03:20:00.000Z',
      amount: 500,
      currency: 'TWD',
      confirmedPaymentQuoteRevision: 4,
      invoiceRequired: true,
      invoiceStatus: 'ISSUED',
      invoiceSatisfied: true,
      invoiceQuoteRevision: 4,
      quoteBindings: [],
      customerIdentity: {
        companyId: 'synthetic-source-company',
        caseId: 'synthetic-case',
        brand: 'MOZTECH',
        verifiedCustomerId: 'a'.repeat(64),
        verified: true,
      },
    },
    items: [
      {
        id: 'synthetic-source-line',
        name: '合成申報產品',
        sku: 'SYNTHETIC-SKU',
        serialNumber: 'SYNTHETIC-SN',
        quantity: 1,
      },
    ],
  };
  const refresh = (
    decision: 'APPROVE' | 'DECLINE' = 'APPROVE',
    status: 'ACCEPTED' | 'RESOLVED' = 'RESOLVED',
  ) => {
    const planHash = inspectionPlanHash(item.repairInspection);
    item.repairWorkflow.csr = {
      status,
      ownerId: 'csr',
      acceptedAt: '2026-10-13T03:10:00.000Z',
      inspectionRevision: item.repairInspection.revision,
      estimateRevision: item.repairInspection.revision,
      quoteRevision: 4,
      planHash,
      decision,
      sentAt: '2026-10-13T03:05:00.000Z',
      sentBy: 'tech',
      sentToUserId: 'csr',
    };
    item.repairInspection.review = {
      inspectionRevision: item.repairInspection.revision,
      actorId: 'csr',
      name: '合成客服',
      confirmedAt: '2026-10-13T03:20:00.000Z',
      decision,
      planHash,
      quoteRevision: 4,
    };
    source.releaseInfo.quoteBindings = [
      { ...repairSourceBindingForItem(item, source), quoteRevision: 4 },
    ];
  };
  refresh();
  const delegate = (rows: Row[], defaults: () => Row = () => ({})) => ({
    findFirst: jest.fn((args: { where: Row }) =>
      Promise.resolve(
        structuredClone(rows.find((row) => matches(row, args.where)) ?? null),
      ),
    ),
    findMany: jest.fn((args: { where?: Row; take?: number }) =>
      Promise.resolve(
        rows
          .filter((row) => !args.where || matches(row, args.where))
          .slice(0, args.take ?? rows.length)
          .map((row) => structuredClone(row)),
      ),
    ),
    create: jest.fn((args: { data: Row }) => {
      const row = { ...defaults(), ...structuredClone(args.data) };
      rows.push(row);
      return Promise.resolve(structuredClone(row));
    }),
    update: jest.fn((args: { where: Row; data: Row }) => {
      const row = rows.find((entry) => matches(entry, args.where));
      if (!row) throw new Error('mock row missing');
      Object.assign(row, structuredClone(args.data));
      return Promise.resolve(structuredClone(row));
    }),
    updateMany: jest.fn((args: { where: Row; data: Row }) => {
      const found = rows.filter((row) => matches(row, args.where));
      for (const row of found) Object.assign(row, structuredClone(args.data));
      return Promise.resolve({ count: found.length });
    }),
  });
  const tx = {
    repairMediaAsset: delegate(assets, () => ({
      generation: null,
      sha256: null,
      sizeBytes: null,
      finalizedAt: null,
      createdAt: new Date(),
    })),
    repairCustomerReport: delegate(reports),
    repairEvidenceOperation: delegate(operations),
    mailroomItem: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === item.id ? structuredClone(item) : null),
      ),
    },
    employee: {
      findFirst: jest.fn(() =>
        Promise.resolve(employeeActive ? { id: 'synthetic-employee' } : null),
      ),
    },
    $queryRaw: jest.fn((_sql: Prisma.Sql) => {
      void _sql;
      return Promise.resolve([]);
    }),
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (db: typeof tx) => Promise<unknown>) => {
      const before = [assets, reports, operations].map((rows) =>
        structuredClone(rows),
      );
      try {
        return await fn(tx);
      } catch (error) {
        [assets, reports, operations].forEach((rows, index) =>
          rows.splice(0, rows.length, ...before[index]),
        );
        throw error;
      }
    }),
  };
  const actor = jest.fn(
    (id: string): Promise<Actor> =>
      Promise.resolve({
        id,
        name: id,
        permissions: new Set(permissions.get(id) ?? []),
        entityIds: companies.get(id) ?? [],
      }),
  );
  const mailroom = {
    actor,
    enabled: jest.fn(),
    detail: jest.fn((_user: string, entityId: string, id: string) => {
      if (entityId !== item.entityId || id !== item.id)
        throw new Error('foreign item');
      return Promise.resolve(structuredClone(item));
    }),
  };
  const sync = {
    cases: jest.fn(() => Promise.resolve({ items: [structuredClone(source)] })),
  };
  const storage = {
    configuration: jest.fn(() => ({ bucket: 'synthetic-private-bucket' })),
    mint: jest.fn(() =>
      Promise.resolve(
        'https://storage.googleapis.com/upload/SYNTHETIC-SESSION',
      ),
    ),
    verify: jest.fn(() =>
      Promise.resolve({
        generation: '123456789012345678',
        sha256: 'b'.repeat(64),
        sizeBytes: 1024,
        contentType: 'image/png',
      }),
    ),
    stream: jest.fn(() => Readable.from([Buffer.from('SYNTHETIC_MEDIA')])),
  };
  const media = new RepairMediaService(
    prisma as unknown as PrismaService,
    mailroom as unknown as MailroomService,
    storage as unknown as RepairMediaStorageService,
  );
  const report = new RepairCustomerReportService(
    prisma as unknown as PrismaService,
    mailroom as unknown as MailroomService,
    sync as unknown as MailroomSyncService,
    media,
  );
  const addAsset = (id = 'inspection-media', extra: Row = {}) => {
    const row: Row = {
      id,
      entityId: EVIDENCE_COMPANY,
      itemId: item.id,
      kind: 'inspection',
      documentRevision: 3,
      phase: 'DIAGNOSTIC',
      checkKey: 'power',
      status: 'FINALIZED',
      bucket: 'synthetic-private-bucket',
      objectKey: `repair-media/${EVIDENCE_COMPANY}/${item.id}/${id}`,
      generation: '123456789012345678',
      sha256: 'b'.repeat(64),
      contentType: 'image/png',
      sizeBytes: 1024n,
      uploadedById: 'tech',
      expiresAt: new Date('2026-10-13T04:15:00.000Z'),
      finalizedAt: new Date(EVIDENCE_TIME),
      bindings: [
        {
          kind: 'inspection',
          documentRevision: 3,
          phase: 'DIAGNOSTIC',
          checkKey: 'power',
        },
      ],
      createdAt: new Date(EVIDENCE_TIME),
      ...extra,
    };
    assets.push(row);
    return row;
  };
  addAsset();
  const command = (
    requestId = 'synthetic-command-001',
  ): RepairEvidenceCommand => ({
    entityId: EVIDENCE_COMPANY,
    requestId,
    expectedVersion: item.version,
  });
  const upload = (
    requestId = 'synthetic-upload-001',
  ): RepairMediaUploadDto => ({
    ...command(requestId),
    kind: 'inspection',
    phase: 'BEFORE',
    contentType: 'image/png',
  });
  const publish = (
    kind: 'inspection' | 'repair' = 'inspection',
    requestId = 'synthetic-publish-001',
  ): RepairReportPublishDto => ({
    ...command(requestId),
    kind,
    expiresInDays: 7,
  });
  const complete = (outcome: RepairData['outcome'] = 'REPAIRED') => {
    if (outcome === 'REPLACED') {
      item.repairInspection.data.plan = 'REPLACE';
      item.repairInspection.data.replacementSku = 'SYNTHETIC-REPLACEMENT';
      item.repairInspection.data.replacementCondition = 'REFURBISHED';
    }
    if (outcome === 'FACTORY_REPAIRED')
      item.repairInspection.data.plan = 'FACTORY';
    refresh();
    item.status = 'WAITING_RETURN_ACCEPTANCE';
    item.repairReport = {
      number: 'SYNTHETIC-REP',
      revision: 2,
      inspectionRevision: item.repairInspection.revision,
      status: 'SUBMITTED',
      authorId: 'tech',
      authorName: '合成維修師',
      submittedAt: '2026-10-13T03:30:00.000Z',
      updatedAt: '2026-10-13T03:30:00.000Z',
      data: {
        protocol: 2,
        outcome,
        workPerformed: '合成實際工作',
        parts: [],
        laborMinutes: 10,
        checks: [
          {
            key: 'power',
            name: '電源',
            result: 'PASS',
            observation: '合成實測通過',
          },
        ],
        qcResult: 'PASS',
        qcNotes: '合成複驗',
        deliveredAccessories: '合成配件',
        ...(outcome === 'REPLACED'
          ? {
              replacementCondition: 'REFURBISHED' as const,
              replacementSku: 'SYNTHETIC-REPLACEMENT',
              replacementSerial: 'SYNTHETIC-REPLACEMENT-SN',
              replacementSource: 'synthetic-native-unit',
              originalDisposition: '合成原件留存',
              inventoryReference: 'synthetic-stock-out',
            }
          : {}),
        ...(outcome === 'FACTORY_REPAIRED'
          ? { factoryReference: 'synthetic-factory-reference' }
          : {}),
        mediaRefs: [
          { mediaId: 'repair-media', phase: 'AFTER', checkKey: 'power' },
        ],
        customerReportDraft: {
          findings: '合成故障',
          handling: '合成實修',
          verification: '合成複驗',
          mediaIds: ['repair-media'],
        },
      },
    };
    item.repairWorkflow.release = {
      purpose: outcome,
      inspectionRevision: item.repairInspection.revision,
      releasedAt: '2026-10-13T03:40:00.000Z',
      releasedBy: 'tech',
      note: '合成已完成正式交回',
      ...(outcome === 'REPLACED'
        ? {
            stock: {
              reservationId: 'synthetic-reservation',
              postingId: 'synthetic-stock-out',
              externalStatus: 'NOT_CONFIGURED',
              quantity: 1,
              entityId: EVIDENCE_COMPANY,
              itemId: item.id,
              unitLabel: 'synthetic-native-unit',
              replacementSN: 'SYNTHETIC-REPLACEMENT-SN',
            },
          }
        : {}),
    };
    addAsset('repair-media', {
      kind: 'repair',
      documentRevision: 2,
      phase: 'AFTER',
      bindings: [
        {
          kind: 'repair',
          documentRevision: 2,
          phase: 'AFTER',
          checkKey: 'power',
        },
      ],
    });
  };
  return {
    item,
    source,
    assets,
    reports,
    operations,
    tx,
    prisma,
    actor,
    permissions,
    companies,
    mailroom,
    sync,
    storage,
    media,
    report,
    command,
    upload,
    publish,
    addAsset,
    complete,
    refresh,
    deactivateEmployee: () => {
      employeeActive = false;
    },
    transactionClient: tx as unknown as Prisma.TransactionClient,
    nativeItem: () =>
      item as unknown as Prisma.MailroomItemGetPayload<{
        include: { receipt: true };
      }>,
    prismaClient: prisma as unknown as PrismaClient,
  };
}
