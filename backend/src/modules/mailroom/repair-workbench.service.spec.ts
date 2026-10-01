import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RepairWorkbenchService } from './repair-workbench.service';
import { SaveInspectionDto, SaveRepairDto } from './repair-document.dto';
import { type Actor } from './mailroom.contract';

const actor = (
  permissions = ['repair_workbench:read', 'repair_workbench:update'],
  entityIds = ['company'],
): Actor => ({
  id: 'tech',
  name: '維修師',
  permissions: new Set(permissions),
  entityIds,
});
const inspectionData = {
  complaint: '無法開機',
  reproduction: 'YES' as const,
  testConditions: '原廠電源與配件',
  checks: [{ name: '開機', result: 'FAIL' as const, observation: '無法啟動' }],
  diagnosis: '電源模組故障',
  causeStatus: 'CONFIRMED' as const,
  plan: 'REPAIR' as const,
  planNote: '更換故障模組',
  feeSuggestion: 'FREE' as const,
  estimateNote: '由客服確認保固處理',
};
const emptyInspectionData = {
  complaint: '',
  reproduction: 'NOT_TESTED' as const,
  testConditions: '',
  checks: [],
  diagnosis: '',
  causeStatus: 'UNKNOWN' as const,
  plan: 'REPAIR' as const,
  planNote: '',
  feeSuggestion: 'REVIEW' as const,
  estimateNote: '',
};
const repairData = {
  outcome: 'REPAIRED' as const,
  workPerformed: '更換電源模組',
  parts: [{ name: '電源模組', sku: 'DEMO-PART', quantity: 1 }],
  laborMinutes: 20,
  checks: [
    { name: '開機', result: 'PASS' as const, observation: '連續啟動三次正常' },
  ],
  qcResult: 'PASS' as const,
  qcNotes: '功能複驗通過',
  deliveredAccessories: '配件完整返還',
};
const inspectionInput = (
  overrides: Partial<SaveInspectionDto> = {},
): SaveInspectionDto => ({
  entityId: 'company',
  requestId: 'inspection-request-001',
  expectedVersion: 5,
  status: 'SUBMITTED',
  data: structuredClone(inspectionData),
  ...overrides,
});
const repairInput = (
  overrides: Partial<SaveRepairDto> = {},
): SaveRepairDto => ({
  entityId: 'company',
  requestId: 'repair-request-001',
  expectedVersion: 5,
  status: 'SUBMITTED',
  data: structuredClone(repairData),
  ...overrides,
});

