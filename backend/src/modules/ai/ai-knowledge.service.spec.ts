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

  it.each([
    ['/sales/quotations', 'purchase_orders:read'],
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
