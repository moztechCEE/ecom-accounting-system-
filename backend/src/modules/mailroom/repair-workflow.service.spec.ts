import { ForbiddenException } from '@nestjs/common';
import { RepairWorkbenchService } from './repair-workbench.service';
import { type Actor, type SourceCase } from './mailroom.contract';
import {
  type InspectionDocument,
  inspectionPlanHash,
} from './repair-document.contract';
import { sentCustomerWorkflow } from './repair-workflow.contract';
import { type RepairWorkflowDto } from './repair-workflow.dto';

const actor = (id: string): Actor => ({
  id,
  name: id,
  entityIds: ['company'],
  permissions: new Set(
    id.startsWith('csr')
      ? ['mailroom:review']
      : ['repair_workbench:read', 'repair_workbench:update'],
  ),
});
const inspection = (
  plan: 'REPAIR' | 'FACTORY' | 'RETURN' = 'REPAIR',
): InspectionDocument => ({
  number: 'INS-DEMO',
  revision: 3,
  status: 'SUBMITTED',
  authorId: 'tech',
  authorName: 'tech',
  updatedAt: '2026-10-05T00:00:00Z',
  data: {
    complaint: '無法開機',
    reproduction: 'YES',
    testConditions: '原廠電源',
    checks: [{ name: '開機', result: 'FAIL', observation: '無法啟動' }],
    diagnosis: '主板故障',
    causeStatus: 'CONFIRMED',
    plan,
    planNote: '依方案處理',
    feeSuggestion: 'PAID',
    estimateAmount: 500,
    estimateNote: '檢修建議，對客金額由客服確認',
  },
});