describe('RepairWorkbenchService document authorization, versions and release context', () => {
  let service: RepairWorkbenchService;
  let prisma: any;
  let mailroom: any;
  let sync: any;
  let row: any;
  let events: Map<string, any>;
  beforeEach(() => {
    row = {
      id: 'piece',
      entityId: 'company',
      label: 'DEMO-001',
      version: 5,
      status: 'INSPECTING',
      repairOwnerId: 'tech',
      custodianId: 'tech',
      repairInspection: null,
      repairReport: null,
      receipt: { category: 'REPAIR', sourceCaseId: 'source-case' },
    };
    events = new Map();
    prisma = {
      mailroomItem: {
        findUnique: jest.fn(async () => structuredClone(row)),
        update: jest.fn(async ({ data }: any) => {
          row = {
            ...row,
            ...data,
            version: row.version + data.version.increment,
          };
          return structuredClone(row);
        }),
      },
      mailroomAction: {
        findUnique: jest.fn(async ({ where }: any) => {
          const key = where.entityId_actorId_requestId;
          return (
            events.get(`${key.entityId}:${key.actorId}:${key.requestId}`) ||
            null
          );
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    };
    mailroom = {
      enabled: jest.fn(),
      actor: jest.fn().mockImplementation(async () => actor()),
      detail: jest.fn(async () => structuredClone(row)),
      record: jest.fn(
        async (
          _tx: any,
          writer: any,
          updated: any,
          action: string,
          requestId: string,
          hash: string,
        ) => {
          events.set(`${updated.entityId}:${writer.id}:${requestId}`, {
            itemId: updated.id,
            requestHash: hash,
            action,
            snapshot: {
              repairInspection: updated.repairInspection,
              repairReport: updated.repairReport,
            },
          });
          return [{ userId: 'tech', id: 'notice' }];
        },
      ),
      publish: jest.fn(),
    };
    sync = {
      cases: jest
        .fn()
        .mockResolvedValue({
          items: [
            {
              id: 'source-case',
              type: 'REPAIR',
              repairAllowed: false,
              status: 'PENDING_PAYMENT',
            },
          ],
        }),
    };
    service = new RepairWorkbenchService(prisma, mailroom, sync);
  });

  it.each([
    { repairOwnerId: 'another', custodianId: 'tech' },
    { repairOwnerId: 'tech', custodianId: 'clerk' },
    { receipt: { category: 'PARCEL', sourceCaseId: null } },
  ])(
    'requires both ownership and physical custody of a repair/refurbish item',
    async (override) => {
      Object.assign(row, override);
      await expect(
        service.save('tech', 'piece', 'inspection', inspectionInput()),
      ).rejects.toThrow('實物已簽收');
      expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
      expect(mailroom.record).not.toHaveBeenCalled();
    },
  );

  it('rejects a one-to-one replacement that reuses the original product serial', async () => {
    row.serialNumber = 'SN-ORIGINAL';
    row.repairInspection = {
      revision: 1, status: 'SUBMITTED', data: { ...inspectionData, plan: 'REPLACE' },
    };
    const input = repairInput({
      data: {
        ...repairData, outcome: 'REPLACED', parts: [], replacementCondition: 'REFURBISHED',
        replacementSku: 'DEMO-PRODUCT', replacementSerial: row.serialNumber,
        replacementSource: '複驗合格退貨整新品', originalDisposition: '原件待故障處置',
      },
    });
    await expect(service.save('tech', 'piece', 'repair', input)).rejects.toThrow();
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
    expect(mailroom.record).not.toHaveBeenCalled();
  });

  it.each([
    { fresh: actor(['repair_workbench:read']), message: '沒有此作業權限' },
    {
      fresh: actor(
        ['repair_workbench:read', 'repair_workbench:update'],
        ['other-company'],
      ),
      message: '無此公司',
    },
  ])(
    'rechecks fresh permissions and company membership under the row lock',
    async ({ fresh, message }) => {
      mailroom.actor
        .mockResolvedValueOnce(actor())
        .mockResolvedValueOnce(fresh);
      await expect(
        service.save('tech', 'piece', 'inspection', inspectionInput()),
      ).rejects.toThrow(message);
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(mailroom.actor).toHaveBeenLastCalledWith('tech', prisma);
      expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
    },
  );

  it('fails closed if the freshly loaded account is inactive and rejects mismatched item companies', async () => {
    mailroom.actor
      .mockResolvedValueOnce(actor())
      .mockRejectedValueOnce(new ForbiddenException('帳號已停用'));
    await expect(
      service.save('tech', 'piece', 'inspection', inspectionInput()),
    ).rejects.toThrow('已停用');
    mailroom.actor.mockImplementation(async () => actor());
    row.entityId = 'other-company';
    await expect(
      service.save('tech', 'piece', 'inspection', inspectionInput()),
    ).rejects.toThrow('找不到維修物件');
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
  });

  it('stores a structurally valid incomplete draft but rejects submission until business fields and checks are complete', async () => {
    const draft = inspectionInput({
      status: 'DRAFT',
      data: structuredClone(emptyInspectionData),
    });
    expect(
      await validate(plainToInstance(SaveInspectionDto, draft)),
    ).toHaveLength(0);
    await expect(
      service.save('tech', 'piece', 'inspection', draft),
    ).resolves.toEqual({ id: 'piece', duplicate: false });
    expect(row.repairInspection).toMatchObject({
      status: 'DRAFT',
      revision: 1,
      authorId: 'tech',
      data: emptyInspectionData,
    });
    expect(row.repairInspection).not.toHaveProperty('submittedAt');
    await expect(
      service.save('tech', 'piece', 'inspection', {
        ...draft,
        requestId: 'inspection-submit-001',
        expectedVersion: 6,
        status: 'SUBMITTED',
      }),
    ).rejects.toThrow('請完成');
    expect(prisma.mailroomItem.update).toHaveBeenCalledTimes(1);
  });

  it('requires a submitted inspection before submitting work and records the exact inspection revision', async () => {
    await expect(
      service.save('tech', 'piece', 'repair', repairInput()),
    ).rejects.toThrow('先提交');
    row.repairInspection = {
      revision: 3,
      status: 'DRAFT',
      data: structuredClone(inspectionData),
    };
    await expect(
      service.save('tech', 'piece', 'repair', repairInput()),
    ).rejects.toThrow('先提交');
    row.repairInspection.status = 'SUBMITTED';
    row.status = 'REPAIRING';
    await expect(
      service.save('tech', 'piece', 'repair', repairInput()),
    ).resolves.toEqual({ id: 'piece', duplicate: false });
    expect(row.repairReport).toMatchObject({
      number: 'REP-DEMO-001',
      revision: 1,
      status: 'SUBMITTED',
      inspectionRevision: 3,
      authorId: 'tech',
    });
    expect(row.repairReport.submittedAt).toEqual(expect.any(String));
    expect(mailroom.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ id: 'tech' }),
      expect.objectContaining({ repairReport: row.repairReport }),
      'submit_repair_repair',
      'repair-request-001',
      expect.any(String),
      'REPAIRING',
      expect.any(String),
      false,
    );
    expect(mailroom.publish).toHaveBeenCalledWith([
      { userId: 'tech', id: 'notice' },
    ]);
  });

  it('protects expected versions, disallowed stages and exact retries without incrementing versions twice', async () => {
    await expect(
      service.save(
        'tech',
        'piece',
        'inspection',
        inspectionInput({ expectedVersion: 4 }),
      ),
    ).rejects.toThrow('案件已更新');
    row.status = 'WAITING_CUSTOMER';
    await expect(
      service.save('tech', 'piece', 'inspection', inspectionInput()),
    ).rejects.toThrow('此階段不能修改');
    row.status = 'INSPECTING';
    const input = inspectionInput();
    await expect(
      service.save('tech', 'piece', 'inspection', input),
    ).resolves.toEqual({ id: 'piece', duplicate: false });
    await expect(
      service.save('tech', 'piece', 'inspection', input),
    ).resolves.toEqual({ id: 'piece', duplicate: true });
    expect(prisma.mailroomItem.update).toHaveBeenCalledTimes(1);
    expect(row.version).toBe(6);
    expect(row.repairInspection.revision).toBe(1);
    expect(mailroom.record).toHaveBeenCalledTimes(1);
  });

  it('rejects request ID reuse with changed content or kind, and rechecks authorization even on a committed retry', async () => {
    const input = inspectionInput();
    await service.save('tech', 'piece', 'inspection', input);
    await expect(
      service.save('tech', 'piece', 'inspection', {
        ...input,
        data: { ...input.data, diagnosis: '另一诊断' },
      }),
    ).rejects.toThrow('操作識別碼');
    await expect(
      service.save(
        'tech',
        'piece',
        'repair',
        repairInput({ requestId: input.requestId }),
      ),
    ).rejects.toThrow('操作識別碼');
    mailroom.actor
      .mockResolvedValueOnce(actor())
      .mockResolvedValueOnce(actor(['repair_workbench:read']));
    await expect(
      service.save('tech', 'piece', 'inspection', input),
    ).rejects.toThrow('沒有此作業權限');
    expect(prisma.mailroomItem.update).toHaveBeenCalledTimes(1);
  });

  it('keeps original full snapshots while assigning independent document revision numbers', async () => {
    await service.save('tech', 'piece', 'inspection', inspectionInput());
    const first = events.get('company:tech:inspection-request-001').snapshot
      .repairInspection;
    await service.save(
      'tech',
      'piece',
      'inspection',
      inspectionInput({
        requestId: 'inspection-request-002',
        expectedVersion: 6,
        data: { ...inspectionData, diagnosis: '補充確認故障原因' },
      }),
    );
    expect(row.repairInspection.revision).toBe(2);
    expect(first.revision).toBe(1);
    expect(first.data.diagnosis).toBe(inspectionData.diagnosis);
  });

  it('returns unavailable release context on source failure, missing case or absent source ID', async () => {
    sync.cases.mockRejectedValueOnce(new Error('source down'));
    expect(
      (await service.documents('tech', 'company', 'piece')).release,
    ).toMatchObject({ available: false });
    sync.cases.mockResolvedValueOnce({ items: [] });
    expect(
      (await service.documents('tech', 'company', 'piece')).release,
    ).toMatchObject({ available: false });
    row.receipt.sourceCaseId = null;
    const before = sync.cases.mock.calls.length;
    expect(
      (await service.documents('tech', 'company', 'piece')).release,
    ).toMatchObject({ available: false });
    expect(sync.cases.mock.calls).toHaveLength(before);
  });

  it('does not accept approval from a different source case or case category', async () => {
    sync.cases.mockResolvedValueOnce({
      items: [
        {
          id: 'different-case',
          type: 'REPAIR',
          repairAllowed: true,
          status: 'PAYMENT_CONFIRMED',
        },
      ],
    });
    expect(
      (await service.documents('tech', 'company', 'piece')).release,
    ).toMatchObject({ available: false });
    sync.cases.mockResolvedValueOnce({
      items: [
        {
          id: 'source-case',
          type: 'RETURN',
          repairAllowed: true,
          status: 'PAYMENT_CONFIRMED',
        },
      ],
    });
    expect(
      (await service.documents('tech', 'company', 'piece')).release,
    ).toMatchObject({ available: false });
  });

  it('rechecks fresh company membership after the detail read before disclosing documents or fetching release context', async () => {
    mailroom.actor.mockResolvedValue(
      actor(
        ['repair_workbench:read', 'repair_workbench:update'],
        ['other-company'],
      ),
    );
    await expect(service.documents('tech', 'company', 'piece')).rejects.toThrow(
      '無此公司',
    );
    expect(sync.cases).not.toHaveBeenCalled();
  });

  it('shows explicit payment/approval gating and allows editing only by the currently holding authorized technician', async () => {
    const initial = await service.documents('tech', 'company', 'piece');
    expect(initial.release).toMatchObject({
      available: true,
      repairAllowed: false,
      sourceStatus: 'PENDING_PAYMENT',
    });
    expect(initial.editable).toBe(true);
    expect(sync.cases).toHaveBeenCalledWith('company', '', 'source-case');
    row.custodianId = 'clerk';
    expect((await service.documents('tech', 'company', 'piece')).editable).toBe(
      false,
    );
    row.custodianId = 'tech';
    row.repairOwnerId = 'another';
    expect((await service.documents('tech', 'company', 'piece')).editable).toBe(
      false,
    );
    row.repairOwnerId = 'tech';
    mailroom.actor.mockResolvedValue(actor(['repair_workbench:read']));
    expect((await service.documents('tech', 'company', 'piece')).editable).toBe(
      false,
    );
    mailroom.actor.mockResolvedValue(actor(['mailroom:read']));
    await expect(service.documents('tech', 'company', 'piece')).rejects.toThrow(
      '無檢修文件',
    );
  });
});
