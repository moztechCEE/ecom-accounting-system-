import {
  inspectionPlanHash,
  validateFactoryCompletion,
  validateInspectionRelease,
  validateRepairCompletion,
  validateRepairData,
} from './repair-document.contract';

const inspection = {
  number: 'INS-DEMO',
  revision: 3,
  status: 'SUBMITTED',
  authorId: 'technician',
  authorName: '維修師',
  updatedAt: '2026-10-02T00:00:00.000Z',
  submittedAt: '2026-10-02T00:00:00.000Z',
  data: {
    complaint: '無法開機',
    reproduction: 'YES',
    testConditions: '原廠電源與配件',
    checks: [
      { name: '開機', result: 'FAIL', observation: '電源正常但無法啟動' },
    ],
    diagnosis: '電源模組故障',
    causeStatus: 'CONFIRMED',
    plan: 'REPAIR',
    planNote: '更換故障模組',
    feeSuggestion: 'FREE',
    estimateNote: '保固處理，由客服確認',
  },
};
const report = {
  number: 'REP-DEMO',
  revision: 1,
  inspectionRevision: 3,
  status: 'SUBMITTED',
  authorId: 'technician',
  authorName: '維修師',
  updatedAt: '2026-10-02T01:00:00.000Z',
  submittedAt: '2026-10-02T01:00:00.000Z',
  data: {
    outcome: 'REPAIRED',
    workPerformed: '更換電源模組',
    parts: [{ name: '電源模組', sku: 'DEMO-PART', quantity: 1 }],
    laborMinutes: 20,
    checks: [
      { name: '開機', result: 'PASS', observation: '連續啟動三次均正常' },
    ],
    qcResult: 'PASS',
    qcNotes: '功能複驗通過',
    deliveredAccessories: '原配件完整返還',
  },
};

describe('repair completion inspection revision binding', () => {
  it('rejects a submitted used-part line without its stock identity or positive quantity', () => {
    for (const part of [
      { name: '', sku: 'DEMO-PART', quantity: 1 },
      { name: '電源模組', sku: '', quantity: 1 },
      { name: '電源模組', sku: 'DEMO-PART', quantity: 0 },
    ]) {
      expect(() =>
        validateRepairData({ ...report.data, parts: [part] } as any),
      ).toThrow();
    }
  });

  it('accepts passing submitted work tied to the current submitted inspection', () => {
    expect(validateRepairCompletion(inspection, report)).toBe(report);
  });

  it('rejects old passing work after the technician submits a newer inspection even when the plan is unchanged', () => {
    const revised = {
      ...inspection,
      revision: 4,
      data: { ...inspection.data, diagnosis: '補充確認另一故障點' },
    };
    expect(() => validateRepairCompletion(revised, report)).toThrow();
    expect(
      validateRepairCompletion(revised, {
        ...report,
        revision: 2,
        inspectionRevision: 4,
      }),
    ).toMatchObject({ inspectionRevision: 4 });
  });

  it('requires the binding on legacy reports instead of treating missing metadata as consent', () => {
    const { inspectionRevision: _binding, ...unboundReport } = report;
    expect(() => validateRepairCompletion(inspection, unboundReport)).toThrow();
  });

  it('still requires submitted documents, matching technical outcomes and passing final checks', () => {
    expect(() =>
      validateRepairCompletion({ ...inspection, status: 'DRAFT' }, report),
    ).toThrow('先提交');
    expect(() =>
      validateRepairCompletion(inspection, { ...report, status: 'DRAFT' }),
    ).toThrow('先提交');
    expect(() =>
      validateRepairCompletion(inspection, {
        ...report,
        data: { ...report.data, qcResult: 'FAIL' },
      }),
    ).toThrow('複驗通過');
    expect(() =>
      validateRepairCompletion(
        { ...inspection, data: { ...inspection.data, plan: 'FACTORY' } },
        report,
      ),
    ).toThrow('方案不同');
    expect(() =>
      validateRepairCompletion(
        { ...inspection, data: { ...inspection.data, plan: 'RETURN' } },
        report,
      ),
    ).toThrow('方案不同');
  });

  it('factory completion is a distinct outcome bound to the reviewed plan, returned factory reference and passing QC', () => {
    const original: any = {
      ...inspection,
      data: { ...inspection.data, plan: 'FACTORY' },
    };
    original.review = {
      inspectionRevision: 3,
      actorId: 'csr',
      name: '客服',
      confirmedAt: '2026-10-05T00:00:00Z',
      decision: 'APPROVE',
      planHash: inspectionPlanHash(original),
      quoteRevision: 4,
    };
    const completed: any = {
      ...report,
      data: {
        ...report.data,
        outcome: 'FACTORY_REPAIRED',
        factoryReference: 'FACTORY-DEMO-001',
      },
    };
    expect(
      validateFactoryCompletion(original, completed, 'FACTORY-DEMO-001'),
    ).toBe(completed);
    expect(() =>
      validateFactoryCompletion(original, completed, 'FACTORY-OTHER'),
    ).toThrow('原廠單號');
    expect(() => validateRepairCompletion(original, completed)).toThrow(
      '方案不同',
    );
    expect(() =>
      validateFactoryCompletion(
        original,
        { ...completed, inspectionRevision: 2 },
        'FACTORY-DEMO-001',
      ),
    ).toThrow('改版');
    expect(() =>
      validateRepairData({ ...completed.data, factoryReference: '' }),
    ).toThrow('交辦單號');
    expect(() =>
      validateInspectionRelease({
        ...original,
        review: { ...original.review, decision: 'DECLINE' },
      }),
    ).toThrow('客服確認');
    expect(() =>
      validateInspectionRelease({
        ...original,
        data: { ...original.data, estimateAmount: 500 },
      }),
    ).toThrow('客服確認');
  });
});
