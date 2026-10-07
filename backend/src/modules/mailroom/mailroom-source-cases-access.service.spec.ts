import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MailroomService } from './mailroom.service';

const CSR_GRANTS = [
  'mailroom:review',
  'after_sales_cases:read',
  'after_sales_cases:update',
];
const MAILROOM_READ = 'mailroom:read';
const REPAIR_READ = 'repair_workbench:read';
const COMPANY = 'synthetic-company';
const USER = 'synthetic-reader';
const sourcePage = () => ({
  items: [
    { id: 'synthetic-repair', type: 'REPAIR' },
    { id: 'synthetic-return', type: 'RETURN' },
  ],
  nextCursor: 'synthetic-next',
  total: 2,
});

type FixtureOptions = {
  permissions?: string[];
  sourceModulePresent?: boolean;
};
type State = {
  permissions: string[];
  entityIds: string[];
  userExists: boolean;
  userActive: boolean;
  mustChangePassword: boolean;
  boundEmployeeActive: boolean | null;
  scopeExists: boolean;
  salesDataScope: 'ENTITY' | 'SELF';
  activeEmployee: boolean;
  sourceActor: {
    entityId: string;
    modules: string[];
    writeModules: string[];
  };
  beforeSourceGate?: () => void;
  sourceGateError?: Error;
  scopeError?: Error;
};

function fixture(options: FixtureOptions = {}) {
  const state: State = {
    permissions: options.permissions || [],
    entityIds: [COMPANY],
    userExists: true,
    userActive: true,
    mustChangePassword: false,
    boundEmployeeActive: null,
    scopeExists: true,
    salesDataScope: 'ENTITY',
    activeEmployee: true,
    sourceActor: {
      entityId: COMPANY,
      modules: ['dashboard', 'cases'],
      writeModules: ['cases'],
    },
  };
  const forbiddenWrite = () =>
    jest.fn().mockRejectedValue(new Error('Unexpected write in GET fixture'));
  const writes = {
    transaction: forbiddenWrite(),
    userUpdate: forbiddenWrite(),
    employeeUpdate: forbiddenWrite(),
    receiptCreate: forbiddenWrite(),
    receiptUpdate: forbiddenWrite(),
    itemCreate: forbiddenWrite(),
    itemUpdate: forbiddenWrite(),
    actionCreate: forbiddenWrite(),
    taskCreate: forbiddenWrite(),
    taskUpdate: forbiddenWrite(),
    deliveryCreate: forbiddenWrite(),
    inventoryCreate: forbiddenWrite(),
    notify: forbiddenWrite(),
    consumeStock: forbiddenWrite(),
    deliverPending: forbiddenWrite(),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(
        ({ select }: { select: { salesDataScope?: boolean } }) => {
          if (select.salesDataScope) {
            if (state.scopeError) return Promise.reject(state.scopeError);
            return Promise.resolve(
              state.scopeExists
                ? {
                    salesDataScope: state.salesDataScope,
                    roles: [{ role: { code: 'SYNTHETIC_READER' } }],
                  }
                : null,
            );
          }
          return Promise.resolve(
            state.userExists
              ? {
                  id: USER,
                  name: 'Synthetic Reader',
                  isActive: state.userActive,
                  mustChangePassword: state.mustChangePassword,
                  employee:
                    state.boundEmployeeActive === null
                      ? null
                      : {
                          entityId: COMPANY,
                          isActive: state.boundEmployeeActive,
                          department: null,
                        },
                  entityMemberships: state.entityIds.map((entityId) => ({
                    entityId,
                  })),
                  roles: [
                    {
                      role: {
                        code: 'SYNTHETIC_READER',
                        permissions: state.permissions.map((key) => {
                          const [resource, action] = key.split(':');
                          return { permission: { resource, action } };
                        }),
                      },
                    },
                  ],
                }
              : null,
          );
        },
      ),
      update: writes.userUpdate,
    },
    employee: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          state.activeEmployee ? { id: 'synthetic-employee' } : null,
        ),
      ),
      update: writes.employeeUpdate,
    },
    mailroomReceipt: {
      create: writes.receiptCreate,
      update: writes.receiptUpdate,
    },
    mailroomItem: { create: writes.itemCreate, update: writes.itemUpdate },
    mailroomAction: { create: writes.actionCreate },
    mailroomTask: { create: writes.taskCreate, updateMany: writes.taskUpdate },
    mailroomDelivery: { createMany: writes.deliveryCreate },
    inventoryTransaction: { create: writes.inventoryCreate },
    $transaction: writes.transaction,
  };
  const page = sourcePage();
  const sync = {
    cases: jest.fn().mockResolvedValue(page),
    deliverPending: writes.deliverPending,
  };
  const sourceModule = {
    actor: jest.fn(() => {
      state.beforeSourceGate?.();
      return state.sourceGateError
        ? Promise.reject(state.sourceGateError)
        : Promise.resolve(state.sourceActor);
    }),
  };
  type Dependencies = ConstructorParameters<typeof MailroomService>;
  const service = new MailroomService(
    prisma as unknown as Dependencies[0],
    { sendToUser: writes.notify } as unknown as Dependencies[1],
    sync as unknown as Dependencies[2],
    { consumeForRepair: writes.consumeStock } as unknown as Dependencies[3],
    options.sourceModulePresent === false
      ? undefined
      : (sourceModule as unknown as Dependencies[4]),
  );
  const actorReads = () =>
    prisma.user.findUnique.mock.calls.filter(
      ([argument]) => !argument.select.salesDataScope,
    ).length;
  return {
    service,
    prisma,
    sync,
    sourceModule,
    writes,
    state,
    page,
    actorReads,
  };
}

