/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MailroomPrecheckService } from './mailroom-precheck.service';
import { MailroomService } from './mailroom.service';
import type { Actor } from './mailroom.contract';

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const png = 'data:image/png;base64,iVBORw0KGgo=';
const clone = <T>(value: T): T => structuredClone(value);
describe('native mailroom prechecks write only their own document/request tables', () => {
  let db: any, mailroom: any, service: MailroomPrecheckService, actor: Actor;
  let items: any[],
    docs: any[],
    requests: any[],
    batches: any[],
    product: any,
    employee: boolean;
  const makeItem = (n: number, category = 'REPAIR') => ({
    id: id(n),
    entityId: 'company-a',
    receiptId: id(100 + n),
    label: `MR-${n}`,
    version: 1,
    status: 'RECEIVED',
    productId: 'product-a',
    productName: 'SYNTHETIC',
    sku: 'P1',
    serialNumber: `SN-${n}`,
    declared: {
      id: 'source-line',
      name: 'SYNTHETIC',
      sku: 'P1',
      serialNumber: null,
      quantity: 2,
    },
    evidence: [png],
    custodianId: 'original-clerk',
    repairOwnerId: null,
    nextUserId: null,
    location: 'A4-1',
    storageLocationId: id(80),
    repairWorkflow: null,
    receipt: {
      entityId: 'company-a',
      category,
      sourceCaseId: 'source-case',
      sourceNumber: 'CASE-DEMO',
    },
  });
  const startBody = (n = 1, request = 20) => ({
    entityId: 'company-a',
    requestId: id(request),
    items: [{ itemId: id(n), requestId: id(request + 1), expectedVersion: 1 }],
  });
  const saveBody = (revision: number, request = 30, changes: any = {}) => ({
    entityId: 'company-a',
    requestId: id(request),
    expectedVersion: 1,
    expectedRevision: revision,
    status: 'DRAFT' as const,
    templateBinding: null,
    checks: [],
    ...changes,
  });
  const keyMatches = (row: any, query: any) =>
    Object.entries(query).every(([key, value]) => row[key] === value);
  beforeEach(() => {
    items = [makeItem(1), makeItem(2, 'RETURN')];
    docs = [];
    requests = [];
    batches = [];
    employee = true;
    product = {
      id: 'product-a',
      entityId: 'company-a',
      sku: 'P1',
      isActive: true,
      attributes: null,
    };
    actor = {
      id: 'editor',
      name: 'SYNTHETIC EDITOR',
      entityIds: ['company-a'],
      permissions: new Set(['mailroom:read', 'mailroom:update']),
    };
    const forbidden = () =>
      jest.fn(() => {
        throw new Error('unexpected business write');
      });
    db = {
      $executeRaw: jest.fn(async () => 0),
      $queryRaw: jest.fn(async () => []),
      employee: {
        findFirst: jest.fn(async () =>
          employee ? { id: 'employee-a' } : null,
        ),
      },
      product: {
        findFirst: jest.fn(async ({ where }) =>
          keyMatches(product, where) ? clone(product) : null,
        ),
      },
      mailroomItem: {
        findFirst: jest.fn(async ({ where }) =>
          clone(
            items.find(
              (row) =>
                row.id === where.id &&
                row.entityId === where.entityId &&
                row.receipt.entityId === where.receipt.entityId,
            ) ?? null,
          ),
        ),
        findMany: jest.fn(async () => clone(items)),
        update: forbidden(),
      },
      mailroomPrecheckDocument: {
        findUnique: jest.fn(async ({ where }) =>
          clone(
            docs.find((row) => keyMatches(row, where.entityId_itemId)) ?? null,
          ),
        ),
        findMany: jest.fn(async () => clone(docs)),
        upsert: jest.fn(async ({ where, create, update }) => {
          const previous = docs.find((row) =>
            keyMatches(row, where.entityId_itemId),
          );
          const data = clone(previous ? update : create);
          if (
            data.template &&
            JSON.stringify(data.template) === JSON.stringify(Prisma.DbNull)
          )
            data.template = null;
          if (previous) Object.assign(previous, data);
          else docs.push(data);
          return clone(data);
        }),
        update: jest.fn(async ({ where, data }) => {
          const row = docs.find((doc) => doc.id === where.id);
          if (!row || row.revision !== where.revision)
            throw new ConflictException('revision');
          const saved = {
            ...clone(data),
            revision: row.revision + data.revision.increment,
          };
          if (data.template === Prisma.DbNull) saved.template = null;
          Object.assign(row, saved);
          return clone(row);
        }),
      },
      mailroomPrecheckRequest: {
        findUnique: jest.fn(async ({ where }) =>
          clone(
            requests.find((row) =>
              keyMatches(row, where.entityId_actorId_requestId),
            ) ?? null,
          ),
        ),
        create: jest.fn(async ({ data }) => {
          requests.push(clone(data));
          return data;
        }),
      },
      mailroomPrecheckBatch: {
        findUnique: jest.fn(async ({ where }) =>
          clone(
            batches.find((row) =>
              keyMatches(row, where.entityId_actorId_requestId),
            ) ?? null,
          ),
        ),
        create: jest.fn(async ({ data }) => {
          batches.push(clone(data));
          return data;
        }),
      },
      mailroomAction: { create: forbidden() },
      mailroomDelivery: { createMany: forbidden() },
      mailroomTask: { create: forbidden() },
      notification: { create: forbidden() },
      inventoryTransaction: { create: forbidden() },
    };
    db.$transaction = async (fn: (tx: any) => unknown) => {
      const snapshot = clone({ docs, requests, batches });
      try {
        return await fn(db);
      } catch (error) {
        docs = snapshot.docs;
        requests = snapshot.requests;
        batches = snapshot.batches;
        throw error;
      }
    };
    mailroom = {
      enabled: jest.fn(),
      actor: jest.fn(async () => actor),
      record: forbidden(),
      publish: forbidden(),
    };
    // Exercise the real native reader rather than duplicating its authorization.
    const native = new MailroomService(db, {} as never, {} as never);
    jest.spyOn(native, 'enabled').mockImplementation(() => undefined);
    jest.spyOn(native, 'actor').mockImplementation(async () => actor);
    mailroom.nativeReceiptPhoto = native.nativeReceiptPhoto.bind(native);
    service = new MailroomPrecheckService(db, mailroom);
  });
  afterEach(() => {
    for (const spy of [
      db.mailroomItem.update,
      db.mailroomAction.create,
      db.mailroomDelivery.createMany,
      db.mailroomTask.create,
      db.notification.create,
      db.inventoryTransaction.create,
      mailroom.record,
      mailroom.publish,
    ])
      expect(spy).not.toHaveBeenCalled();
  });
  it('starts two independent native pieces, including RETURN, without claiming either', async () => {
    const original = clone(items),
      body = {
        ...startBody(),
        items: [
          ...startBody().items,
          { itemId: id(2), requestId: id(22), expectedVersion: 1 },
        ],
      };
    const result = await service.start('editor', body);
    expect(result.items).toHaveLength(2);
    expect(docs).toHaveLength(2);
    expect(requests).toHaveLength(2);
    expect(items).toEqual(original);
    expect(result.items[0].custody.custodianId).toBe('original-clerk');
    expect(result.items[0].availableTemplates).toHaveLength(2);
    expect(result.items[0].capabilities.canHandoff).toBe(false);
  });
  it('returns the exact original start proof after unknown outcome, even if the item later changes', async () => {
    const first = await service.start('editor', startBody());
    items[0].version = 8;
    const repeat = await service.start('editor', startBody());
    expect(repeat).toEqual({
      ...JSON.parse(JSON.stringify(first)),
      duplicate: true,
    });
    expect(docs).toHaveLength(1);
    expect(batches).toHaveLength(1);
  });
  it('rejects changed batch bodies or reused per-item request IDs', async () => {
    await service.start('editor', startBody());
    await expect(
      service.start('editor', {
        ...startBody(),
        items: [{ ...startBody().items[0], expectedVersion: 2 }],
      }),
    ).rejects.toThrow('內容不同');
    await expect(
      service.start('editor', {
        ...startBody(1, 23),
        items: startBody().items,
      }),
    ).rejects.toThrow('其他批次');
  });
  it('prevalidates every piece before creating any documents', async () => {
    const body = {
      ...startBody(),
      items: [
        ...startBody().items,
        { itemId: id(2), requestId: id(22), expectedVersion: 2 },
      ],
    };
    await expect(service.start('editor', body)).rejects.toThrow('已更新');
    expect(db.mailroomPrecheckDocument.upsert).not.toHaveBeenCalled();
    expect(docs).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });
  it('checks current permission after item-lock waits', async () => {
    db.$queryRaw.mockImplementation(async () => {
      actor = { ...actor, permissions: new Set(['mailroom:read']) };
      return [];
    });
    await expect(service.start('editor', startBody())).rejects.toThrow('權限');
    expect(docs).toHaveLength(0);
  });
  it('does not allow read-only users, foreign companies or nonemployees to write', async () => {
    employee = false;
    await expect(service.start('editor', startBody())).rejects.toThrow('在職');
    employee = true;
    await expect(
      service.start('editor', { ...startBody(), entityId: 'other' }),
    ).rejects.toThrow('公司');
    actor.permissions = new Set(['mailroom:read']);
    await expect(service.start('editor', startBody())).rejects.toThrow('權限');
  });
  it('does not permit UNMATCHED or already-signed technician items to start', async () => {
    items[0].receipt.category = 'UNMATCHED';
    await expect(service.start('editor', startBody())).rejects.toThrow(
      '找不到',
    );
    items[0] = makeItem(1);
    items[0].status = 'REPAIR_RECEIVED';
    items[0].repairOwnerId = 'technician';
    items[0].custodianId = 'technician';
    await expect(service.start('editor', startBody())).rejects.toThrow(
      '目前進度',
    );
  });
  it('saves an explicit table selection, then READY, without changing the physical version or evidence', async () => {
    await service.start('editor', startBody());
    const first = await service.read('editor', 'company-a', id(1));
    const t = first.availableTemplates[0],
      templateBinding = {
        id: t.id,
        revision: t.revision,
        contentHash: t.contentHash,
      };
    const selected = await service.save(
      'editor',
      id(1),
      saveBody(1, 30, { templateBinding }),
    );
    expect(selected.document?.revision).toBe(2);
    const readyBody = saveBody(2, 31, {
      templateBinding,
      status: 'READY',
      checks: [
        {
          key: 'basic_function',
          result: 'ABNORMAL',
          note: '輸出異常',
          evidenceIndexes: [0],
        },
      ],
      evidence: [png],
    });
    const ready = await service.save('editor', id(1), readyBody);
    expect(ready.document?.status).toBe('READY');
    expect(ready.document?.savedById).toBe('editor');
    expect(items[0]).toEqual(makeItem(1));
    expect(await service.save('editor', id(1), readyBody)).toEqual({
      ...JSON.parse(JSON.stringify(ready)),
      duplicate: true,
    });
    expect(docs[0].revision).toBe(3);
  });
  it('rejects stale document revision, changed save retry and skipping a selected required form', async () => {
    await service.start('editor', startBody());
    const t = (await service.read('editor', 'company-a', id(1)))
      .availableTemplates[0];
    const templateBinding = {
      id: t.id,
      revision: t.revision,
      contentHash: t.contentHash,
    };
    await service.save('editor', id(1), saveBody(1, 30, { templateBinding }));
    await expect(
      service.save('editor', id(1), saveBody(1, 31, { templateBinding })),
    ).rejects.toThrow('版本');
    await expect(
      service.save(
        'editor',
        id(1),
        saveBody(1, 30, { templateBinding, status: 'READY' }),
      ),
    ).rejects.toThrow('內容不同');
    await expect(
      service.save(
        'editor',
        id(1),
        saveBody(2, 32, { templateBinding: null, notRequiredReason: '略過' }),
      ),
    ).rejects.toThrow('不能');
  });
  it('requires clear DRAFT data when changing to a different preset', async () => {
    await service.start('editor', startBody());
    const value = await service.read('editor', 'company-a', id(1));
    const t = value.availableTemplates[1],
      templateBinding = {
        id: t.id,
        revision: t.revision,
        contentHash: t.contentHash,
      };
    await expect(
      service.save(
        'editor',
        id(1),
        saveBody(1, 30, {
          templateBinding,
          checks: [{ key: 'builtin_type_c', result: 'NORMAL' }],
        }),
      ),
    ).rejects.toThrow('清空');
    const changed = await service.save(
      'editor',
      id(1),
      saveBody(1, 31, { templateBinding }),
    );
    expect(changed.selectedTemplate?.checks).toHaveLength(5);
    expect(changed.document?.checks).toEqual([]);
  });
  it('invalidates a draft on actual identity change but not a storage move', async () => {
    await service.start('editor', startBody());
    items[0].location = 'A3-1';
    items[0].version = 2;
    expect((await service.read('editor', 'company-a', id(1))).stage).toBe(
      'DRAFT',
    );
    items[0].serialNumber = 'DIFFERENT';
    expect((await service.read('editor', 'company-a', id(1))).stage).toBe(
      'STALE',
    );
    await expect(
      service.save('editor', id(1), { ...saveBody(1), expectedVersion: 2 }),
    ).rejects.toThrow('身份');
    const restarted = await service.start('editor', {
      ...startBody(1, 40),
      items: [{ itemId: id(1), requestId: id(41), expectedVersion: 2 }],
    });
    expect(restarted.items[0].document?.revision).toBe(2);
    expect(restarted.items[0].document?.checks).toEqual([]);
  });
  it('rechecks revoked permission on an otherwise identical save retry', async () => {
    await service.start('editor', startBody());
    await service.save('editor', id(1), saveBody(1));
    actor.permissions = new Set(['mailroom:read']);
    await expect(service.save('editor', id(1), saveBody(1))).rejects.toThrow(
      '權限',
    );
  });
  it('returns readonly capabilities and company-scoped native photo bytes', async () => {
    actor.permissions = new Set(['mailroom:read']);
    const value = await service.read('editor', 'company-a', id(1));
    expect(value.capabilities.canStart).toBe(false);
    expect(value.evidenceThumbnailUrl).toContain('/mailroom/prechecks/items/');
    expect((await service.photo('editor', 'company-a', id(1))).type).toBe(
      'image/png',
    );
    await expect(service.photo('editor', 'other', id(1))).rejects.toThrow(
      '找不到',
    );
  });
  it('does not extend a technician read grant to an unassigned RETURN item', async () => {
    actor.permissions = new Set(['repair_workbench:read']);
    await expect(service.read('editor', 'company-a', id(2))).rejects.toThrow(
      '讀取權限',
    );
    await expect(service.photo('editor', 'company-a', id(2))).rejects.toThrow(
      '存取權限',
    );
    expect(
      (await service.read('editor', 'company-a', id(1))).capabilities.canSave,
    ).toBe(false);
  });
  it('uses the same native permission reader for general photos, without granting general prechecks', async () => {
    items[1].receipt.category = 'LETTER';
    expect((await service.photo('editor', 'company-a', id(2))).type).toBe(
      'image/png',
    );
    await expect(service.read('editor', 'company-a', id(2))).rejects.toThrow(
      '售後實物',
    );
    actor.permissions = new Set(['repair_workbench:read']);
    await expect(service.photo('editor', 'company-a', id(2))).rejects.toThrow(
      '存取權限',
    );
    items[1].recipientId = actor.id;
    expect((await service.photo('editor', 'company-a', id(2))).type).toBe(
      'image/png',
    );
  });
  it('never returns a raw draft document to a technician-only reader', async () => {
    await service.start('editor', startBody());
    await service.save(
      'editor',
      id(1),
      saveBody(1, 30, { evidence: [png], notRequiredReason: 'PRIVATE DRAFT' }),
    );
    actor.permissions = new Set(['repair_workbench:read']);
    const read = await service.read('editor', 'company-a', id(1));
    expect(read.document).toBeNull();
    expect(read.stage).toBe('DRAFT');
    expect(JSON.stringify(read)).not.toContain('PRIVATE DRAFT');
  });
  it.each(['START', 'SAVE'])(
    'rechecks current native read permission before %s ledger replay even when update remains',
    async (operation) => {
      const started = await service.start('editor', startBody());
      const saved = await service.save('editor', id(1), saveBody(1));
      const replay = () =>
        operation === 'START'
          ? service.start('editor', startBody())
          : service.save('editor', id(1), saveBody(1));
      Object.assign(items[0], {
        status: 'INSPECTING',
        version: 15,
        custodianId: 'tech',
        repairOwnerId: 'tech',
      });
      // Valid current readers may still replay the original immutable success.
      expect((await replay()).duplicate).toBe(true);
      actor.permissions = new Set(['mailroom:update']);
      await expect(replay()).rejects.toThrow('讀取權限');
      expect(docs).toHaveLength(1);
      expect(requests).toHaveLength(2);
      actor.permissions = new Set(['mailroom:read', 'mailroom:update']);
      items[0].receipt.entityId = 'foreign';
      // A malformed cross-company parent must not become readable through a ledger.
      await expect(replay()).rejects.toThrow('找不到');
      expect(started.items[0].itemVersion).toBe(1);
      expect(saved.itemVersion).toBe(1);
    },
  );
  it('refuses a mismatched receipt company before any draft or request write', async () => {
    items[0].receipt.entityId = 'foreign';
    await expect(service.start('editor', startBody())).rejects.toThrow(
      '找不到',
    );
    expect(docs).toHaveLength(0);
    expect(requests).toHaveLength(0);
    expect(batches).toHaveLength(0);
    expect(db.mailroomPrecheckDocument.upsert).not.toHaveBeenCalled();
  });
});
