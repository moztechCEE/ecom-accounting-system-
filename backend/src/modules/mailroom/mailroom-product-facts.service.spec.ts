/* Synthetic transaction adapters only; no real database, notification, or score is used. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException } from '@nestjs/common';
import {
  persistProductMismatchFact,
  voidProductMismatchFactsForIdentity,
} from './mailroom-product-facts.service';
import { productIdentityHash } from './mailroom-product-decision.contract';

const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECEIPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_ITEM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function fixture() {
  const item: any = {
    id: ITEM_ID,
    receiptId: RECEIPT_ID,
    entityId: 'company',
    productId: 'product-1',
    productName: '實收品項',
    sku: 'ACTUAL-SKU',
    serialNumber: 'ACTUAL-SN',
    declared: {
      id: 'source-line',
      name: '申報品項',
      sku: 'DECLARED-SKU',
      serialNumber: null,
      quantity: 1,
    },
    evidence: ['mock://photo/one'],
    status: 'MISMATCH',
    version: 7,
    custodianId: 'clerk',
    receipt: {
      id: RECEIPT_ID,
      entityId: 'company',
      sourceCaseId: 'source-case',
      category: 'REPAIR',
    },
  };
  const proof: any = {
    proofId: 'proof-1',
    purpose: 'PRODUCT',
    status: 'APPROVED',
    itemId: ITEM_ID,
    planVersion: 4,
    planHash: productIdentityHash(item),
    actualIdentityHash: productIdentityHash(item),
    customerDecision: 'ACCEPT_ACTUAL',
    verifiedCustomerId: 'a'.repeat(64),
    provider: 'LINE',
    reviewedById: 'source-reviewer',
    submittedAt: '2026-10-13T00:00:00.000Z',
    reviewedAt: '2026-10-13T00:01:00.000Z',
  };
  const source: any = {
    id: 'source-case',
    type: 'REPAIR',
    version: '2026-10-13T00:02:00.000Z',
    caseBrand: 'MOZTECH',
    firstReviewErpActorId: 'original-reviewer',
    assigneeId: 'current-assignee',
    customerProductConfirmations: [proof],
  };
  const facts: any[] = [],
    events: string[] = [];
  const matches = (row: any, where: any): boolean =>
    Object.entries(where).every(([key, value]: [string, any]) =>
      value && typeof value === 'object' && 'not' in value
        ? row[key] !== value.not
        : row[key] === value,
    );
  const tx: any = {
    $queryRaw: jest.fn(async () => {
      events.push('lock');
      return [{ id: item.id }];
    }),
    mailroomProductMismatchFact: {
      findUnique: jest.fn(async ({ where }: any) => {
        events.push('lookup');
        return (
          facts.find((row) =>
            matches(row, where.entityId_itemId_identityHash),
          ) || null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        events.push('create');
        if (
          facts.some(
            (row) =>
              row.entityId === data.entityId &&
              row.itemId === data.itemId &&
              row.identityHash === data.identityHash,
          )
        )
          throw new Error('synthetic unique constraint');
        const row = {
          id: 'fact-' + facts.length,
          ...structuredClone(data),
          createdAt: new Date(),
          updatedAt: new Date(),
          voidedAt: null,
          voidReason: null,
        };
        facts.push(row);
        return row;
      }),
      count: jest.fn(
        async ({ where }: any) =>
          facts.filter((row) => matches(row, where)).length,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const matched = facts.filter((row) => matches(row, where));
        matched.forEach((row) => Object.assign(row, structuredClone(data)));
        return { count: matched.length };
      }),
      update: jest.fn(),
    },
    performanceRating: { create: jest.fn(), update: jest.fn() },
    inventoryTransaction: { create: jest.fn() },
    notification: { create: jest.fn() },
    mailroomDelivery: { createMany: jest.fn() },
    mailroomItem: { update: jest.fn() },
  };
  const persist = (actor = 'server-csr') =>
    persistProductMismatchFact(tx, item, source, proof, actor);
  return { item, source, proof, facts, events, tx, persist };
}

describe('immutable product mismatch evidence facts', () => {
  it('persists one ACTIVE cause and the original proof, with scoped item lock before lookup', async () => {
    const f = fixture();
    await f.persist();
    expect(f.events).toEqual(['lock', 'lookup', 'create']);
    expect(f.facts[0]).toMatchObject({
      entityId: 'company',
      itemId: ITEM_ID,
      receiptId: RECEIPT_ID,
      sourceCaseId: 'source-case',
      identityHash: productIdentityHash(f.item),
      proofId: 'proof-1',
      sourceVersion: f.source.version,
      caseBrand: 'MOZTECH',
      firstReviewErpActorId: 'original-reviewer',
      reviewedByErpActorId: 'server-csr',
      status: 'ACTIVE',
      proofSnapshot: f.proof,
    });
    const [parts, ...parameters] = f.tx.$queryRaw.mock.calls[0];
    expect(parts.join('?')).toContain('FOR UPDATE');
    expect(parameters).toEqual([ITEM_ID, 'company']);
    expect(f.tx.performanceRating.create).not.toHaveBeenCalled();
    expect(f.tx.performanceRating.update).not.toHaveBeenCalled();
    expect(f.tx.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(f.tx.notification.create).not.toHaveBeenCalled();
    expect(f.tx.mailroomDelivery.createMany).not.toHaveBeenCalled();
    expect(f.tx.mailroomItem.update).not.toHaveBeenCalled();
  });

  it.each([undefined, null])(
    'unmapped legacy first reviewer %s stays null, never the assignee or CSR',
    async (firstReview) => {
      const f = fixture();
      f.source.firstReviewErpActorId = firstReview;
      await f.persist();
      expect(f.facts[0].firstReviewErpActorId).toBeNull();
      expect(f.facts[0].reviewedByErpActorId).toBe('server-csr');
    },
  );

  it('a repeated cause creates no second fact or update and keeps the original snapshot', async () => {
    const f = fixture();
    await f.persist();
    const original = structuredClone(f.facts[0]);
    await f.persist();
    expect(f.facts).toHaveLength(1);
    expect(f.facts[0]).toEqual(original);
    expect(f.tx.mailroomProductMismatchFact.create).toHaveBeenCalledTimes(1);
    expect(f.tx.mailroomProductMismatchFact.updateMany).not.toHaveBeenCalled();
    expect(f.tx.mailroomProductMismatchFact.update).not.toHaveBeenCalled();
    expect(f.tx.performanceRating.create).not.toHaveBeenCalled();
  });

  it.each(['ACTIVE', 'VOID'])(
    'a fresh approval of the same %s cause neither replaces evidence nor resurrects it',
    async (status) => {
      const f = fixture();
      await f.persist();
      f.facts[0].status = status;
      if (status === 'VOID')
        Object.assign(f.facts[0], {
          voidedAt: new Date('2026-10-13T00:03:00.000Z'),
          voidReason: 'PRODUCT_IDENTITY_CHANGED',
        });
      const original = structuredClone(f.facts[0]);
      f.proof.proofId = 'fresh-proof';
      f.proof.planVersion = 100;
      f.proof.reviewedById = 'another-source-reviewer';
      f.source.version = '2026-10-13T00:04:00.000Z';
      f.source.firstReviewErpActorId = 'fresh-but-not-original-mapping';
      await f.persist('another-server-csr');
      expect(f.facts[0]).toEqual(original);
      expect(f.tx.mailroomProductMismatchFact.create).toHaveBeenCalledTimes(1);
      expect(
        f.tx.mailroomProductMismatchFact.updateMany,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    'entityId',
    'itemId',
    'receiptId',
    'sourceCaseId',
    'identityHash',
    'caseBrand',
  ])('refuses corrupted prior cause %s', async (field) => {
    const f = fixture();
    await f.persist();
    f.tx.mailroomProductMismatchFact.findUnique.mockResolvedValue({
      ...f.facts[0],
      [field]: 'DIFFERENT',
    });
    await expect(f.persist()).rejects.toThrow('不可變來源');
    expect(f.tx.mailroomProductMismatchFact.create).toHaveBeenCalledTimes(1);
    expect(f.tx.mailroomProductMismatchFact.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'missing server CSR',
      (f: any) => {
        f.persist = () =>
          persistProductMismatchFact(f.tx, f.item, f.source, f.proof, '');
      },
    ],
    [
      'unsafe server CSR',
      (f: any) => {
        f.persist = () =>
          persistProductMismatchFact(
            f.tx,
            f.item,
            f.source,
            f.proof,
            '../actor',
          );
      },
    ],
    [
      'unsafe original reviewer',
      (f: any) => {
        f.source.firstReviewErpActorId = '../actor';
      },
    ],
    [
      'missing true brand',
      (f: any) => {
        delete f.source.caseBrand;
        f.source.brand = 'MOZTECH';
      },
    ],
    [
      'foreign case',
      (f: any) => {
        f.source.id = 'other-source';
      },
    ],
    [
      'foreign receipt company',
      (f: any) => {
        f.item.receipt.entityId = 'other-company';
      },
    ],
    [
      'unapproved proof',
      (f: any) => {
        f.proof.status = 'PENDING';
      },
    ],
    [
      'different actual hash',
      (f: any) => {
        f.proof.actualIdentityHash = 'b'.repeat(64);
      },
    ],
    [
      'unhashed subject',
      (f: any) => {
        f.proof.verifiedCustomerId = 'raw-customer';
      },
    ],
    [
      'invalid Source version',
      (f: any) => {
        f.source.version = 'not-a-version';
      },
    ],
    [
      'review before submit',
      (f: any) => {
        f.proof.reviewedAt = '2026-10-12T00:00:00.000Z';
      },
    ],
  ])('fails closed for %s before fact writes', async (_name, change) => {
    const f = fixture();
    change(f);
    await expect(f.persist()).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.mailroomProductMismatchFact.create).not.toHaveBeenCalled();
    expect(f.tx.mailroomProductMismatchFact.updateMany).not.toHaveBeenCalled();
  });

  it('clones the wire proof and never adds private Source or current assignee fields', async () => {
    const f = fixture();
    f.proof.privateMetadata = 'not-in-wire';
    await f.persist();
    f.proof.customerDecision = 'REJECT_ACTUAL';
    expect(f.facts[0].proofSnapshot.customerDecision).toBe('ACCEPT_ACTUAL');
    expect(f.facts[0].proofSnapshot).not.toHaveProperty('privateMetadata');
    expect(f.facts[0]).not.toHaveProperty('assigneeId');
  });

  it('two callers serialized by an outer mocked item lock retain one cause', async () => {
    const f = fixture();
    let held = false;
    const waiters: Array<() => void> = [];
    const run = async () => {
      let ownsLock = false;
      const tx = {
        ...f.tx,
        $queryRaw: async (
          parts: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          if (held) await new Promise<void>((resolve) => waiters.push(resolve));
          else held = true;
          ownsLock = true;
          return f.tx.$queryRaw(parts, ...values);
        },
      };
      try {
        await persistProductMismatchFact(
          tx,
          f.item,
          f.source,
          f.proof,
          'server-csr',
        );
      } finally {
        if (ownsLock) {
          const next = waiters.shift();
          if (next) next();
          else held = false;
        }
      }
    };
    await Promise.all([run(), run()]);
    expect(f.facts).toHaveLength(1);
    expect(f.tx.mailroomProductMismatchFact.create).toHaveBeenCalledTimes(1);
  });
});

describe('physical identity change voids only old active evidence', () => {
  it('movement, claim, status, and version changes do not void or write', async () => {
    const f = fixture();
    await f.persist();
    const candidate = {
      ...f.item,
      status: 'REPAIR_RECEIVED',
      version: 20,
      custodianId: 'tech',
      repairOwnerId: 'tech',
    };
    f.tx.$queryRaw.mockClear();
    expect(
      await voidProductMismatchFactsForIdentity(f.tx, f.item, candidate),
    ).toBe(false);
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.mailroomProductMismatchFact.updateMany).not.toHaveBeenCalled();
    expect(f.facts[0].status).toBe('ACTIVE');
  });

  it.each([
    [
      'product',
      (candidate: any) => {
        candidate.productId = 'other-product';
      },
    ],
    [
      'name',
      (candidate: any) => {
        candidate.productName = '修正實收品項';
      },
    ],
    [
      'SKU',
      (candidate: any) => {
        candidate.sku = 'OTHER-SKU';
      },
    ],
    [
      'SN',
      (candidate: any) => {
        candidate.serialNumber = 'OTHER-SN';
      },
    ],
    [
      'declared item',
      (candidate: any) => {
        candidate.declared.id = 'new-source-line';
      },
    ],
    [
      'declared quantity',
      (candidate: any) => {
        candidate.declared.quantity = 2;
      },
    ],
    [
      'same-count photos',
      (candidate: any) => {
        candidate.evidence[0] = 'mock://photo/changed';
      },
    ],
  ])(
    '%s change marks old ACTIVE fact VOID while retaining original proof',
    async (_name, change) => {
      const f = fixture();
      await f.persist();
      const originalProof = structuredClone(f.facts[0].proofSnapshot);
      const candidate = structuredClone(f.item);
      change(candidate);
      expect(
        await voidProductMismatchFactsForIdentity(f.tx, f.item, candidate),
      ).toBe(true);
      expect(f.facts[0]).toMatchObject({
        status: 'VOID',
        voidReason: 'PRODUCT_IDENTITY_CHANGED',
        proofSnapshot: originalProof,
      });
      const voidWrite =
        f.tx.mailroomProductMismatchFact.updateMany.mock.calls[0][0].data;
      expect(voidWrite.voidedAt).toBeInstanceOf(Date);
      expect(Number.isFinite(f.facts[0].voidedAt.getTime())).toBe(true);
      expect(f.facts[0].voidedAt.getTime()).toBe(voidWrite.voidedAt.getTime());
      expect(
        f.tx.mailroomProductMismatchFact.updateMany.mock.calls[0][0].data,
      ).not.toHaveProperty('proofSnapshot');
      expect(f.tx.performanceRating.update).not.toHaveBeenCalled();
    },
  );

  it('scopes voiding to this company and piece and keeps candidate identity or already VOID facts', async () => {
    const f = fixture();
    await f.persist();
    const old = structuredClone(f.facts[0]);
    const candidate = { ...f.item, serialNumber: 'NEW-SN' };
    f.facts.push(
      { ...old, id: 'foreign-company', entityId: 'other-company' },
      { ...old, id: 'foreign-item', itemId: OTHER_ITEM_ID },
      { ...old, id: 'void-history', status: 'VOID', voidReason: 'historical' },
      {
        ...old,
        id: 'candidate-cause',
        identityHash: productIdentityHash(candidate),
      },
    );
    await voidProductMismatchFactsForIdentity(f.tx, f.item, candidate);
    expect(f.facts[0].status).toBe('VOID');
    expect(f.facts[1].status).toBe('ACTIVE');
    expect(f.facts[2].status).toBe('ACTIVE');
    expect(f.facts[3].voidReason).toBe('historical');
    expect(f.facts[4].status).toBe('ACTIVE');
  });

  it('a known hash change without old ACTIVE evidence reports true but writes no fact', async () => {
    const f = fixture();
    expect(
      await voidProductMismatchFactsForIdentity(f.tx, f.item, {
        ...f.item,
        serialNumber: 'NEW-SN',
      }),
    ).toBe(true);
    expect(f.tx.mailroomProductMismatchFact.updateMany).not.toHaveBeenCalled();
    expect(f.tx.mailroomProductMismatchFact.create).not.toHaveBeenCalled();
  });

  it('legacy unpaired identity without an ACTIVE fact can continue CSR pairing without a guessed cause', async () => {
    const f = fixture();
    const candidate = structuredClone(f.item);
    f.item.declared = null;
    f.item.receipt.sourceCaseId = null;
    expect(
      await voidProductMismatchFactsForIdentity(f.tx, f.item, candidate),
    ).toBe(false);
    expect(f.tx.mailroomProductMismatchFact.create).not.toHaveBeenCalled();
    expect(f.tx.mailroomProductMismatchFact.updateMany).not.toHaveBeenCalled();
  });

  it('missing identity data with an ACTIVE fact fails closed and preserves proof', async () => {
    const f = fixture();
    await f.persist();
    const before = structuredClone(f.facts[0]);
    const candidate = structuredClone(f.item);
    candidate.declared = null;
    await expect(
      voidProductMismatchFactsForIdentity(f.tx, f.item, candidate),
    ).rejects.toThrow('不能猜測');
    expect(f.facts[0]).toEqual(before);
    expect(f.tx.mailroomProductMismatchFact.updateMany).not.toHaveBeenCalled();
  });

  it.each(['id', 'entityId', 'receiptId'])(
    'cannot void another %s scope',
    async (field) => {
      const f = fixture();
      await f.persist();
      await expect(
        voidProductMismatchFactsForIdentity(f.tx, f.item, {
          ...f.item,
          [field]: 'OTHER',
        }),
      ).rejects.toThrow('其他公司或其他實物');
      expect(
        f.tx.mailroomProductMismatchFact.updateMany,
      ).not.toHaveBeenCalled();
    },
  );

  it('a missing scoped physical row cannot create or void a cause', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValue([]);
    await expect(f.persist()).rejects.toThrow('實物已變動');
    await expect(
      voidProductMismatchFactsForIdentity(f.tx, f.item, {
        ...f.item,
        serialNumber: 'NEW-SN',
      }),
    ).rejects.toThrow('實物已變動');
    expect(f.tx.mailroomProductMismatchFact.create).not.toHaveBeenCalled();
    expect(f.tx.mailroomProductMismatchFact.updateMany).not.toHaveBeenCalled();
  });
});
