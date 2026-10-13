import { Prisma } from '@prisma/client';
import { type Actor } from './mailroom.contract';
import {
  EVIDENCE_COMPANY,
  EVIDENCE_TIME,
  repairEvidenceFixture,
} from './repair-evidence.test.fixture';

describe('repair media service with mocked transactional rollback and storage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(EVIDENCE_TIME));
  });
  afterEach(() => jest.useRealTimers());

  it('rejects void advisory results through queryRaw and keeps the bound lock on executeRaw', async () => {
    const f = repairEvidenceFixture(),
      input = f.upload();
    let caught: unknown;
    try {
      void f.tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${EVIDENCE_COMPANY + ':repair-evidence:tech:' + input.requestId}))`,
      );
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof Prisma.PrismaClientKnownRequestError))
      throw new Error('Expected the actual Prisma void-result error');
    expect(caught.code).toBe('P2010');
    await f.media.upload('tech', f.item.id, input);
    expect(f.tx.$executeRaw.mock.calls).toHaveLength(1);
    expect(f.tx.$executeRaw.mock.calls[0][0].values).toEqual([
      EVIDENCE_COMPANY + ':repair-evidence:tech:' + input.requestId,
    ]);
    expect(f.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.repairMediaAsset.create.mock.invocationCallOrder[0],
    );
  });
  it('creates one pending asset for the next document revision, with server identity and no finalized claim', async () => {
    const f = repairEvidenceFixture(),
      input = f.upload();
    const result = await f.media.upload('tech', f.item.id, input);
    expect(result).toMatchObject({
      status: 'PENDING',
      kind: 'inspection',
      documentRevision: 4,
      phase: 'BEFORE',
      sha256: null,
      sizeBytes: null,
    });
    expect(f.assets[1]).toMatchObject({
      entityId: EVIDENCE_COMPANY,
      itemId: f.item.id,
      uploadedById: 'tech',
      status: 'PENDING',
      bindings: [],
    });
    expect(f.storage.mint).toHaveBeenCalledWith(
      'synthetic-private-bucket',
      expect.stringContaining(`repair-media/${EVIDENCE_COMPANY}/${f.item.id}/`),
      'image/png',
    );
    expect(f.operations).toHaveLength(1);
    expect(JSON.stringify(f.operations)).not.toContain('SYNTHETIC-SESSION');
    expect(f.item.version).toBe(7);
  });
  it('replays the same pending upload without a second asset, but rejects changed request content or action', async () => {
    const f = repairEvidenceFixture(),
      input = f.upload();
    const first = await f.media.upload('tech', f.item.id, input);
    expect((await f.media.upload('tech', f.item.id, input)).mediaId).toBe(
      first.mediaId,
    );
    expect(f.assets).toHaveLength(2);
    expect(f.operations).toHaveLength(1);
    await expect(
      f.media.upload('tech', f.item.id, { ...input, phase: 'AFTER' }),
    ).rejects.toThrow('識別碼');
    await expect(
      f.media.finalize(
        'tech',
        f.item.id,
        first.mediaId,
        f.command(input.requestId),
      ),
    ).rejects.toThrow('識別碼');
    expect(f.assets[1].status).toBe('PENDING');
  });
  it('rejects stale item versions before asset creation or storage mint', async () => {
    const f = repairEvidenceFixture();
    await expect(
      f.media.upload('tech', f.item.id, { ...f.upload(), expectedVersion: 6 }),
    ).rejects.toThrow('更新');
    expect(f.assets).toHaveLength(1);
    expect(f.storage.mint).not.toHaveBeenCalled();
  });
  it.each(['company', 'permission', 'owner', 'custodian', 'status'])(
    'rejects a current %s mismatch instead of creating media',
    async (reason) => {
      const f = repairEvidenceFixture();
      if (reason === 'company') f.companies.set('tech', ['foreign-company']);
      if (reason === 'permission')
        f.permissions.set('tech', new Set(['repair_workbench:read']));
      if (reason === 'owner') f.item.repairOwnerId = 'other-tech';
      if (reason === 'custodian') f.item.custodianId = 'other-tech';
      if (reason === 'status') f.item.status = 'WAITING_CUSTOMER';
      await expect(
        f.media.upload('tech', f.item.id, f.upload()),
      ).rejects.toThrow();
      expect(f.assets).toHaveLength(1);
      expect(f.operations).toHaveLength(0);
      expect(f.storage.mint).not.toHaveBeenCalled();
    },
  );
  it('rechecks actor permission after the mocked row locks and also on replay', async () => {
    const f = repairEvidenceFixture();
    let reads = 0;
    f.actor.mockImplementation(
      (id): Promise<Actor> =>
        Promise.resolve({
          id,
          name: id,
          entityIds: [EVIDENCE_COMPANY],
          permissions:
            ++reads === 1 ? new Set(['repair_workbench:update']) : new Set(),
        }),
    );
    await expect(f.media.upload('tech', f.item.id, f.upload())).rejects.toThrow(
      '權限',
    );
    expect(f.assets).toHaveLength(1);
    expect(f.operations).toHaveLength(0);
    const g = repairEvidenceFixture(),
      input = g.upload();
    await g.media.upload('tech', g.item.id, input);
    g.permissions.set('tech', new Set());
    await expect(g.media.upload('tech', g.item.id, input)).rejects.toThrow(
      '權限',
    );
    expect(g.assets).toHaveLength(2);
  });
  it('does not return a minted capability after custody or the document revision changes', async () => {
    for (const change of ['custody', 'document']) {
      const f = repairEvidenceFixture();
      f.storage.mint.mockImplementation(() => {
        if (change === 'custody') f.item.custodianId = 'other-tech';
        else f.item.repairInspection.revision += 1;
        return Promise.resolve(
          'https://storage.googleapis.com/upload/SYNTHETIC-SESSION',
        );
      });
      await expect(
        f.media.upload('tech', f.item.id, f.upload()),
      ).rejects.toThrow();
      // The earlier committed PENDING intent is retained; an external mint cannot be rolled back by this mock.
      expect(f.assets[1].status).toBe('PENDING');
      expect(f.assets[1].sha256).toBeNull();
    }
  });
  it('does not return a upload capability if the authorized media stage changes during mint', async () => {
    const f = repairEvidenceFixture();
    f.storage.mint.mockImplementation(() => {
      f.item.status = 'WAITING_CUSTOMER';
      return Promise.resolve(
        'https://storage.googleapis.com/upload/SYNTHETIC-SESSION',
      );
    });
    await expect(
      f.media.upload('tech', f.item.id, f.upload()),
    ).rejects.toThrow();
    expect(f.assets[1].status).toBe('PENDING');
  });
  it.each(['revoked', 'expired'])(
    'does not return a capability when the pending asset becomes %s during mint',
    async (change) => {
      const f = repairEvidenceFixture();
      f.storage.mint.mockImplementation(() => {
        if (change === 'revoked') f.assets[1].status = 'REVOKED';
        else f.assets[1].expiresAt = new Date(EVIDENCE_TIME);
        return Promise.resolve(
          'https://storage.googleapis.com/upload/SYNTHETIC-SESSION',
        );
      });
      await expect(
        f.media.upload('tech', f.item.id, f.upload()),
      ).rejects.toThrow();
      expect(f.assets[1].sha256).toBeNull();
    },
  );
  it('caps unexpired pending uploads without counting finalized or expired assets as new proof', async () => {
    const f = repairEvidenceFixture();
    for (let i = 0; i < 12; i++)
      f.addAsset(`pending-${i}`, {
        status: 'PENDING',
        bindings: [],
        sha256: null,
        generation: null,
        sizeBytes: null,
      });
    await expect(f.media.upload('tech', f.item.id, f.upload())).rejects.toThrow(
      '現有影像',
    );
    expect(f.storage.mint).not.toHaveBeenCalled();
  });
  it('rolls back asset writes if persisting the operation receipt fails in the mocked transaction', async () => {
    const f = repairEvidenceFixture();
    f.tx.repairEvidenceOperation.create.mockRejectedValueOnce(
      new Error('mock operation failure'),
    );
    await expect(f.media.upload('tech', f.item.id, f.upload())).rejects.toThrow(
      'mock operation failure',
    );
    expect(f.assets).toHaveLength(1);
    expect(f.operations).toHaveLength(0);
    expect(f.storage.mint).not.toHaveBeenCalled();
  });
  it('finalizes only server-verified bytes, preserves the string generation and streams that exact generation', async () => {
    const f = repairEvidenceFixture(),
      uploaded = await f.media.upload('tech', f.item.id, f.upload());
    const result = await f.media.finalize(
      'tech',
      f.item.id,
      uploaded.mediaId,
      f.command('synthetic-finalize-001'),
    );
    expect(result.asset).toMatchObject({
      status: 'FINALIZED',
      sha256: 'b'.repeat(64),
      sizeBytes: 1024,
    });
    expect(f.assets[1]).toMatchObject({
      generation: '123456789012345678',
      sizeBytes: 1024n,
      finalizedAt: new Date(EVIDENCE_TIME),
    });
    await f.media.privateFile(
      'tech',
      EVIDENCE_COMPANY,
      f.item.id,
      uploaded.mediaId,
    );
    expect(f.storage.stream).toHaveBeenLastCalledWith(
      'synthetic-private-bucket',
      f.assets[1].objectKey,
      '123456789012345678',
    );
    await f.media.finalize(
      'tech',
      f.item.id,
      uploaded.mediaId,
      f.command('synthetic-finalize-001'),
    );
    expect(f.storage.verify).toHaveBeenCalledTimes(1);
    expect(f.operations).toHaveLength(2);
  });
  it('a storage verification failure leaves the asset pending and produces no finalized receipt', async () => {
    const f = repairEvidenceFixture(),
      uploaded = await f.media.upload('tech', f.item.id, f.upload());
    f.storage.verify.mockRejectedValueOnce(new Error('mock invalid bytes'));
    await expect(
      f.media.finalize(
        'tech',
        f.item.id,
        uploaded.mediaId,
        f.command('synthetic-finalize-001'),
      ),
    ).rejects.toThrow('mock invalid bytes');
    expect(f.assets[1].status).toBe('PENDING');
    expect(f.assets[1].generation).toBeNull();
    expect(f.operations).toHaveLength(1);
  });
  it.each(['version', 'custody', 'permission'])(
    'rechecks current %s after storage verification before finalizing',
    async (change) => {
      const f = repairEvidenceFixture(),
        uploaded = await f.media.upload('tech', f.item.id, f.upload());
      f.storage.verify.mockImplementation(() => {
        if (change === 'version') f.item.version++;
        if (change === 'custody') f.item.custodianId = 'other-tech';
        if (change === 'permission') f.permissions.set('tech', new Set());
        return Promise.resolve({
          generation: '123456789012345678',
          sha256: 'b'.repeat(64),
          sizeBytes: 1024,
          contentType: 'image/png',
        });
      });
      await expect(
        f.media.finalize('tech', f.item.id, uploaded.mediaId, {
          ...f.command('synthetic-finalize-001'),
          expectedVersion: 7,
        }),
      ).rejects.toThrow();
      expect(f.assets[1].status).toBe('PENDING');
      expect(f.operations).toHaveLength(1);
    },
  );
  it.each(['expiry', 'document', 'uploader'])(
    'does not finalize an asset with a %s mismatch',
    async (change) => {
      const f = repairEvidenceFixture(),
        uploaded = await f.media.upload('tech', f.item.id, f.upload());
      if (change === 'expiry') f.assets[1].expiresAt = new Date(EVIDENCE_TIME);
      if (change === 'document') f.item.repairInspection.revision++;
      if (change === 'uploader') f.assets[1].uploadedById = 'other-tech';
      await expect(
        f.media.finalize(
          'tech',
          f.item.id,
          uploaded.mediaId,
          f.command('synthetic-finalize-001'),
        ),
      ).rejects.toThrow();
      expect(f.assets[1].status).toBe('PENDING');
    },
  );
  it('binds immutable finalized assets to a saved revision and avoids duplicate bindings on retry', async () => {
    const f = repairEvidenceFixture(),
      refs = [
        {
          mediaId: 'inspection-media',
          phase: 'DIAGNOSTIC' as const,
          checkKey: 'power',
        },
      ];
    const first = await f.media.attach(
      f.transactionClient,
      f.nativeItem(),
      'inspection',
      4,
      refs,
    );
    expect(first[0]).toMatchObject({
      entityId: EVIDENCE_COMPANY,
      itemId: f.item.id,
      documentRevision: 4,
      status: 'FINALIZED',
      sha256: 'b'.repeat(64),
    });
    await f.media.attach(
      f.transactionClient,
      f.nativeItem(),
      'inspection',
      4,
      refs,
    );
    expect(f.assets[0].bindings).toHaveLength(2);
    expect(f.assets[0].generation).toBe('123456789012345678');
  });
  it.each([
    'foreign-item',
    'foreign-company',
    'pending',
    'kind',
    'future-document',
    'phase',
    'check-key',
  ])('refuses a %s asset binding', async (change) => {
    const f = repairEvidenceFixture(),
      ref = {
        mediaId: 'inspection-media',
        phase: 'DIAGNOSTIC' as const,
        checkKey: 'power',
      };
    if (change === 'foreign-item') f.assets[0].itemId = 'foreign';
    if (change === 'foreign-company') f.assets[0].entityId = 'foreign';
    if (change === 'pending') f.assets[0].status = 'PENDING';
    if (change === 'kind') f.assets[0].kind = 'repair';
    if (change === 'future-document') f.assets[0].documentRevision = 5;
    if (change === 'phase') f.assets[0].phase = 'BEFORE';
    if (change === 'check-key') f.assets[0].checkKey = 'different';
    await expect(
      f.media.attach(f.transactionClient, f.nativeItem(), 'inspection', 4, [
        ref,
      ]),
    ).rejects.toThrow('影像');
    expect(f.assets[0].bindings).toHaveLength(1);
  });
  it('rolls back an earlier valid binding when another ref fails inside the caller transaction', async () => {
    const f = repairEvidenceFixture();
    await expect(
      f.prisma.$transaction(() =>
        f.media.attach(f.transactionClient, f.nativeItem(), 'inspection', 4, [
          {
            mediaId: 'inspection-media',
            phase: 'DIAGNOSTIC',
            checkKey: 'power',
          },
          { mediaId: 'foreign', phase: 'AFTER' },
        ]),
      ),
    ).rejects.toThrow('影像');
    expect(f.assets[0].bindings).toHaveLength(1);
  });
  it('revoke is idempotent and prevents reads or rebinding of the media', async () => {
    const f = repairEvidenceFixture(),
      input = f.command('synthetic-revoke-001');
    await f.media.revoke('tech', f.item.id, 'inspection-media', input);
    await f.media.revoke('tech', f.item.id, 'inspection-media', input);
    expect(f.assets[0].status).toBe('REVOKED');
    expect(f.operations).toHaveLength(1);
    await expect(
      f.media.privateFile(
        'tech',
        EVIDENCE_COMPANY,
        f.item.id,
        'inspection-media',
      ),
    ).rejects.toThrow();
    await expect(
      f.media.attach(f.transactionClient, f.nativeItem(), 'inspection', 4, [
        { mediaId: 'inspection-media', phase: 'DIAGNOSTIC', checkKey: 'power' },
      ]),
    ).rejects.toThrow();
    expect(f.storage.stream).not.toHaveBeenCalled();
  });
  it('returns staff descriptors without bucket/object/session locations and rechecks read scope', async () => {
    const f = repairEvidenceFixture();
    const listed = await f.media.list('tech', EVIDENCE_COMPANY, f.item.id);
    expect(listed.items).toHaveLength(1);
    for (const key of ['bucket', 'objectKey', 'generation', 'uploadUrl'])
      expect(listed.items[0]).not.toHaveProperty(key);
    await expect(
      f.media.privateFile(
        'tech',
        'foreign-company',
        f.item.id,
        'inspection-media',
      ),
    ).rejects.toThrow();
    f.permissions.set('tech', new Set());
    await expect(
      f.media.privateFile(
        'tech',
        EVIDENCE_COMPANY,
        f.item.id,
        'inspection-media',
      ),
    ).rejects.toThrow('權限');
  });
});