describe('native repair departmental acceptance, original return and factory custody', () => {
  let service: RepairWorkbenchService;
  let prisma: any;
  let mailroom: any;
  let sync: any;
  let row: any;
  let source: SourceCase;
  let events: Map<string, any>;
  let sequence: number;
  const command = (
    action: RepairWorkflowDto['action'],
    fields: Partial<RepairWorkflowDto> = {},
  ): RepairWorkflowDto => ({
    entityId: 'company',
    requestId: `workflow-${++sequence}`,
    expectedVersion: row.version,
    action,
    note: '具體確認紀錄',
    ...fields,
  });
  const reviewed = (decision: 'APPROVE' | 'DECLINE' = 'APPROVE') => {
    row.status = 'INSPECTING';
    row.repairWorkflow = {
      ...sentCustomerWorkflow(row, actor('tech'), '2026-10-05T00:00:00Z', 4),
      csr: {
        ...sentCustomerWorkflow(row, actor('tech'), '2026-10-05T00:00:00Z', 4)
          .csr,
        status: 'RESOLVED',
        ownerId: 'csr',
        acceptedAt: '2026-10-05T00:01:00Z',
        decision,
      },
    };
    row.repairInspection.review = {
      inspectionRevision: 3,
      actorId: 'csr',
      name: 'csr',
      confirmedAt: '2026-10-05T00:02:00Z',
      decision,
      planHash: inspectionPlanHash(row.repairInspection),
      quoteRevision: 4,
    };
  };
  const send = () =>
    service.workflow(
      'tech',
      'piece',
      command('send_factory', {
        confirmedItems: true,
        location: '寄件櫃台',
        factoryName: '示範原廠',
        reference: 'FACTORY-DEMO-001',
        carrier: '示範物流',
        trackingNumber: 'DEMO-OUT',
      }),
    );
  beforeEach(() => {
    sequence = 100;
    row = {
      id: 'piece',
      entityId: 'company',
      label: 'DEMO-001',
      version: 5,
      status: 'WAITING_CUSTOMER',
      productName: '示範產品',
      location: '維修桌',
      serialNumber: 'ORIGINAL-SN',
      repairOwnerId: 'tech',
      custodianId: 'tech',
      nextUserId: null,
      repairInspection: inspection(),
      repairReport: null,
      receipt: {
        category: 'REPAIR',
        sourceCaseId: 'case',
        receivedById: 'clerk',
        customerServiceUserId: 'csr',
      },
    };
    row.repairWorkflow = sentCustomerWorkflow(
      row,
      actor('tech'),
      '2026-10-05T00:00:00Z',
      4,
    );
    events = new Map();
    source = {
      id: 'case',
      number: 'DEMO-CASE',
      type: 'REPAIR',
      brand: 'MOZTECH',
      version: 'source-version',
      status: 'REPAIRING',
      customerLabel: '示範',
      items: [],
      repairAllowed: true,
      releaseInfo: {
        quoteRevision: 4,
        customerApprovedQuoteRevision: 4,
        customerApprovedAt: '2026-10-05T00:00:00Z',
        amount: 500,
        currency: 'TWD',
        confirmedPaymentQuoteRevision: 4,
      },
    };
    prisma = {
      mailroomItem: {
        findUnique: jest.fn(async () => structuredClone(row)),
        findMany: jest.fn(async () => [structuredClone(row)]),
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
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 'employee' }) },
      $transaction: jest.fn(),
    };
    let queue = Promise.resolve();
    prisma.$transaction.mockImplementation((callback: any) => {
      const result = queue.then(() => callback(prisma));
      queue = result.catch(() => undefined);
      return result;
    });
    mailroom = {
      enabled: jest.fn(),
      actor: jest.fn(async (id: string) => actor(id)),
      detail: jest.fn(async () => structuredClone(row)),
      views: jest.fn(async (rows: any[]) => structuredClone(rows)),
      record: jest.fn(
        async (
          _tx: any,
          writer: Actor,
          updated: any,
          action: string,
          requestId: string,
          hash: string,
        ) => {
          events.set(`${updated.entityId}:${writer.id}:${requestId}`, {
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
    sync = {
      cases: jest.fn(async () => ({ items: [structuredClone(source)] })),
    };
    service = new RepairWorkbenchService(prisma, mailroom, sync);
  });

  it('records sent/accepted/resolved separately; CSR ACK cannot move physical custody or silently resolve a decision', async () => {
    const initial = structuredClone(row.repairWorkflow);
    await expect(
      service.workflow(
        'csr',
        'piece',
        command('resolve_customer', {
          inspectionRevision: 3,
          decision: 'DECLINE',
        }),
      ),
    ).rejects.toThrow('接手人');
    await service.workflow('csr', 'piece', command('claim_customer'));
    expect(row.repairWorkflow.csr).toMatchObject({
      status: 'ACCEPTED',
      ownerId: 'csr',
      inspectionRevision: 3,
      estimateRevision: 3,
      quoteRevision: 4,
    });
    expect(initial.csr.status).toBe('SENT');
    expect(row.status).toBe('WAITING_CUSTOMER');
    expect(row.custodianId).toBe('tech');
    expect(row.repairOwnerId).toBe('tech');
    expect(row.nextUserId).toBe('csr');
    await expect(
      service.workflow('csr-other', 'piece', command('claim_customer')),
    ).rejects.toThrow('接手人');
    await expect(
      service.workflow(
        'csr',
        'piece',
        command('resolve_customer', {
          inspectionRevision: 2,
          decision: 'DECLINE',
        }),
      ),
    ).rejects.toThrow('版本');
    await service.workflow(
      'csr',
      'piece',
      command('resolve_customer', {
        inspectionRevision: 3,
        decision: 'DECLINE',
      }),
    );
    expect(row.repairWorkflow.csr).toMatchObject({
      status: 'RESOLVED',
      decision: 'DECLINE',
    });
    expect(row.repairInspection.review).toMatchObject({
      inspectionRevision: 3,
      quoteRevision: 4,
      decision: 'DECLINE',
      planHash: inspectionPlanHash(row.repairInspection),
    });
    expect(row.custodianId).toBe('tech');
  });

  it('returns an unrepaired original only after CSR refusal, with physical confirmation and without inventing a repair/QC report', async () => {
    reviewed('APPROVE');
    await expect(
      service.workflow(
        'tech',
        'piece',
        command('return_original', {
          confirmedItems: true,
          location: '交回櫃台',
        }),
      ),
    ).rejects.toThrow();
    reviewed('DECLINE');
    await expect(
      service.workflow(
        'tech',
        'piece',
        command('return_original', { location: '交回櫃台' }),
      ),
    ).rejects.toThrow('本人核對');
    await service.workflow(
      'tech',
      'piece',
      command('return_original', {
        confirmedItems: true,
        location: '交回櫃台',
      }),
    );
    expect(row).toMatchObject({
      status: 'WAITING_RETURN_ACCEPTANCE',
      custodianId: 'tech',
      nextUserId: 'clerk',
      serialNumber: 'ORIGINAL-SN',
      repairReport: null,
    });
    expect(row.repairWorkflow.release).toMatchObject({
      purpose: 'RETURN_UNREPAIRED',
      inspectionRevision: 3,
      releasedBy: 'tech',
    });
    expect(sync.cases).not.toHaveBeenCalled();
    expect(
      [...events.values()][0].snapshot.repairWorkflow.release.purpose,
    ).toBe('RETURN_UNREPAIRED');
  });

  it('allows a reviewed RETURN plan without fabricating work; a changed inspection or estimate invalidates the old customer decision', async () => {
    row.repairInspection = inspection('RETURN');
    reviewed('APPROVE');
    row.repairInspection.data.estimateAmount = 600;
    await expect(
      service.workflow(
        'tech',
        'piece',
        command('return_original', { confirmedItems: true, location: '櫃台' }),
      ),
    ).rejects.toThrow();
    reviewed('APPROVE');
    await service.workflow(
      'tech',
      'piece',
      command('return_original', { confirmedItems: true, location: '櫃台' }),
    );
    expect(row.repairWorkflow.release.purpose).toBe('RETURN_UNREPAIRED');
  });

  it('binds CSR approval to the source quote; consent does not stand in for paid release and a new quote blocks old approval', async () => {
    row.repairInspection = inspection('FACTORY');
    row.repairWorkflow = sentCustomerWorkflow(
      row,
      actor('tech'),
      '2026-10-05T00:00:00Z',
      4,
    );
    await service.workflow('csr', 'piece', command('claim_customer'));
    source.releaseInfo!.customerApprovedQuoteRevision = 3;
    await expect(
      service.workflow(
        'csr',
        'piece',
        command('resolve_customer', {
          inspectionRevision: 3,
          decision: 'APPROVE',
        }),
      ),
    ).rejects.toThrow('同意或報價版本');
    source.releaseInfo!.customerApprovedQuoteRevision = 4;
    source.releaseInfo!.confirmedPaymentQuoteRevision = null;
    source.repairAllowed = false;
    await service.workflow(
      'csr',
      'piece',
      command('resolve_customer', {
        inspectionRevision: 3,
        decision: 'APPROVE',
      }),
    );
    expect(row.repairWorkflow.csr.quoteRevision).toBe(4);
    await expect(send()).rejects.toThrow('足額收款');
    source.repairAllowed = true;
    source.releaseInfo = {
      ...source.releaseInfo!,
      quoteRevision: 5,
      customerApprovedQuoteRevision: 5,
      confirmedPaymentQuoteRevision: 5,
    };
    await expect(send()).rejects.toThrow('報價版本');
    source.releaseInfo = {
      ...source.releaseInfo!,
      quoteRevision: 4,
      customerApprovedQuoteRevision: 4,
      confirmedPaymentQuoteRevision: 4,
    };
    await send();
    expect(row.status).toBe('FACTORY_OUTBOUND');
  });

  it('tracks factory/carrier custody without pretending the external recipient is an ERP user; only the original technician signs the actual return', async () => {
    row.repairInspection = inspection('FACTORY');
    reviewed();
    await send();
    expect(row.repairWorkflow.factory).toMatchObject({
      stage: 'SENT',
      physicalCustody: 'FACTORY_CARRIER',
      reference: 'FACTORY-DEMO-001',
    });
    expect(row.custodianId).toBe('tech');
    const detail = await service.documents('tech', 'company', 'piece');
    expect(detail.editable).toBe(false);
    expect(detail.allowedWorkflowActions).toContain('accept_factory');
    await expect(
      service.save('tech', 'piece', 'inspection', {
        entityId: 'company',
        requestId: 'external-doc-save',
        expectedVersion: row.version,
        status: 'DRAFT',
        data: row.repairInspection.data,
      }),
    ).rejects.toThrow('實物已簽收');
    await expect(
      service.workflow('other-tech', 'piece', command('accept_factory')),
    ).rejects.toThrow();
    await service.workflow('tech', 'piece', command('accept_factory'));
    expect(row).toMatchObject({
      status: 'FACTORY_RECEIVED',
      custodianId: 'tech',
    });
    expect(row.repairWorkflow.factory.physicalCustody).toBe('FACTORY');
    await expect(
      service.workflow(
        'tech',
        'piece',
        command('receive_factory', {
          confirmedItems: true,
          location: '維修桌',
        }),
      ),
    ).rejects.toThrow();
    await service.workflow(
      'tech',
      'piece',
      command('request_factory_return', {
        carrier: '示範物流',
        trackingNumber: 'DEMO-BACK',
      }),
    );
    expect(row.status).toBe('FACTORY_RETURNING');
    await expect(
      service.workflow(
        'tech',
        'piece',
        command('receive_factory', { location: '維修桌' }),
      ),
    ).rejects.toThrow('本人核對');
    await service.workflow(
      'tech',
      'piece',
      command('receive_factory', { confirmedItems: true, location: '維修桌' }),
    );
    expect(row).toMatchObject({ status: 'INSPECTING', custodianId: 'tech' });
    expect(row.repairWorkflow.factory).toMatchObject({
      stage: 'RETURNED',
      physicalCustody: 'TECHNICIAN',
      returnedBy: 'tech',
    });
    expect((await service.documents('tech', 'company', 'piece')).editable).toBe(
      true,
    );
    const data: any = {
      outcome: 'FACTORY_REPAIRED',
      factoryReference: 'FACTORY-DEMO-001',
      workPerformed: '原廠換主板，本人複驗',
      parts: [],
      laborMinutes: 15,
      checks: [
        { name: '開機', result: 'FAIL', observation: '返還後仍無法啟動' },
      ],
      qcResult: 'FAIL',
      qcNotes: '功能未通過',
      deliveredAccessories: '配件完整',
    };
    await service.save('tech', 'piece', 'repair', {
      entityId: 'company',
      requestId: 'factory-report-fail',
      expectedVersion: row.version,
      status: 'SUBMITTED',
      data,
    });
    await expect(
      service.workflow('tech', 'piece', command('complete_factory')),
    ).rejects.toThrow('複驗');
    data.checks[0] = {
      name: '開機',
      result: 'PASS',
      observation: '三次啟動正常',
    };
    data.qcResult = 'PASS';
    data.qcNotes = '複驗通過';
    await service.save('tech', 'piece', 'repair', {
      entityId: 'company',
      requestId: 'factory-report-pass',
      expectedVersion: row.version,
      status: 'SUBMITTED',
      data,
    });
    await service.workflow('tech', 'piece', command('complete_factory'));
    expect(row).toMatchObject({
      status: 'WAITING_RETURN_ACCEPTANCE',
      nextUserId: 'clerk',
      custodianId: 'tech',
    });
    expect(row.repairWorkflow.release.purpose).toBe('FACTORY_REPAIRED');
  });

  it('factory cancellation preserves external custody until a separate actual return shipment, and cannot stand in for completed repair or customer refusal', async () => {
    row.repairInspection = inspection('FACTORY');
    reviewed();
    await send();
    await service.workflow('tech', 'piece', command('accept_factory'));
    await service.workflow('tech', 'piece', command('cancel_factory'));
    expect(row.repairWorkflow.factory).toMatchObject({
      stage: 'ACCEPTED',
      cancelled: true,
      physicalCustody: 'FACTORY',
    });
    expect(row.repairWorkflow.release).toBeUndefined();
    expect(row.repairReport).toBeNull();
    expect(row.status).toBe('FACTORY_RECEIVED');
    await expect(
      service.workflow(
        'tech',
        'piece',
        command('receive_factory', {
          confirmedItems: true,
          location: '維修桌',
        }),
      ),
    ).rejects.toThrow();
    await service.workflow(
      'tech',
      'piece',
      command('request_factory_return', {
        carrier: '示範物流',
        trackingNumber: 'DEMO-CANCEL-BACK',
      }),
    );
    await service.workflow(
      'tech',
      'piece',
      command('receive_factory', { confirmedItems: true, location: '維修桌' }),
    );
    await expect(
      service.workflow('tech', 'piece', command('complete_factory')),
    ).rejects.toThrow();
    await expect(
      service.workflow(
        'tech',
        'piece',
        command('return_original', {
          confirmedItems: true,
          location: '交回櫃台',
        }),
      ),
    ).rejects.toThrow();
  });

  it('uses a row lock and exact request hash; committed retries still require current company and permissions', async () => {
    const input = command('claim_customer');
    await service.workflow('csr', 'piece', input);
    await expect(
      service.workflow('csr', 'piece', input),
    ).resolves.toMatchObject({ duplicate: true });
    expect(row.version).toBe(6);
    expect(prisma.mailroomItem.update).toHaveBeenCalledTimes(1);
    await expect(
      service.workflow('csr', 'piece', { ...input, note: '不同內容' }),
    ).rejects.toThrow('識別碼');
    mailroom.actor.mockResolvedValue({
      ...actor('csr'),
      permissions: new Set(),
    });
    await expect(service.workflow('csr', 'piece', input)).rejects.toThrow(
      '權限',
    );
    mailroom.actor.mockImplementation(async (id: string, tx?: unknown) =>
      tx ? { ...actor(id), entityIds: ['other'] } : actor(id),
    );
    await expect(service.workflow('csr', 'piece', input)).rejects.toThrow(
      '公司',
    );
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('rejects stale versions, a freshly revoked actor and cross-company items before mutating', async () => {
    await expect(
      service.workflow(
        'csr',
        'piece',
        command('claim_customer', { expectedVersion: 4 }),
      ),
    ).rejects.toThrow('已更新');
    mailroom.actor.mockImplementation(async (id: string, tx?: unknown) => {
      if (tx) throw new ForbiddenException('已停用');
      return actor(id);
    });
    await expect(
      service.workflow('csr', 'piece', command('claim_customer')),
    ).rejects.toThrow('已停用');
    mailroom.actor.mockImplementation(async (id: string) => actor(id));
    row.entityId = 'other';
    await expect(
      service.workflow('csr', 'piece', command('claim_customer')),
    ).rejects.toThrow('找不到');
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
  });

  it('a submitted inspection revision clears stale CSR consent and release but retains factory custody evidence in immutable history', async () => {
    reviewed();
    const old = structuredClone(row.repairWorkflow);
    await service.save('tech', 'piece', 'inspection', {
      entityId: 'company',
      requestId: 'inspection-revised-001',
      expectedVersion: row.version,
      status: 'SUBMITTED',
      data: { ...row.repairInspection.data, diagnosis: '第二個故障點' },
    });
    expect(row.repairInspection.revision).toBe(4);
    expect(row.repairInspection.review).toBeUndefined();
    expect(row.repairWorkflow.csr).toBeUndefined();
    expect(old.csr.status).toBe('RESOLVED');
    await expect(
      service.workflow(
        'tech',
        'piece',
        command('return_original', { confirmedItems: true, location: '櫃台' }),
      ),
    ).rejects.toThrow();
  });

  it('CSR queue only shows sent work assigned to this person or their own accepted work and paginates after ownership filtering', async () => {
    const other = structuredClone(row);
    other.id = 'assigned-other';
    other.repairWorkflow.csr.sentToUserId = 'csr-other';
    const pool = structuredClone(row);
    pool.id = 'unassigned';
    pool.repairWorkflow.csr.sentToUserId = null;
    prisma.mailroomItem.findMany.mockResolvedValue([other, row, pool]);
    const result = await service.customerQueue('csr', {
      entityId: 'company',
      page: 2,
      pageSize: 1,
      search: 'DEMO',
    });
    expect(result.total).toBe(2);
    expect(result.items.map((x) => x.id)).toEqual(['unassigned']);
    expect(result.items[0].allowedWorkflowActions).toEqual(['claim_customer']);
    expect(prisma.mailroomItem.findMany.mock.calls[0][0].where).toMatchObject({
      entityId: 'company',
      status: 'WAITING_CUSTOMER',
    });
    await expect(
      service.customerQueue('tech', { entityId: 'company' }),
    ).rejects.toThrow('權限');
  });
});
