import { AiKnowledgeService } from './ai-knowledge.service';
import {
  AiCopilotAccessService,
  type CopilotActor,
} from './ai-copilot-access.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { EntityAccessService } from '../../common/entity-access/entity-access.service';

const actor = (
  permissions: string[] = [],
  roles = ['EMPLOYEE'],
): CopilotActor => ({
  userId: 'user-a',
  roles,
  permissions,
  tools: [],
  isSuperAdmin: roles.includes('SUPER_ADMIN'),
  isAdmin: roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)),
});

describe('Knowledge ACL and route parity', () => {
  const access = new AiCopilotAccessService(
    {} as PrismaService,
    {} as EntityAccessService,
  );
  const knowledge = new AiKnowledgeService();

  it('fails closed without a server authorization policy', () => {
    expect(knowledge.search('')).toEqual([]);
  });

  it('requires dedicated permissions before offering cost and compensation tools', async () => {
    const grants = ['inventory:read', 'payroll_admin:read'];
    const findUnique = jest.fn().mockImplementation(async () => ({
      isActive: true,
      roles: [{ role: {
        code: 'MANAGER',
        permissions: grants.map((grant) => {
          const [resource, action] = grant.split(':');
          return { permission: { resource, action } };
        }),
      } }],
    }));
    const service = new AiCopilotAccessService(
      { user: { findUnique } } as unknown as PrismaService,
      { assertAccess: jest.fn() } as unknown as EntityAccessService,
    );
    const manager = await service.getActor('manager');
    expect(manager.tools).not.toContain('get_product_cost');
    expect(manager.tools).not.toContain('get_payroll_summary');
    grants.push('product_cost:read');
    expect((await service.getActor('manager')).tools).toContain('get_product_cost');
    grants.push('employee_compensation:read');
    expect((await service.getActor('manager')).tools).toContain('get_payroll_summary');
  });

  it('refuses finance AI briefing without net-profit permission', async () => {
    const assertAccess = jest.fn();
    const service = new AiCopilotAccessService(
      {} as PrismaService,
      { assertAccess } as unknown as EntityAccessService,
    );
    await expect(service.authorizeBriefing(actor(['reports:read']), 'entity-a')).rejects.toThrow('財務淨利');
    expect(assertAccess).not.toHaveBeenCalled();
  });

  it.each([
    { permissions: ['expense_self:read'], roles: ['EMPLOYEE'], visible: true },
    { permissions: [], roles: ['EMPLOYEE'], visible: true },
    {
      permissions: [
        'wms_tasks:read',
        'wms_picking:execute',
        'expense_self:read',
      ],
      roles: ['EMPLOYEE'],
      visible: false,
    },
    {
      permissions: ['wms_tasks:read', 'inventory:read'],
      roles: ['EMPLOYEE'],
      visible: true,
    },
    {
      permissions: ['wms_tasks:read', 'wms_overview:read'],
      roles: ['EMPLOYEE'],
      visible: true,
    },
    { permissions: ['wms_tasks:read'], roles: ['ADMIN'], visible: true },
  ])(
    'matches dashboard navigation for $roles with $permissions',
    ({ permissions, roles, visible }) => {
      const current = actor(permissions, roles);
      expect(access.canOpenPath(current, '/dashboard')).toBe(visible);
      const results = knowledge.search(
        '這頁怎麼用',
        512,
        '/dashboard',
        'zh-TW',
        (entry) => access.canReadKnowledge(current, entry),
      );
      expect(results.some((entry) => entry.id === 'dashboard')).toBe(visible);
      if (visible) expect(results[0].id).toBe('dashboard');
    },
  );

  it('does not grant financial tools or expand expense scope through dashboard guide access', async () => {
    const assertAccess = jest.fn().mockResolvedValue({
      entityId: 'entity-a',
      scope: 'ENTITY',
      departmentId: 'dept-a',
      isSuperAdmin: false,
    });
    const service = new AiCopilotAccessService(
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: true,
            roles: [
              {
                role: {
                  code: 'EMPLOYEE',
                  permissions: [
                    {
                      permission: { resource: 'expense_self', action: 'read' },
                    },
                  ],
                },
              },
            ],
          }),
        },
      } as unknown as PrismaService,
      { assertAccess } as unknown as EntityAccessService,
    );
    const employee = await service.getActor('user-a');
    expect(service.canOpenPath(employee, '/dashboard')).toBe(true);
    expect(employee.tools).toEqual(['get_expense_stats']);
    await expect(
      service.authorize(employee, 'get_sales_stats', 'entity-a'),
    ).rejects.toThrow();
    expect(assertAccess).not.toHaveBeenCalled();
    await expect(
      service.authorize(employee, 'get_expense_stats', 'entity-a'),
    ).resolves.toEqual({
      entityId: 'entity-a',
      filter: { createdBy: 'user-a' },
      scope: '自己的費用申請',
    });
  });

  it.each([
    ['/operations/repair?queue=waiting', 'repair_workbench:read'],
    ['/operations/mailroom', 'mailroom:read'],
    ['/sales/quotations', 'purchase_orders:read'],
    ['/purchasing/b2b-shortages', 'purchase_orders:create'],
    ['/purchasing/supplier-accounts', 'purchase_orders:read'],
    ['/sales/invoices', 'accounts:read'],
    ['/sales/after-sales/quotes', 'after_sales_cases:read'],
    ['/manufacturing/assembly', 'inventory:read'],
    ['/accounting/accounts', 'accounts:read'],
    ['/accounting/journals', 'journal_entries:read'],
    ['/accounting/periods', 'accounts:read'],
    ['/reconciliation/timeout', 'reconciliation_timeout:read'],
    ['/attendance/admin', 'attendance_admin:read'],
  ])('requires the relevant permission for %s', (path, permission) => {
    expect(access.canOpenPath(actor(), path)).toBe(false);
    expect(access.canOpenPath(actor([permission]), path)).toBe(true);
  });

  it('keeps repair and mailroom guidance separated and inbox guidance personal', () => {
    const technician = actor(['repair_workbench:read', 'repair_workbench:update'], ['REPAIR_TECHNICIAN']);
    const clerk = actor(['mailroom:read', 'mailroom:update'], ['MAILROOM_OPERATOR']);
    const reviewer = actor(['mailroom:review'], ['CUSTOMER_SERVICE']);
    expect(access.canOpenPath(technician, '/operations/mailroom')).toBe(false);
    expect(access.canOpenPath(clerk, '/operations/repair')).toBe(false);
    expect(access.canOpenPath(reviewer, '/operations/repair?queue=waiting')).toBe(false);
    expect(access.canOpenPath(actor(['repair_workbench:update']), '/operations/repair')).toBe(false);
    for (const current of [actor(), technician, clerk, reviewer])
      expect(access.canOpenPath(current, '/my/inbox')).toBe(true);
    expect(access.canOpenPath({ ...actor(), userId: '' }, '/my/inbox')).toBe(false);
    const results = knowledge.search('', 512, '/operations/repair', 'zh-TW',
      (entry) => access.canReadKnowledge(technician, entry));
    expect(results.some((entry) => entry.id === 'repair-workbench')).toBe(true);
    expect(results.some((entry) => entry.id === 'mailroom-workbench')).toBe(false);
    expect(results.some((entry) => entry.id === 'personal-inbox')).toBe(true);
    const related = results.find((entry) => entry.id === 'repair-workbench')!.sections
      .find((section) => section.title === '相關指南')!.body;
    expect(related).not.toContain('/operations/mailroom');
    expect(related).not.toContain('/admin/access-control');
  });

  it('matches the enabled repair-only workspace without hiding a mixed-duty dashboard', () => {
    const previous = process.env.MAILROOM_ENABLED;
    try {
      const technician = actor(['repair_workbench:read', 'repair_workbench:update', 'profile_self:read'], ['REPAIR_TECHNICIAN']);
      process.env.MAILROOM_ENABLED = 'true';
      expect(access.canOpenPath(technician, '/dashboard')).toBe(false);
      expect(access.canOpenPath(actor([...technician.permissions, 'inventory:read']), '/dashboard')).toBe(true);
      expect(access.canOpenPath(actor(technician.permissions, ['ADMIN']), '/dashboard')).toBe(true);
      process.env.MAILROOM_ENABLED = 'false';
      expect(access.canOpenPath(technician, '/dashboard')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.MAILROOM_ENABLED;
      else process.env.MAILROOM_ENABLED = previous;
    }
  });

  it('does not register live AI operations when repair guide access is granted', async () => {
    const grants = ['repair_workbench:read', 'repair_workbench:update'];
    const service = new AiCopilotAccessService({ user: {
      findUnique: jest.fn().mockResolvedValue({ isActive: true, roles: [{ role: {
        code: 'REPAIR_TECHNICIAN', permissions: grants.map((grant) => {
          const [resource, action] = grant.split(':');
          return { permission: { resource, action } };
        }),
      } }] }),
    } } as unknown as PrismaService, {} as EntityAccessService);
    const technician = await service.getActor('technician');
    expect(service.canOpenPath(technician, '/operations/repair')).toBe(true);
    expect(technician.tools).toEqual([]);
    await expect(service.authorize(technician, 'repair_workbench:update', 'entity-a')).rejects.toThrow();
  });

  it('keeps company administration superadmin-only and unknown destinations closed', () => {
    expect(access.canOpenPath(actor([], ['ADMIN']), '/admin/entities')).toBe(
      false,
    );
    expect(
      access.canOpenPath(actor([], ['SUPER_ADMIN']), '/admin/entities'),
    ).toBe(true);
    for (const path of [
      '/unregistered',
      'https://evil.example',
      '//evil.example',
      '/admin/../profile',
    ]) {
      expect(access.canOpenPath(actor([], ['SUPER_ADMIN']), path)).toBe(false);
    }
  });

  it('combines explicit role, module and destination requirements', () => {
    const entry = {
      path: '/admin/entities',
      roles: ['SUPER_ADMIN'],
      permissions: ['access_control:read'],
    };
    expect(
      access.canReadKnowledge(actor(['access_control:read'], ['ADMIN']), entry),
    ).toBe(false);
    expect(access.canReadKnowledge(actor([], ['SUPER_ADMIN']), entry)).toBe(
      true,
    );
    expect(access.canReadKnowledge(actor(), { roles: ['ACCOUNTANT'] })).toBe(
      false,
    );
    expect(access.canReadKnowledge(actor(), {})).toBe(true);
  });

  it('enforces WMS root, station, management and administrative boundaries', () => {
    expect(
      access.canOpenPath(actor(['wms_picking:execute']), '/warehouse/picking'),
    ).toBe(false);
    const picker = actor(['wms_tasks:read', 'wms_picking:execute']);
    expect(access.canOpenPath(picker, '/warehouse/picking')).toBe(true);
    expect(access.canOpenPath(picker, '/warehouse/packing')).toBe(false);
    expect(access.canOpenPath(picker, '/warehouse/workstation')).toBe(false);
    expect(
      access.canOpenPath(
        actor([...picker.permissions, 'wms_overview:read']),
        '/warehouse/workstation',
      ),
    ).toBe(true);
    for (const path of [
      '/warehouse/users',
      '/warehouse/logistics',
      '/warehouse/settings',
    ])
      expect(access.canOpenPath(picker, path)).toBe(false);
    expect(
      access.canOpenPath(
        actor(['wms_tasks:read', 'access_control:read']),
        '/warehouse/settings',
      ),
    ).toBe(true);
  });

  it('filters before ranking and removes inaccessible related destinations', () => {
    const employee = actor(['expense_self:read', 'profile_self:read']);
    const entries = knowledge.search(
      '',
      512,
      '/admin/settings',
      'zh-TW',
      (entry) => access.canReadKnowledge(employee, entry),
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.id === 'expense-requests')).toBe(true);
    expect(entries.some((entry) => entry.id === 'system-settings')).toBe(false);
    expect(JSON.stringify(entries)).not.toContain('/admin/settings');
    expect(JSON.stringify(entries)).not.toContain('/admin/access-control');
  });
});
