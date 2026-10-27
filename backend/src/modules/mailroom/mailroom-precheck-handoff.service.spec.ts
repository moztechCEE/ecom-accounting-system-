/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { MailroomService } from './mailroom.service';
import { MailroomPrecheckService } from './mailroom-precheck.service';
import { fingerprint, type Actor } from './mailroom.contract';
import {
  precheckContentHash,
  precheckIdentityHash,
} from './mailroom-precheck.contract';
import { resolvePrecheckTemplate } from './mailroom-precheck.templates';
import {
  recordedPrecheck,
  recordedPrecheckPhoto,
} from './mailroom-precheck-record.contract';

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const photo = 'data:image/png;base64,iVBORw0KGgo=';
const copy = <T>(value: T): T => structuredClone(value);
function fixture() {
  let actor: Actor = {
    id: 'clerk',
    name: 'SYNTHETIC CLERK',
    entityIds: ['company'],
    permissions: new Set(['mailroom:read', 'mailroom:update']),
  };
  const item: any = {
    id: id(1),
    entityId: 'company',
    receiptId: id(2),
    label: 'SYNTHETIC-MR-1',
    version: 3,
    status: 'RECEIVED',
    productId: 'product',
    productName: 'SYNTHETIC PRODUCT',
    sku: 'SKU',
    serialNumber: 'SN',
    matchResult: 'MATCH',
    declared: {
      id: 'source-line',
      name: 'SYNTHETIC PRODUCT',
      sku: 'SKU',
      serialNumber: 'SN',
      quantity: 1,
    },
    evidence: [photo],
    custodianId: 'clerk',
    repairOwnerId: null,
    nextUserId: null,
    recipientId: null,
    location: 'A4-1',
    storageLocationId: 'location',
    repairWorkflow: null,
    returnInspection: null,
    conditionNote: null,
    receipt: {
      id: id(2),
      entityId: 'company',
      category: 'REPAIR',
      sourceCaseId: 'source-case',
      sourceNumber: 'CASE-DEMO',
      sourceSnapshot: { version: 'ORIGINAL' },
      customerServiceUserId: 'old-csr',
      receivedAt: new Date('2026-10-16T00:00:00Z'),
    },
  };
  const product = {
    id: 'product',
    entityId: 'company',
    sku: 'SKU',
    isActive: true,
    attributes: null,
  };
  const template = resolvePrecheckTemplate(
    item,
    product,
    'GENERIC_FUNCTIONAL_V1',
  ).template!;
  const doc: any = {
    id: id(3),
    entityId: 'company',
    itemId: item.id,
    revision: 2,
    status: 'READY',
    identityHash: precheckIdentityHash(item),
    template,
    data: {
      checks: [
        {
          key: 'basic_function',
          result: 'ABNORMAL',
          note: 'SYNTHETIC PRIVATE OBSERVATION',
          evidenceIndexes: [0],
        },
      ],
      evidence: [photo],
      notRequiredReason: null,
    },
    savedById: 'clerk',
    savedByName: 'SYNTHETIC CLERK',
    savedAt: new Date('2026-10-16T00:00:00Z'),
    submittedById: null,
    submittedAt: null,
  };
  const part = {
    itemId: item.id,
    requestId: id(5),
    expectedVersion: 3,
    precheckRevision: 2,
    precheckHash: precheckContentHash(doc),
    identityHash: doc.identityHash,
  };
  const input = { entityId: 'company', requestId: id(4), items: [part] };
  const batch: any = {
    id: id(6),
    entityId: 'company',
    actorId: 'clerk',
    requestId: input.requestId,
    requestHash: fingerprint({ operation: 'HANDOFF', ...input }),
    operation: 'HANDOFF',
    result: { input: copy(input), items: [] },
  };
  const actions: any[] = [],
    requests: any[] = [],
    deliveries: any[] = [];
  const db: any = {
    $executeRaw: jest.fn(async () => 0),
    $queryRaw: jest.fn(async () => []),
    employee: { findFirst: jest.fn(async () => ({ id: 'employee' })) },
    product: { findFirst: jest.fn(async () => product) },
    mailroomItem: {
      findFirst: jest.fn(async ({ where }) =>
        where.entityId === item.entityId && where.id === item.id
          ? copy(item)
          : null,
      ),
      update: jest.fn(async ({ data }) => {
        const { version, ...fields } = data;
        Object.assign(item, fields);
        item.version += version.increment;
        return copy(item);
      }),
    },
    mailroomReceipt: {
      update: jest.fn(async ({ data }) => {
        Object.assign(item.receipt, data);
        return item.receipt;
      }),
    },
    mailroomPrecheckDocument: {
      findUnique: jest.fn(async () => copy(doc)),
      update: jest.fn(async ({ data }) => {
        Object.assign(doc, data);
        return copy(doc);
      }),
    },
    mailroomPrecheckBatch: { findUnique: jest.fn(async () => copy(batch)) },
    mailroomPrecheckRequest: {
      findUnique: jest.fn(async () => copy(requests[0] ?? null)),
      create: jest.fn(async ({ data }) => {
        requests.push(copy(data));
        return data;
      }),
    },
    mailroomAction: {
      findUnique: jest.fn(async () => copy(actions[0] ?? null)),
      create: jest.fn(async ({ data }) => {
        const row = {
          id: id(9),
          createdAt: new Date('2026-10-16T01:00:00Z'),
          ...data,
        };
        actions.push(copy(row));
        return row;
      }),
    },
    mailroomTask: {
      updateMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(() => {
        throw new Error('per-item task forbidden');
      }),
    },
    mailroomDelivery: {
      createMany: jest.fn(async ({ data }) => {
        deliveries.push(...copy(data));
        return { count: data.length };
      }),
    },
    notification: {
      create: jest.fn(() => {
        throw new Error('per-item notification forbidden');
      }),
    },
    inventoryTransaction: {
      create: jest.fn(() => {
        throw new Error('stock forbidden');
      }),
    },
  };
  const sync = {
    cases: jest.fn(async () => ({
      items: [
        {
          id: 'source-case',
          number: 'CASE-DEMO',
          type: 'REPAIR',
          status: 'PROCESSING',
          version: '2026-10-16T00:00:00.000Z',
          items: [copy(item.declared)],
        },
      ],
    })),
    deliverPending: jest.fn(),
  };
  const gateway = { sendToUser: jest.fn() };
  const service = new MailroomService(db, gateway as never, sync as never);
  jest.spyOn(service, 'enabled').mockImplementation(() => undefined);
  jest.spyOn(service, 'actor').mockImplementation(async () => actor);
  jest.spyOn(service, 'customerService').mockResolvedValue('fresh-csr');
  const run = () => service.completePrecheckHandoff(db, 'clerk', batch, part);
  return {
    db,
    service,
    item,
    doc,
    part,
    input,
    batch,
    actions,
    requests,
    deliveries,
    sync,
    gateway,
    run,
    setActor: (next: Actor) => {
      actor = next;
    },
    actor,
  };
}