type Fixture = ReturnType<typeof fixture>;
const invalidCsrQualifications: Array<[string, (f: Fixture) => void]> = [
  ['missing employee', (f) => (f.state.activeEmployee = false)],
  ['SELF scope', (f) => (f.state.salesDataScope = 'SELF')],
  ['missing scope record', (f) => (f.state.scopeExists = false)],
  ['other Source company', (f) => (f.state.sourceActor.entityId = 'other')],
  [
    'missing Source dashboard',
    (f) => (f.state.sourceActor.modules = ['cases']),
  ],
  [
    'missing Source cases read',
    (f) => (f.state.sourceActor.modules = ['dashboard']),
  ],
  [
    'missing Source cases write',
    (f) => (f.state.sourceActor.writeModules = []),
  ],
];

describe('source cases independent read permission and CSR qualification', () => {
  const originalEnabled = process.env.MAILROOM_ENABLED;
  let f: Fixture;
  beforeEach(() => {
    process.env.MAILROOM_ENABLED = 'true';
  });
  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = originalEnabled;
    for (const write of Object.values(f.writes)) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('mailroom read requires no Employee binding or CSR qualification', async () => {
    f = fixture({ permissions: [MAILROOM_READ] });
    f.state.activeEmployee = false;
    expect(await f.service.sourceCases(USER, COMPANY)).toBe(f.page);
    expect(f.actorReads()).toBe(1);
    expect(f.sourceModule.actor).not.toHaveBeenCalled();
    expect(f.prisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it.each(invalidCsrQualifications)(
    'mailroom read plus CSR grants remains independently readable with %s',
    async (_reason, invalidate) => {
      f = fixture({ permissions: [MAILROOM_READ, ...CSR_GRANTS] });
      invalidate(f);
      expect(
        await f.service.sourceCases(USER, COMPANY, 'synthetic search', {
          awaiting: true,
          cursor: 'synthetic-cursor',
        }),
      ).toBe(f.page);
      expect(f.sync.cases).toHaveBeenCalledTimes(1);
      expect(f.sync.cases).toHaveBeenCalledWith(
        COMPANY,
        'synthetic search',
        undefined,
        { awaiting: true, cursor: 'synthetic-cursor' },
      );
      expect(f.actorReads()).toBe(1);
      expect(f.sourceModule.actor).not.toHaveBeenCalled();
      expect(f.prisma.employee.findFirst).not.toHaveBeenCalled();
    },
  );

  it('mailroom plus repair plus CSR read retains all types without the intake gate', async () => {
    f = fixture({ permissions: [MAILROOM_READ, REPAIR_READ, ...CSR_GRANTS] });
    f.state.activeEmployee = false;
    expect(await f.service.sourceCases(USER, COMPANY)).toBe(f.page);
    expect(f.sourceModule.actor).not.toHaveBeenCalled();
  });

  it('mailroom read does not require the optional Source module provider', async () => {
    f = fixture({
      permissions: [MAILROOM_READ, ...CSR_GRANTS],
      sourceModulePresent: false,
    });
    expect(await f.service.sourceCases(USER, COMPANY)).toBe(f.page);
    expect(f.prisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('repair-only read filters RETURN while preserving page metadata and query options', async () => {
    f = fixture({ permissions: [REPAIR_READ] });
    expect(
      await f.service.sourceCases(USER, COMPANY, 'search', {
        awaiting: false,
        cursor: 'cursor-2',
      }),
    ).toEqual({ ...f.page, items: [f.page.items[0]] });
    expect(f.sync.cases).toHaveBeenCalledTimes(1);
    expect(f.sync.cases).toHaveBeenCalledWith(COMPANY, 'search', undefined, {
      awaiting: false,
      cursor: 'cursor-2',
    });
    expect(f.sourceModule.actor).not.toHaveBeenCalled();
  });

  it('an empty repair-filtered page preserves the upstream continuation cursor', async () => {
    f = fixture({ permissions: [REPAIR_READ] });
    f.page.items = [f.page.items[1]];
    expect(await f.service.sourceCases(USER, COMPANY)).toEqual({
      ...f.page,
      items: [],
    });
    expect(f.sync.cases).toHaveBeenCalledTimes(1);
    expect(f.sync.cases).toHaveBeenCalledWith(
      COMPANY,
      undefined,
      undefined,
      {},
    );
  });

  it.each(CSR_GRANTS)(
    'repair read plus incomplete CSR grants missing %s remains REPAIR only',
    async (missing) => {
      f = fixture({
        permissions: [
          REPAIR_READ,
          ...CSR_GRANTS.filter((key) => key !== missing),
        ],
      });
      expect(await f.service.sourceCases(USER, COMPANY)).toEqual({
        ...f.page,
        items: [f.page.items[0]],
      });
      expect(f.sourceModule.actor).not.toHaveBeenCalled();
    },
  );

  it.each([{ additional: [] }, { additional: [REPAIR_READ] }])(
    'qualified CSR with existing read grants $additional retains REPAIR and RETURN',
    async ({ additional }) => {
      f = fixture({ permissions: [...additional, ...CSR_GRANTS] });
      expect(await f.service.sourceCases(USER, COMPANY)).toBe(f.page);
      expect(f.sourceModule.actor).toHaveBeenCalledTimes(1);
      expect(f.sourceModule.actor).toHaveBeenCalledWith(USER, COMPANY);
      expect(f.prisma.employee.findFirst).toHaveBeenCalledTimes(1);
      expect(f.prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { userId: USER, entityId: COMPANY, isActive: true },
        select: { id: true },
      });
      expect(f.actorReads()).toBe(2);
    },
  );

  it.each(invalidCsrQualifications)(
    'repair plus CSR falls back to a freshly authorized REPAIR page after %s',
    async (_reason, invalidate) => {
      f = fixture({ permissions: [REPAIR_READ, ...CSR_GRANTS] });
      invalidate(f);
      expect(
        await f.service.sourceCases(USER, COMPANY, 'fallback-search', {
          awaiting: true,
          cursor: 'fallback-cursor',
        }),
      ).toEqual({ ...f.page, items: [f.page.items[0]] });
      expect(f.actorReads()).toBe(3);
      expect(f.sync.cases).toHaveBeenCalledTimes(1);
      expect(f.sync.cases).toHaveBeenCalledWith(
        COMPANY,
        'fallback-search',
        undefined,
        { awaiting: true, cursor: 'fallback-cursor' },
      );
    },
  );

  it('Source module explicit ForbiddenException permits only the freshly verified repair fallback', async () => {
    f = fixture({ permissions: [REPAIR_READ, ...CSR_GRANTS] });
    f.state.sourceGateError = new ForbiddenException('Synthetic Source denial');
    expect(await f.service.sourceCases(USER, COMPANY)).toEqual({
      ...f.page,
      items: [f.page.items[0]],
    });
    expect(f.actorReads()).toBe(3);
  });

  it.each<[string, (state: State) => void]>([
    [
      'repair permission revoked',
      (s: State) => (s.permissions = [...CSR_GRANTS]),
    ],
    ['company membership revoked', (s: State) => (s.entityIds = ['other'])],
    ['user deactivated', (s: State) => (s.userActive = false)],
    ['user removed', (s: State) => (s.userExists = false)],
    ['password reset required', (s: State) => (s.mustChangePassword = true)],
    [
      'bound employee deactivated',
      (s: State) => (s.boundEmployeeActive = false),
    ],
  ])(
    'repair fallback rechecks %s before any Source case fetch',
    async (_reason, revoke) => {
      f = fixture({ permissions: [REPAIR_READ, ...CSR_GRANTS] });
      f.state.activeEmployee = false;
      f.state.beforeSourceGate = () => {
        revoke(f.state);
      };
      await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(f.actorReads()).toBe(3);
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );

  it.each(invalidCsrQualifications)(
    'CSR-only read with %s remains forbidden with no Source case fetch',
    async (_reason, invalidate) => {
      f = fixture({ permissions: [...CSR_GRANTS] });
      invalidate(f);
      await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(f.actorReads()).toBe(2);
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );

  it.each(CSR_GRANTS)(
    'CSR-only read missing %s remains forbidden before the intake gate',
    async (missing) => {
      f = fixture({ permissions: CSR_GRANTS.filter((key) => key !== missing) });
      await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(f.sourceModule.actor).not.toHaveBeenCalled();
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );

  it.each([
    new Error('Synthetic provider failure'),
    new ServiceUnavailableException('Synthetic provider unavailable'),
  ])(
    'repair plus CSR does not swallow non-Forbidden provider errors: %s',
    async (error) => {
      f = fixture({ permissions: [REPAIR_READ, ...CSR_GRANTS] });
      f.state.sourceGateError = error;
      await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBe(error);
      expect(f.actorReads()).toBe(2);
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );

  it('repair plus CSR does not swallow a database scope lookup failure', async () => {
    f = fixture({ permissions: [REPAIR_READ, ...CSR_GRANTS] });
    const failure = new Error('Synthetic database failure');
    f.state.scopeError = failure;
    await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBe(failure);
    expect(f.actorReads()).toBe(2);
    expect(f.sync.cases).not.toHaveBeenCalled();
  });

  it.each([
    { permissions: [...CSR_GRANTS] },
    { permissions: [REPAIR_READ, ...CSR_GRANTS] },
  ])(
    'CSR route $permissions keeps unavailable Source module failures explicit',
    async ({ permissions }) => {
      f = fixture({ permissions, sourceModulePresent: false });
      await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(f.prisma.employee.findFirst).not.toHaveBeenCalled();
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['no read grant', []],
    ['mailroom update only', ['mailroom:update']],
    ['mailroom review only', ['mailroom:review']],
  ])(
    'rejects %s before any Source case fetch',
    async (_reason, permissions) => {
      f = fixture({ permissions });
      await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(f.sourceModule.actor).not.toHaveBeenCalled();
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );

  it.each(['other', ''])(
    'rejects wrong or missing company %j before the intake gate',
    async (entityId) => {
      f = fixture({ permissions: [MAILROOM_READ, REPAIR_READ, ...CSR_GRANTS] });
      await expect(
        f.service.sourceCases(USER, entityId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.sourceModule.actor).not.toHaveBeenCalled();
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );

  it.each<[string, (state: State) => void]>([
    ['missing user', (s: State) => (s.userExists = false)],
    ['disabled user', (s: State) => (s.userActive = false)],
    ['password reset required', (s: State) => (s.mustChangePassword = true)],
    ['disabled bound employee', (s: State) => (s.boundEmployeeActive = false)],
  ])('rejects %s before any Source case fetch', async (_reason, invalidate) => {
    f = fixture({ permissions: [MAILROOM_READ, REPAIR_READ, ...CSR_GRANTS] });
    invalidate(f.state);
    await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.sourceModule.actor).not.toHaveBeenCalled();
    expect(f.sync.cases).not.toHaveBeenCalled();
  });

  it('upstream case failure remains an error and is never converted to an empty page', async () => {
    f = fixture({ permissions: [MAILROOM_READ] });
    const failure = new ServiceUnavailableException(
      'Synthetic case fetch failed',
    );
    f.sync.cases.mockRejectedValue(failure);
    await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBe(failure);
  });

  it('feature-disabled GET performs no identity or Source lookup', async () => {
    f = fixture({ permissions: [MAILROOM_READ] });
    process.env.MAILROOM_ENABLED = 'false';
    await expect(f.service.sourceCases(USER, COMPANY)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(f.sync.cases).not.toHaveBeenCalled();
  });

  it.each(invalidCsrQualifications)(
    'independent mailroom read does not relax the direct CSR acceptance gate with %s',
    async (_reason, invalidate) => {
      f = fixture({ permissions: [MAILROOM_READ, ...CSR_GRANTS] });
      invalidate(f);
      await expect(
        f.service.intakeCustomerService(USER, COMPANY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );
});
