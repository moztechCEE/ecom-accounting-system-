import { createHash } from 'node:crypto';
import { type Actor } from './mailroom.contract';
import {
  EVIDENCE_COMPANY,
  EVIDENCE_TIME,
  repairEvidenceFixture,
} from './repair-evidence.test.fixture';

const tokenFrom = (shareLink: string) =>
  new URLSearchParams(new URL(shareLink).hash.slice(1)).get('token')!;
const protectedEnv = [
  'REPAIR_REPORT_LINK_SECRET',
  'REPAIR_REPORT_PUBLIC_ORIGIN',
  'REPAIR_PUBLIC_REPORT_ENABLED',
] as const;
describe('customer repair report service with future agreed Source wire and mocked transaction only', () => {
  const before = Object.fromEntries(
    protectedEnv.map((key) => [key, process.env[key]]),
  );
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(EVIDENCE_TIME));
    process.env.REPAIR_REPORT_LINK_SECRET =
      'SYNTHETIC_REPORT_SECRET_32_CHARACTERS_ONLY';
    process.env.REPAIR_REPORT_PUBLIC_ORIGIN =
      'https://synthetic-report.invalid';
    process.env.REPAIR_PUBLIC_REPORT_ENABLED = 'true';
  });
  afterEach(() => {
    jest.useRealTimers();
    for (const key of protectedEnv) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
  it('publishes a CSR-reviewed immutable allowlist report with a token fragment, not internal notes or storage identifiers', async () => {
    const f = repairEvidenceFixture();
    const result = await f.report.publish('csr', f.item.id, f.publish());
    expect(f.tx.$executeRaw.mock.calls[0][0].values).toEqual([
      EVIDENCE_COMPANY + ':repair-evidence:csr:' + f.publish().requestId,
    ]);
    expect(f.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.repairCustomerReport.create.mock.invocationCallOrder[0],
    );
    expect(result.duplicate).toBe(false);
    expect(new URL(result.shareLink).search).toBe('');
    const token = tokenFrom(result.shareLink);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.reports[0].tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(JSON.stringify([f.reports, f.operations])).not.toContain(token);
    const view = await f.report.publicView(result.reportId, token);
    expect(view).toEqual({
      reportId: result.reportId,
      productName: 'SYNTHETIC actual product',
      caseNumber: 'SYNTHETIC-CASE',
      findings: '合成故障說明',
      handling: '合成處理說明',
      verification: '合成檢測說明',
      media: [{ mediaId: 'inspection-media', contentType: 'image/png' }],
    });
    for (const field of [
      'estimateAmount',
      'feeSuggestion',
      'customerIdentity',
      'sku',
      'serialNumber',
      'bucket',
      'objectKey',
      'uploadedById',
    ])
      expect(view).not.toHaveProperty(field);
    expect(f.item.repairInspection.data.customerReportDraft?.findings).toBe(
      ' 合成故障說明 ',
    );
    expect(f.reports[0].sourceBrand).toBe('MOZTECH');
  });
  it.each(['pending', 'declined'])(
    'allows an inspection explanation while customer consent is %s, without claiming paid repair approval',
    async (state) => {
      const f = repairEvidenceFixture();
      f.refresh(
        state === 'declined' ? 'DECLINE' : 'APPROVE',
        state === 'pending' ? 'ACCEPTED' : 'RESOLVED',
      );
      Object.assign(f.source.releaseInfo, {
        customerApprovedQuoteRevision: null,
        customerApprovedAt: null,
        confirmedPaymentQuoteRevision: null,
        invoiceStatus: 'MISSING',
        invoiceSatisfied: false,
      });
      f.source.repairAllowed = false;
      const result = await f.report.publish('csr', f.item.id, f.publish());
      expect(
        await f.report.publicView(result.reportId, tokenFrom(result.shareLink)),
      ).toMatchObject({ findings: '合成故障說明' });
      expect(f.item.status).toBe('INSPECTING');
      expect(f.item.repairWorkflow.release).toBeUndefined();
    },
  );
  it('requires the authoritative parent identity rather than borrowing another purpose/item proof', async () => {
    const f = repairEvidenceFixture(),
      identity = f.source.releaseInfo.customerIdentity;
    delete f.source.releaseInfo.customerIdentity;
    Object.assign(f.source.releaseInfo, {
      customerDecisions: [{ itemId: 'other-item', customerIdentity: identity }],
      customerProductConfirmations: [
        { itemId: f.item.id, customerIdentity: identity },
      ],
    });
    await expect(
      f.report.publish('csr', f.item.id, f.publish()),
    ).rejects.toThrow('身分');
    expect(f.reports).toHaveLength(0);
  });
  it.each([
    'unverified',
    'wrong-case',
    'wrong-brand',
    'missing-company',
    'malformed-customer',
    'missing-case-brand',
  ])('blocks publication with %s identity facts', async (change) => {
    const f = repairEvidenceFixture(),
      identity = f.source.releaseInfo.customerIdentity!;
    if (change === 'unverified') identity.verified = false;
    if (change === 'wrong-case') identity.caseId = 'other-case';
    if (change === 'wrong-brand') identity.brand = 'BONSON';
    if (change === 'missing-company') identity.companyId = '';
    if (change === 'malformed-customer')
      identity.verifiedCustomerId = 'client-note';
    if (change === 'missing-case-brand')
      delete (f.source as unknown as Record<string, unknown>).caseBrand;
    await expect(
      f.report.publish('csr', f.item.id, f.publish()),
    ).rejects.toThrow();
    expect(f.reports).toHaveLength(0);
    expect(f.operations).toHaveLength(0);
  });
  it.each([
    'foreign-company',
    'inactive-employee',
    'non-owner-csr',
    'unaccepted',
    'old-plan',
    'version',
  ])('does not publish on %s authority or version', async (change) => {
    const f = repairEvidenceFixture();
    if (change === 'foreign-company') f.companies.set('csr', ['other-company']);
    if (change === 'inactive-employee') f.deactivateEmployee();
    if (change === 'non-owner-csr')
      f.item.repairWorkflow.csr!.ownerId = 'other-csr';
    if (change === 'unaccepted') f.item.repairWorkflow.csr!.status = 'SENT';
    if (change === 'old-plan')
      f.item.repairInspection.data.planNote = 'changed current plan';
    const input = {
      ...f.publish(),
      ...(change === 'version' ? { expectedVersion: 6 } : {}),
    };
    await expect(f.report.publish('csr', f.item.id, input)).rejects.toThrow();
    expect(f.reports).toHaveLength(0);
    expect(f.operations).toHaveLength(0);
  });
  it('rechecks permission after the mocked row locks and on an exact retry', async () => {
    const f = repairEvidenceFixture();
    let reads = 0;
    f.actor.mockImplementation(
      (id): Promise<Actor> =>
        Promise.resolve({
          id,
          name: id,
          entityIds: [EVIDENCE_COMPANY],
          permissions: ++reads === 1 ? new Set(['mailroom:review']) : new Set(),
        }),
    );
    await expect(
      f.report.publish('csr', f.item.id, f.publish()),
    ).rejects.toThrow('權限');
    expect(f.reports).toHaveLength(0);
    const g = repairEvidenceFixture(),
      input = g.publish();
    await g.report.publish('csr', g.item.id, input);
    g.permissions.set('csr', new Set());
    await expect(g.report.publish('csr', g.item.id, input)).rejects.toThrow(
      '權限',
    );
    expect(g.reports).toHaveLength(1);
  });
  it.each(['missing', 'duplicate', 'old-plan', 'old-proposal', 'old-quote'])(
    'blocks a %s formal quote binding',
    async (change) => {
      const f = repairEvidenceFixture(),
        binding = f.source.releaseInfo.quoteBindings[0];
      if (change === 'missing') f.source.releaseInfo.quoteBindings = [];
      if (change === 'duplicate')
        f.source.releaseInfo.quoteBindings.push({ ...binding });
      if (change === 'old-plan') binding.planHash = 'c'.repeat(64);
      if (change === 'old-proposal') binding.proposalHash = 'c'.repeat(64);
      if (change === 'old-quote') binding.quoteRevision = 3;
      await expect(
        f.report.publish('csr', f.item.id, f.publish()),
      ).rejects.toThrow();
      expect(f.reports).toHaveLength(0);
    },
  );
  it.each([
    'PENDING',
    'REVOKED',
    'foreign-item',
    'unbound-document',
    'wrong-kind',
  ])('blocks publication media with %s scope', async (change) => {
    const f = repairEvidenceFixture();
    if (change === 'PENDING' || change === 'REVOKED')
      f.assets[0].status = change;
    if (change === 'foreign-item') f.assets[0].itemId = 'other-item';
    if (change === 'unbound-document') f.assets[0].bindings = [];
    if (change === 'wrong-kind')
      f.assets[0].bindings = [{ kind: 'repair', documentRevision: 3 }];
    await expect(
      f.report.publish('csr', f.item.id, f.publish()),
    ).rejects.toThrow('影像');
    expect(f.reports).toHaveLength(0);
  });
  it('returns the same HMAC capability on exact retry and rejects altered expiry/action without new publication', async () => {
    const f = repairEvidenceFixture(),
      input = f.publish();
    const first = await f.report.publish('csr', f.item.id, input);
    f.item.version++;
    expect(await f.report.publish('csr', f.item.id, input)).toEqual({
      ...first,
      duplicate: true,
    });
    await expect(
      f.report.publish('csr', f.item.id, { ...input, expiresInDays: 8 }),
    ).rejects.toThrow('識別碼');
    await expect(
      f.report.revoke('csr', f.item.id, first.reportId, {
        ...f.command(input.requestId),
        expectedVersion: input.expectedVersion,
      }),
    ).rejects.toThrow('識別碼');
    expect(f.reports).toHaveLength(1);
    expect(f.operations).toHaveLength(1);
  });
  it('rolls back supersession and a new publication if the mocked operation write fails', async () => {
    const f = repairEvidenceFixture(),
      first = await f.report.publish('csr', f.item.id, f.publish());
    f.tx.repairEvidenceOperation.create.mockRejectedValueOnce(
      new Error('mock report receipt failure'),
    );
    await expect(
      f.report.publish(
        'csr',
        f.item.id,
        f.publish('inspection', 'synthetic-second-publish'),
      ),
    ).rejects.toThrow('mock report receipt failure');
    expect(f.reports).toHaveLength(1);
    expect(f.reports[0].status).toBe('PUBLISHED');
    expect(f.operations).toHaveLength(1);
    expect(
      await f.report.publicView(first.reportId, tokenFrom(first.shareLink)),
    ).toBeDefined();
  });
  it('a new publication atomically supersedes the old link, and selected media remain scoped to the report', async () => {
    const f = repairEvidenceFixture(),
      first = await f.report.publish('csr', f.item.id, f.publish());
    const next = await f.report.publish(
      'csr',
      f.item.id,
      f.publish('inspection', 'synthetic-second-publish'),
    );
    await expect(
      f.report.publicView(first.reportId, tokenFrom(first.shareLink)),
    ).rejects.toThrow();
    await f.report.publicMedia(
      next.reportId,
      'inspection-media',
      tokenFrom(next.shareLink),
    );
    expect(f.storage.stream).toHaveBeenCalledWith(
      'synthetic-private-bucket',
      f.assets[0].objectKey,
      '123456789012345678',
    );
    await expect(
      f.report.publicMedia(
        next.reportId,
        'foreign-media',
        tokenFrom(next.shareLink),
      ),
    ).rejects.toThrow('不屬於報告');
  });
  it.each([
    'wrong-token',
    'disabled',
    'expiry',
    'secret-rotation',
    'source-cancelled',
    'source-brand',
    'customer',
    'serial',
    'currency',
    'quote',
    'plan',
    'media-revoked',
    'content-tamper',
  ])('invalidates public access after %s', async (change) => {
    const f = repairEvidenceFixture(),
      result = await f.report.publish('csr', f.item.id, f.publish());
    let token = tokenFrom(result.shareLink);
    if (change === 'wrong-token') token = 'x'.repeat(43);
    if (change === 'disabled')
      process.env.REPAIR_PUBLIC_REPORT_ENABLED = 'false';
    if (change === 'expiry') f.reports[0].expiresAt = new Date(EVIDENCE_TIME);
    if (change === 'secret-rotation')
      process.env.REPAIR_REPORT_LINK_SECRET =
        'SYNTHETIC_ROTATED_SECRET_32_CHARACTERS';
    if (change === 'source-cancelled') f.source.status = 'CANCELLED';
    if (change === 'source-brand') {
      f.source.caseBrand = 'BONSON';
      f.source.releaseInfo.customerIdentity!.brand = 'BONSON';
    }
    if (change === 'customer')
      f.source.releaseInfo.customerIdentity!.verifiedCustomerId = 'd'.repeat(
        64,
      );
    if (change === 'serial') f.item.serialNumber = 'different-current-sn';
    if (change === 'currency') f.source.releaseInfo.currency = 'USD';
    if (change === 'quote') f.source.releaseInfo.quoteRevision = 5;
    if (change === 'plan')
      f.item.repairInspection.data.planNote = 'different-current-plan';
    if (change === 'media-revoked') f.assets[0].status = 'REVOKED';
    if (change === 'content-tamper')
      (f.reports[0].content as Record<string, unknown>).findings =
        'unreviewed change';
    await expect(f.report.publicView(result.reportId, token)).rejects.toThrow();
    expect(f.storage.stream).not.toHaveBeenCalled();
  });
  it.each(['CLOSED', 'COMPLETED'])(
    'allows only the already-published current identity report on %s, and does not create new reports',
    async (status) => {
      const f = repairEvidenceFixture(),
        result = await f.report.publish('csr', f.item.id, f.publish());
      f.source.status = status;
      expect(
        await f.report.publicView(result.reportId, tokenFrom(result.shareLink)),
      ).toMatchObject({ reportId: result.reportId });
      await expect(
        f.report.publish(
          'csr',
          f.item.id,
          f.publish('inspection', 'terminal-new-publish'),
        ),
      ).rejects.toThrow('結束');
      expect(f.reports).toHaveLength(1);
    },
  );
  it('secret rotation never silently mints a new capability on replay', async () => {
    const f = repairEvidenceFixture(),
      input = f.publish();
    await f.report.publish('csr', f.item.id, input);
    process.env.REPAIR_REPORT_LINK_SECRET =
      'SYNTHETIC_ROTATED_SECRET_32_CHARACTERS';
    await expect(f.report.publish('csr', f.item.id, input)).rejects.toThrow(
      '更新',
    );
    expect(f.reports).toHaveLength(1);
    expect(f.operations).toHaveLength(1);
  });
  it.each(['REPAIRED', 'FACTORY_REPAIRED', 'REPLACED'] as const)(
    'publishes a completed %s repair report only after the actual release and QC evidence',
    async (outcome) => {
      const f = repairEvidenceFixture();
      f.complete(outcome);
      const result = await f.report.publish(
        'csr',
        f.item.id,
        f.publish('repair'),
      );
      expect(
        await f.report.publicView(result.reportId, tokenFrom(result.shareLink)),
      ).toMatchObject({ handling: '合成實修' });
      expect(f.reports[0].reportRevision).toBe(2);
    },
  );
  it.each([
    'qc-fail',
    'check-fail',
    'missing-release',
    'wrong-release',
    'old-release',
    'unsubmitted',
    'old-inspection',
    'declined-csr',
    'missing-stock-out',
  ])('does not publish a repair report with %s', async (change) => {
    const f = repairEvidenceFixture();
    f.complete(change === 'missing-stock-out' ? 'REPLACED' : 'REPAIRED');
    const doc = f.item.repairReport!;
    if (change === 'qc-fail') doc.data.qcResult = 'FAIL';
    if (change === 'check-fail') doc.data.checks[0].result = 'FAIL';
    if (change === 'missing-release') delete f.item.repairWorkflow.release;
    if (change === 'wrong-release')
      f.item.repairWorkflow.release!.purpose = 'RETURN_UNREPAIRED';
    if (change === 'old-release')
      f.item.repairWorkflow.release!.releasedAt = '2026-10-13T03:29:00.000Z';
    if (change === 'unsubmitted') doc.status = 'DRAFT';
    if (change === 'old-inspection') doc.inspectionRevision = 2;
    if (change === 'declined-csr') f.refresh('DECLINE');
    if (change === 'missing-stock-out')
      delete f.item.repairWorkflow.release!.stock;
    await expect(
      f.report.publish('csr', f.item.id, f.publish('repair')),
    ).rejects.toThrow();
    expect(f.reports).toHaveLength(0);
  });
  it.each([
    'no-consent',
    'no-payment',
    'old-payment',
    'missing-invoice',
    'old-invoice',
  ])(
    'does not publish a paid repair completion report with %s financial proof',
    async (change) => {
      const f = repairEvidenceFixture();
      f.complete();
      if (change === 'no-consent')
        f.source.releaseInfo.customerApprovedQuoteRevision = null;
      if (change === 'no-payment') {
        f.source.releaseInfo.confirmedPaymentQuoteRevision = null;
        f.source.repairAllowed = false;
      }
      if (change === 'old-payment')
        f.source.releaseInfo.confirmedPaymentQuoteRevision = 3;
      if (change === 'missing-invoice') {
        f.source.releaseInfo.invoiceStatus = 'MISSING';
        f.source.releaseInfo.invoiceSatisfied = false;
      }
      if (change === 'old-invoice')
        f.source.releaseInfo.invoiceQuoteRevision = 3;
      await expect(
        f.report.publish('csr', f.item.id, f.publish('repair')),
      ).rejects.toThrow();
      expect(f.reports).toHaveLength(0);
    },
  );
  it('revoke is versioned/idempotent and list exposes no capability or provider location', async () => {
    const f = repairEvidenceFixture(),
      result = await f.report.publish('csr', f.item.id, f.publish());
    const list = await f.report.list('csr', EVIDENCE_COMPANY, f.item.id);
    expect(list.items[0]).toMatchObject({
      reportId: result.reportId,
      status: 'PUBLISHED',
    });
    for (const key of [
      'token',
      'tokenHash',
      'shareLink',
      'content',
      'bucket',
      'objectKey',
    ])
      expect(list.items[0]).not.toHaveProperty(key);
    await expect(
      f.report.revoke('csr', f.item.id, result.reportId, {
        ...f.command('stale-report-revoke'),
        expectedVersion: 6,
      }),
    ).rejects.toThrow('更新');
    const input = f.command('synthetic-report-revoke');
    await f.report.revoke('csr', f.item.id, result.reportId, input);
    expect(
      await f.report.revoke('csr', f.item.id, result.reportId, input),
    ).toMatchObject({ duplicate: true });
    expect(f.operations).toHaveLength(2);
    await expect(
      f.report.publicView(result.reportId, tokenFrom(result.shareLink)),
    ).rejects.toThrow();
  });
});
