import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MailroomLabelService } from './mailroom-label.service';
import { MailroomService } from './mailroom.service';

const ITEM = '8c9bba2e-6fe7-4602-bf29-7df4a932ee6c';
const COMPANY = 'synthetic-company';
const USER = 'synthetic-clerk';

function fixture() {
  const state = {
    permissions: ['mailroom:read', 'mailroom:update'],
    role: 'CLERK',
    entities: [COMPANY],
    active: true,
    passwordChange: false,
    employeeActive: true,
    employeeBound: true,
    item: {
      id: ITEM,
      entityId: COMPANY,
      label: 'MR-SYNTHETIC-1',
      productName: '墨子行動電源',
      version: 3,
      receiptId: 'receipt',
      receipt: {
        entityId: COMPANY,
        category: 'REPAIR',
        sourceCaseId: 'source-case',
        sourceNumber: 'OLD-CASE-NUMBER',
      },
    },
    source: {
      id: 'source-case',
      type: 'REPAIR',
      number: 'SYNTHETIC-CASE-1',
      customerLabel: '合成顧客',
      customerPhone: '0900000000',
      customerIssue: '無法充電，指示燈不亮',
      internalNote: 'INTERNAL-SECRET',
      releaseInfo: { amount: 9000, account: 'FINANCE-SECRET' },
    } as Record<string, unknown>,
  };
  const forbiddenWrite = () =>
    jest.fn(() => {
      throw new Error('unexpected write');
    });
  const writes = {
    itemUpdate: forbiddenWrite(),
    receiptUpdate: forbiddenWrite(),
    create: forbiddenWrite(),
    transaction: forbiddenWrite(),
    notify: forbiddenWrite(),
  };
  const db = {
    user: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: USER,
          name: 'Synthetic clerk',
          isActive: state.active,
          mustChangePassword: state.passwordChange,
          employee: state.employeeBound
            ? {
                entityId: COMPANY,
                isActive: state.employeeActive,
                department: null,
              }
            : null,
          entityMemberships: state.entities.map((entityId) => ({ entityId })),
          roles: [
            {
              role: {
                code: state.role,
                permissions: state.permissions.map((key) => {
                  const [resource, action] = key.split(':');
                  return { permission: { resource, action } };
                }),
              },
            },
          ],
        }),
      ),
    },
    employee: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          state.employeeBound && state.employeeActive
            ? { id: 'employee' }
            : null,
        ),
      ),
    },
    mailroomItem: {
      findFirst: jest.fn(() => Promise.resolve(structuredClone(state.item))),
      update: writes.itemUpdate,
      create: writes.create,
    },
    mailroomReceipt: { update: writes.receiptUpdate, create: writes.create },
    $transaction: writes.transaction,
  };
  const sync = {
    cases: jest.fn(() =>
      Promise.resolve({ items: [structuredClone(state.source)] }),
    ),
  };
  type MailroomDependencies = ConstructorParameters<typeof MailroomService>;
  const mailroom = new MailroomService(
    db as unknown as MailroomDependencies[0],
    { sendToUser: writes.notify } as unknown as MailroomDependencies[1],
    sync as unknown as MailroomDependencies[2],
  );
  type Dependencies = ConstructorParameters<typeof MailroomLabelService>;
  const service = new MailroomLabelService(
    db as unknown as Dependencies[0],
    mailroom,
    sync as unknown as Dependencies[2],
  );
  return { state, writes, db, sync, service };
}