describe('precheck handoff uses the existing physical transition without acceptance', () => {
  it('records one immutable child, submitted observations and AFTER_SALES pending without moving custody', async () => {
    const f = fixture(),
      before = copy(f.item);
    const result = await f.run();
    expect(result).toMatchObject({
      status: 'APPLIED',
      itemVersion: 4,
      actionId: id(9),
    });
    expect(f.item).toMatchObject({
      status: 'WAITING_REPAIR_ACCEPTANCE',
      custodianId: before.custodianId,
      location: before.location,
      storageLocationId: before.storageLocationId,
      repairOwnerId: null,
      nextUserId: null,
      evidence: before.evidence,
      declared: before.declared,
    });
    expect(f.item.receipt.sourceSnapshot).toEqual(
      before.receipt.sourceSnapshot,
    );
    expect(f.item.receipt.customerServiceUserId).toBe('fresh-csr');
    expect(f.doc).toMatchObject({
      status: 'SUBMITTED',
      revision: 2,
      submittedById: 'clerk',
    });
    expect(f.actions).toHaveLength(1);
    expect(f.requests).toHaveLength(1);
    expect(f.actions[0].snapshot.precheckRef).toEqual({
      id: f.doc.id,
      revision: 2,
      contentHash: f.part.precheckHash,
      identityHash: f.part.identityHash,
    });
    expect(JSON.stringify(f.actions)).not.toContain(
      'SYNTHETIC PRIVATE OBSERVATION',
    );
    expect(f.deliveries).toHaveLength(1);
    expect(f.deliveries[0]).toMatchObject({
      target: 'AFTER_SALES',
      payload: {
        schema: 'corely.mailroom.v1',
        action: 'inspect',
        inventoryPosted: false,
        refundExecuted: false,
      },
    });
    expect(JSON.stringify(f.deliveries)).not.toContain(
      'SYNTHETIC PRIVATE OBSERVATION',
    );
    expect(f.db.mailroomTask.create).not.toHaveBeenCalled();
    expect(f.db.notification.create).not.toHaveBeenCalled();
    expect(f.sync.deliverPending).not.toHaveBeenCalled();
    expect(f.gateway.sendToUser).not.toHaveBeenCalled();
    expect(f.db.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  it('replays original success after technician claim/accept without Source reread or stale state checks', async () => {
    const f = fixture(),
      first = await f.run();
    Object.assign(f.item, {
      status: 'INSPECTING',
      version: 11,
      custodianId: 'tech',
      repairOwnerId: 'tech',
      nextUserId: 'tech',
    });
    f.doc.status = 'SUBMITTED';
    f.sync.cases.mockClear();
    expect(await f.run()).toEqual({ ...first, duplicate: true });
    expect(f.sync.cases).not.toHaveBeenCalled();
    expect(f.actions).toHaveLength(1);
    expect(f.deliveries).toHaveLength(1);
  });
  it('rejects changed child body even after success', async () => {
    const f = fixture();
    await f.run();
    f.part.expectedVersion = 99;
    await expect(f.run()).rejects.toThrow('批次或逐件內容');
    expect(f.actions).toHaveLength(1);
  });
  it('rechecks current permission before returning any old receipt', async () => {
    const f = fixture();
    await f.run();
    f.setActor({ ...f.actor, permissions: new Set(['mailroom:read']) });
    await expect(f.run()).rejects.toThrow('權限');
    expect(f.actions).toHaveLength(1);
  });
  it.each([
    'RETURN',
    'CONFIRMED_ACTUAL',
    'OTHER_CUSTODIAN',
    'NOT_READY',
    'BAD_HASH',
    'CHANGED_INTAKE_NOTE',
    'NO_EMPLOYEE',
    'NO_CSR',
    'SOURCE_CHANGED',
    'SKU_CHANGED',
    'UNRESOLVED_INTAKE',
    'FOREIGN_RECEIPT',
  ])('fails closed before any business write: %s', async (kind) => {
    const f = fixture();
    if (kind === 'RETURN') f.item.receipt.category = 'RETURN';
    if (kind === 'FOREIGN_RECEIPT') f.item.receipt.entityId = 'foreign';
    if (kind === 'CONFIRMED_ACTUAL') f.item.matchResult = 'CONFIRMED_ACTUAL';
    if (kind === 'OTHER_CUSTODIAN') f.item.custodianId = 'other';
    if (kind === 'NOT_READY') f.doc.status = 'DRAFT';
    if (kind === 'BAD_HASH') f.doc.data.checks[0].note = 'CHANGED';
    if (kind === 'CHANGED_INTAKE_NOTE')
      Object.assign(f.doc.data, {
        mailroomIssue: {
          schema: 1,
          symptom: 'CHANGED',
          preliminaryReason: null,
        },
      });
    if (kind === 'NO_EMPLOYEE') f.db.employee.findFirst.mockResolvedValue(null);
    if (kind === 'NO_CSR')
      jest.spyOn(f.service, 'customerService').mockResolvedValue(null);
    if (kind === 'SOURCE_CHANGED')
      f.sync.cases.mockResolvedValue({
        items: [
          {
            id: 'source-case',
            number: 'CASE-DEMO',
            type: 'REPAIR',
            status: 'PROCESSING',
            version: '2026-10-16T00:00:00.000Z',
            items: [{ ...f.item.declared, sku: 'different' }],
          },
        ],
      });
    if (kind === 'SKU_CHANGED') f.item.sku = 'different';
    if (kind === 'UNRESOLVED_INTAKE')
      f.item.repairWorkflow = {
        intake: {
          status: 'SENT',
          sentToUserId: 'csr',
          sentToUserName: 'CSR',
          sentBy: 'clerk',
          sentAt: '2026-10-16T00:00:00.000Z',
          note: 'check',
        },
      };
    await expect(f.run()).rejects.toThrow();
    expect(f.db.mailroomItem.update).not.toHaveBeenCalled();
    expect(f.db.mailroomReceipt.update).not.toHaveBeenCalled();
    expect(f.db.mailroomAction.create).not.toHaveBeenCalled();
    expect(f.deliveries).toHaveLength(0);
  });
  it('rejects cross-company access before replay', async () => {
    const f = fixture();
    f.setActor({ ...f.actor, entityIds: ['other'] });
    await expect(f.run()).rejects.toThrow('公司');
    expect(f.db.mailroomPrecheckRequest.findUnique).not.toHaveBeenCalled();
  });
  it('does not allow an arbitrary record caller to request the cleanup-only policy', async () => {
    const f = fixture();
    await expect(
      f.service.record(
        f.db,
        f.actor,
        { ...f.item, status: 'INSPECTING' },
        'accept',
        id(50),
        'hash',
        'RECEIVED',
        undefined,
        true,
        false,
        undefined,
        {
          kind: 'PRECHECK_HANDOFF',
          ref: {
            id: f.doc.id,
            revision: 2,
            contentHash: f.part.precheckHash,
            identityHash: f.part.identityHash,
          },
        },
      ),
    ).rejects.toThrow('政策');
    expect(f.actions).toHaveLength(0);
  });
});

describe('read-only submitted precheck records', () => {
  it.each(['DRAFT', 'READY', 'SUBMITTED'])(
    'projects %s through the actual native detail method for a technician reader',
    async (status) => {
      const f = fixture();
      f.setActor({
        ...f.actor,
        permissions: new Set(['repair_workbench:read']),
      });
      f.doc.status = status;
      f.doc.submittedAt =
        status === 'SUBMITTED' ? new Date('2026-10-16T02:00:00Z') : null;
      f.db.mailroomItem.findUnique = jest.fn(async () => copy(f.item));
      f.db.mailroomAction.findMany = jest.fn(async () => []);
      f.db.mailroomDelivery.findMany = jest.fn(async () => []);
      f.db.mailroomDelivery.groupBy = jest.fn(async () => []);
      f.db.mailroomPrecheckDocument.findMany = jest.fn(async () => [
        copy(f.doc),
      ]);
      f.db.user = { findMany: jest.fn(async () => []) };
      const value = await f.service.detail('tech', 'company', f.item.id);
      expect(value.mailroomPrecheck.stage).toBe(status);
      if (status === 'SUBMITTED') {
        expect(value.mailroomPrecheck.recorded?.checks[0].note).toBe(
          'SYNTHETIC PRIVATE OBSERVATION',
        );
        expect(value.mailroomPrecheck.recorded?.photos[0].url).toContain(
          '/recorded-photos/',
        );
      } else {
        expect(value.mailroomPrecheck.recorded).toBeNull();
        expect(JSON.stringify(value)).not.toContain(
          'SYNTHETIC PRIVATE OBSERVATION',
        );
      }
      expect(value).not.toHaveProperty('repairPrecheckDocument');
      expect(f.db.mailroomPrecheckDocument.findUnique).toHaveBeenCalledWith({
        where: { entityId_itemId: { entityId: 'company', itemId: f.item.id } },
      });
    },
  );
  it('serves only a submitted current revision photo after native permission checks', async () => {
    const f = fixture();
    f.doc.status = 'SUBMITTED';
    f.doc.submittedAt = new Date();
    const p = recordedPrecheck(f.item, f.doc).recorded!.photos[0];
    const svc = new MailroomPrecheckService(f.db, f.service);
    expect(
      (await svc.recordedPhoto('clerk', 'company', f.item.id, 2, p.id)).type,
    ).toBe('image/png');
    await expect(
      svc.recordedPhoto('clerk', 'other', f.item.id, 2, p.id),
    ).rejects.toThrow('找不到');
    f.setActor({ ...f.actor, permissions: new Set() });
    await expect(
      svc.recordedPhoto('clerk', 'company', f.item.id, 2, p.id),
    ).rejects.toThrow('存取權限');
    f.setActor(f.actor);
    f.doc.status = 'DRAFT';
    await expect(
      svc.recordedPhoto('clerk', 'company', f.item.id, 2, p.id),
    ).rejects.toThrow('找不到此版');
  });
  it.each(['DRAFT', 'READY'])(
    'does not expose %s notes or photos',
    (status) => {
      const f = fixture();
      f.doc.status = status;
      const value = recordedPrecheck(f.item, f.doc);
      expect(value.recorded).toBeNull();
      expect(JSON.stringify(value)).not.toMatch(
        /PRIVATE OBSERVATION|data:image/,
      );
    },
  );
  it('exposes manual warranty and separate intake observations only after submission', () => {
    const f = fixture();
    const warrantyReview = {
      schema: 1,
      method: 'MANUAL_EXTERNAL',
      status: 'CORRECTED_EXTERNALLY',
      warrantyNumber: 'SYNTHETIC-WARRANTY',
      note: 'SYNTHETIC MANUAL REVIEW',
      recordedById: 'clerk',
      recordedByName: 'SYNTHETIC CLERK',
      recordedAt: '2026-10-27T09:00:00.000Z',
    };
    const mailroomIssue = {
      schema: 1,
      symptom: 'SYNTHETIC INTAKE ISSUE',
      preliminaryReason: 'SYNTHETIC UNCONFIRMED REASON',
    };
    Object.assign(f.doc.data, { warrantyReview, mailroomIssue });
    f.doc.status = 'DRAFT';
    expect(recordedPrecheck(f.item, f.doc).recorded).toBeNull();
    f.doc.status = 'READY';
    expect(recordedPrecheck(f.item, f.doc).recorded).toBeNull();
    f.doc.status = 'SUBMITTED';
    f.doc.submittedAt = new Date();
    expect(recordedPrecheck(f.item, f.doc).recorded).toMatchObject({
      warrantyReview,
      mailroomIssue,
    });
    f.item.serialNumber = 'DIFFERENT-IDENTITY';
    expect(recordedPrecheck(f.item, f.doc).recorded).toBeNull();
  });
  it('uses historical template labels and digest-bound photos; movement does not erase the record', () => {
    const f = fixture();
    f.doc.status = 'SUBMITTED';
    f.doc.submittedAt = new Date();
    const first = recordedPrecheck(f.item, f.doc);
    expect(first.recorded?.checks[0].label).toBe(
      f.doc.template.checks[0].label,
    );
    const p = first.recorded!.photos[0];
    expect(p.id).toMatch(/^[a-f0-9]{64}$/);
    expect(recordedPrecheckPhoto(f.item, f.doc, 2, p.id)?.type).toBe(
      'image/png',
    );
    f.item.version = 20;
    f.item.custodianId = 'tech';
    f.item.location = 'TECH';
    expect(recordedPrecheck(f.item, f.doc).recorded).toEqual(first.recorded);
    f.doc.data.evidence = [photo + 'CHANGED'];
    expect(recordedPrecheckPhoto(f.item, f.doc, 2, p.id)).toBeNull();
  });
  it('does not expose stale identity results or an old revision photo', () => {
    const f = fixture();
    f.doc.status = 'SUBMITTED';
    f.doc.submittedAt = new Date();
    const p = recordedPrecheck(f.item, f.doc).recorded!.photos[0];
    expect(recordedPrecheckPhoto(f.item, f.doc, 1, p.id)).toBeNull();
    f.item.serialNumber = 'CHANGED';
    expect(recordedPrecheck(f.item, f.doc)).toMatchObject({
      stage: 'STALE',
      recorded: null,
    });
    expect(recordedPrecheckPhoto(f.item, f.doc, 2, p.id)).toBeNull();
  });
});

describe('batch orchestration resumes unknown children and aggregates low-interruption notifications', () => {
  it.each([
    'PARTIAL_LATE_JOINER',
    'COMPLETE_LATE_JOINER',
    'EMPTY_SNAPSHOT',
    'REVOKED_GRANTS',
    'WILDCARD_ONLY',
    'FOREIGN_EMPLOYEE',
    'FORCE_PASSWORD',
    'INACTIVE_USER',
  ])(
    'retries unknown children with a frozen recipient set and fresh eligibility: %s',
    async (mode) => {
      const f = fixture(),
        batches: any[] = [],
        recipient: any[] = [],
        notifications: any[] = [];
      const attempts = new Map<string, number>();
      const secondPart = { ...f.part, itemId: id(20), requestId: id(21) };
      f.input.items.push(secondPart);
      f.db.$transaction = async (fn: any) => fn(f.db);
      f.db.mailroomPrecheckBatch.findUnique = jest.fn(
        async ({ where }) =>
          batches.find((row) =>
            where.id
              ? row.id === where.id
              : row.requestId === where.entityId_actorId_requestId.requestId,
          ) ?? null,
      );
      f.db.mailroomPrecheckBatch.create = jest.fn(async ({ data }) => {
        const row = { id: id(6), recipientSnapshot: null, ...data };
        batches.push(row);
        return row;
      });
      f.db.mailroomPrecheckBatch.update = jest.fn(async ({ data }) =>
        Object.assign(batches[0], data),
      );
      f.db.mailroomPrecheckBatch.findFirst = jest.fn(async () => batches[0]);
      f.db.mailroomPrecheckRequest.findMany = jest.fn(async () => f.requests);
      f.db.mailroomPrecheckBatchRecipient = {
        findUnique: jest.fn(
          async ({ where }) =>
            recipient.find(
              (row) => row.userId === where.batchId_userId.userId,
            ) ?? null,
        ),
        create: jest.fn(async ({ data }) => recipient.push(data)),
        count: jest.fn(async () => recipient.length),
      };
      const techState = {
        grants: new Set(['repair_workbench:read', 'repair_workbench:update']),
        entityId: 'company',
        active: true,
        mustChangePassword: false,
      };
      const candidates: any[] = [
        {
          id: 'qualified-tech',
          employee: null,
          roles: [
            {
              role: {
                permissions: [
                  {
                    permission: {
                      resource: 'repair_workbench',
                      action: 'read',
                    },
                  },
                  {
                    permission: {
                      resource: 'repair_workbench',
                      action: 'update',
                    },
                  },
                ],
              },
            },
          ],
        },
      ];
      if (mode === 'EMPTY_SNAPSHOT') candidates.splice(0);
      jest.spyOn(f.service, 'actor').mockImplementation(async (userId) =>
        userId === 'clerk'
          ? f.actor
          : {
              id: userId,
              name: 'SYNTHETIC TECH',
              entityIds: mode === 'WILDCARD_ONLY' ? null : ['company'],
              permissions: new Set(techState.grants),
            },
      );
      f.db.user = {
        findMany: jest.fn(async () => {
          // The candidate row still has the old explicit grants; the fresh actor
          // read and the exact current employee/status query must decide eligibility.
          if (mode === 'REVOKED_GRANTS') techState.grants = new Set();
          if (mode === 'WILDCARD_ONLY') techState.grants = new Set(['*']);
          if (mode === 'FOREIGN_EMPLOYEE') techState.entityId = 'other';
          if (mode === 'FORCE_PASSWORD') techState.mustChangePassword = true;
          if (mode === 'INACTIVE_USER') techState.active = false;
          return copy(candidates);
        }),
        findFirst: jest.fn(async ({ where }) =>
          techState.active &&
          !techState.mustChangePassword &&
          techState.entityId === where.employee.entityId &&
          where.isActive === true &&
          where.mustChangePassword === false &&
          where.employee.isActive === true
            ? { id: where.id }
            : null,
        ),
      };
      f.db.notification = {
        create: jest.fn(async ({ data }) => {
          const row = { id: id(15), read: false, ...data };
          notifications.push(row);
          return row;
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      };
      const complete = jest
        .spyOn(f.service, 'completePrecheckHandoff')
        .mockImplementation(async (_tx, _user, batch, part) => {
          attempts.set(part.requestId, (attempts.get(part.requestId) ?? 0) + 1);
          if (
            part.requestId === secondPart.requestId &&
            mode !== 'COMPLETE_LATE_JOINER' &&
            attempts.get(part.requestId) === 1
          )
            throw new Error('unknown transport result');
          expect(part).toEqual(
            part.requestId === f.part.requestId ? f.part : secondPart,
          );
          expect(batch.id).toBe(id(6));
          const result = {
            itemId: part.itemId,
            requestId: part.requestId,
            status: 'APPLIED' as const,
            itemVersion: 4,
          };
          if (!f.requests.some((row) => row.requestId === part.requestId))
            f.requests.push({ requestId: part.requestId, result });
          return result;
        });
      const gateway = {
        sendToUser: jest.fn(() => {
          throw new Error('socket unavailable');
        }),
      };
      const svc = new MailroomPrecheckService(
        f.db,
        f.service,
        gateway as never,
      );
      expect(
        (await svc.handoff('clerk', f.input)).items.map((part) => part.status),
      ).toEqual(
        mode === 'COMPLETE_LATE_JOINER'
          ? ['APPLIED', 'APPLIED']
          : ['APPLIED', 'UNKNOWN'],
      );
      const expectedCount = [
        'PARTIAL_LATE_JOINER',
        'COMPLETE_LATE_JOINER',
      ].includes(mode)
        ? 1
        : 0;
      expect(batches[0].recipientSnapshot).toEqual(
        expectedCount ? ['qualified-tech'] : [],
      );
      candidates.push({ id: 'late-tech' });
      techState.grants = new Set([
        'repair_workbench:read',
        'repair_workbench:update',
      ]);
      techState.entityId = 'company';
      techState.active = true;
      techState.mustChangePassword = false;
      expect(
        (await svc.handoff('clerk', f.input)).items.map((part) => part.status),
      ).toEqual(['APPLIED', 'APPLIED']);
      expect(
        (await svc.handoff('clerk', f.input)).notificationRecipientCount,
      ).toBe(expectedCount);
      expect(complete).toHaveBeenCalledTimes(6);
      expect(f.db.notification.create).toHaveBeenCalledTimes(expectedCount);
      expect(gateway.sendToUser).toHaveBeenCalledTimes(expectedCount);
      expect(f.db.user.findMany).toHaveBeenCalledTimes(1);
      for (const row of notifications) {
        expect(row.userId).toBe('qualified-tech');
        expect(row.read).toBe(false);
      }
      expect((await svc.batch('clerk', 'company', id(6))).items).toHaveLength(
        2,
      );
      for (const row of notifications) expect(row.read).toBe(false);
      f.input.items[0].expectedVersion = 99;
      await expect(svc.handoff('clerk', f.input)).rejects.toThrow('批次識別碼');
      expect(complete).toHaveBeenCalledTimes(6);
      expect(f.sync.deliverPending).not.toHaveBeenCalled();
    },
  );
});