describe('narrow mailroom label read', () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.MAILROOM_ENABLED = 'true';
    process.env.ERP_PUBLIC_FRONTEND_URL = 'https://dev.example.test';
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns only exact per-item label fields from latest authorized Source and makes zero writes', async () => {
    const f = fixture();
    const label = await f.service.read(USER, COMPANY, ITEM);
    expect(label).toEqual({
      id: ITEM,
      unit: 'MR-SYNTHETIC-1',
      caseNumber: 'SYNTHETIC-CASE-1',
      customerName: '合成顧客',
      customerPhone: '0900000000',
      customerIssue: '無法充電，指示燈不亮',
      productName: '墨子行動電源',
      version: 3,
      qrLink: `https://dev.example.test/operations/repair?entityId=${COMPANY}&itemId=${ITEM}&queue=all`,
    });
    expect(f.sync.cases).toHaveBeenCalledWith(COMPANY, '', 'source-case');
    expect(f.db.mailroomItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM, entityId: COMPANY, receipt: { entityId: COMPANY } },
      }),
    );
    expect(f.db.user.findUnique).toHaveBeenCalledTimes(2);
    expect(f.db.employee.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(label)).not.toMatch(
      /SECRET|releaseInfo|sourceSnapshot|account|internalNote/,
    );
    for (const write of Object.values(f.writes))
      expect(write).not.toHaveBeenCalled();
  });

  it.each([
    'inactive',
    'password',
    'inactive-employee',
    'read',
    'foreign-company',
  ])('rejects %s before item or Source reads', async (kind) => {
    const f = fixture();
    if (kind === 'inactive') f.state.active = false;
    if (kind === 'password') f.state.passwordChange = true;
    if (kind === 'inactive-employee') f.state.employeeActive = false;
    if (kind === 'read') f.state.permissions = ['mailroom:update'];
    if (kind === 'foreign-company') {
      f.state.entities = ['other-company'];
      f.state.employeeBound = false;
    }
    await expect(f.service.read(USER, COMPANY, ITEM)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.db.mailroomItem.findFirst).not.toHaveBeenCalled();
    expect(f.sync.cases).not.toHaveBeenCalled();
  });

  it.each([
    ['CLERK', true],
    ['CLERK', false],
    ['SUPER_ADMIN', true],
    ['SUPER_ADMIN', false],
  ] as const)(
    'keeps preview readable for %s with employee binding %s without print-participation gates',
    async (role, bound) => {
      const f = fixture();
      f.state.role = role;
      f.state.permissions = ['mailroom:read'];
      f.state.employeeBound = bound;
      expect((await f.service.read(USER, COMPANY, ITEM)).id).toBe(ITEM);
      expect(f.db.employee.findFirst).not.toHaveBeenCalled();
      for (const write of Object.values(f.writes))
        expect(write).not.toHaveBeenCalled();
    },
  );

  it.each(['item-company', 'receipt-company'])(
    'rejects mismatched %s before Source read',
    async (kind) => {
      const f = fixture();
      if (kind === 'item-company') f.state.item.entityId = 'other-company';
      else f.state.item.receipt.entityId = 'other-company';
      await expect(f.service.read(USER, COMPANY, ITEM)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );

  it.each(['grant', 'account'])(
    'rechecks %s after Source wait and releases no label',
    async (kind) => {
      const f = fixture();
      f.sync.cases.mockImplementation(() => {
        if (kind === 'grant') f.state.permissions = ['mailroom:update'];
        if (kind === 'account') f.state.active = false;
        return Promise.resolve({ items: [f.state.source] });
      });
      await expect(f.service.read(USER, COMPANY, ITEM)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it.each(['version', 'source-link', 'category'])(
    'rejects changed %s after Source wait',
    async (kind) => {
      const f = fixture();
      f.sync.cases.mockImplementation(() => {
        if (kind === 'version') f.state.item.version++;
        if (kind === 'source-link')
          f.state.item.receipt.sourceCaseId = 'other-case';
        if (kind === 'category') f.state.item.receipt.category = 'RETURN';
        return Promise.resolve({ items: [f.state.source] });
      });
      await expect(f.service.read(USER, COMPANY, ITEM)).rejects.toBeInstanceOf(
        ConflictException,
      );
    },
  );

  it.each(['id', 'type'])(
    'rejects wrong Source %s instead of using contact data',
    async (field) => {
      const f = fixture();
      f.state.source[field] = 'OTHER';
      await expect(f.service.read(USER, COMPANY, ITEM)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    },
  );

  it('fails closed on unavailable Source and never silently uses old receipt data', async () => {
    const f = fixture();
    f.sync.cases.mockRejectedValue(new Error('upstream unavailable'));
    await expect(f.service.read(USER, COMPANY, ITEM)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns explicit null for absent fields in a legacy Source response', async () => {
    const f = fixture();
    delete f.state.source.customerPhone;
    delete f.state.source.customerIssue;
    f.state.source.customerLabel = '   ';
    expect(await f.service.read(USER, COMPANY, ITEM)).toMatchObject({
      customerName: null,
      customerPhone: null,
      customerIssue: null,
    });
  });

  it.each(['LETTER', 'PARCEL', 'UNMATCHED'])(
    'uses a same-item mailroom target and no customer or Source reads for %s',
    async (category) => {
      const f = fixture();
      f.state.item.receipt.category = category;
      f.state.item.receipt.sourceCaseId = null as unknown as string;
      f.state.item.receipt.sourceNumber = null as unknown as string;
      const label = await f.service.read(USER, COMPANY, ITEM);
      expect(label).toMatchObject({
        caseNumber: null,
        customerName: null,
        customerPhone: null,
        customerIssue: null,
      });
      expect(label.qrLink).toBe(
        `https://dev.example.test/operations/mailroom?entityId=${COMPANY}&itemId=${ITEM}`,
      );
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );

  it('uses the same repair scan contract for RETURN', async () => {
    const f = fixture();
    f.state.item.receipt.category = 'RETURN';
    f.state.source.type = 'RETURN';
    expect((await f.service.read(USER, COMPANY, ITEM)).qrLink).toContain(
      '/operations/repair?',
    );
  });

  it('rejects invalid UUID before any account or item access', async () => {
    const f = fixture();
    await expect(f.service.read(USER, COMPANY, 'SKU-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.db.user.findUnique).not.toHaveBeenCalled();
    expect(f.sync.cases).not.toHaveBeenCalled();
  });
});
