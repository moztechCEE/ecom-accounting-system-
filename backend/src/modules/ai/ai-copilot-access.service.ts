import { DEPARTMENT_ACCESS_SELECT, effectivePermissionKeys } from '../../common/department-access/department-access';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  DataAccessModule,
  EntityAccessService,
} from '../../common/entity-access/entity-access.service';

const TOOL_ACCESS: Record<
  string,
  { module: DataAccessModule; permissions: string[]; sensitive?: boolean }
> = {
  get_sales_stats: { module: 'sales', permissions: ['sales_orders:read'] },
  find_sales_order: { module: 'sales', permissions: ['sales_orders:read'] },
  find_customer: { module: 'sales', permissions: ['sales_orders:read'] },
  find_product: { module: 'inventory', permissions: ['inventory:read'] },
  get_product_cost: {
    module: 'inventory',
    permissions: ['inventory:read'],
    sensitive: true,
  },
  find_vendor: {
    module: 'purchasing',
    permissions: ['purchase_orders:read', 'accounts:read'],
  },
  get_expense_stats: {
    module: 'accounting',
    permissions: ['expense_self:read', 'accounts:read', 'purchase_orders:read'],
  },
  get_bank_balances: {
    module: 'banking',
    permissions: ['banking:read'],
    sensitive: true,
  },
  get_payroll_summary: {
    module: 'payroll',
    permissions: ['payroll_admin:read'],
    sensitive: true,
  },
};

export type CopilotActor = {
  userId: string;
  roles: string[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
  permissions: string[];
  tools: string[];
};

@Injectable()
export class AiCopilotAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entityAccess: EntityAccessService,
  ) {}

  async getActor(userId: string): Promise<CopilotActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isActive: true,
        employee: { select: DEPARTMENT_ACCESS_SELECT },
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });
    if (!user?.isActive) throw new ForbiddenException('帳號無法使用 Copilot');
    const codes = user.roles.map(({ role }) => role.code);
    const isSuperAdmin = codes.includes('SUPER_ADMIN');
    const isAdmin = isSuperAdmin || codes.includes('ADMIN');
    const permissions = effectivePermissionKeys(user);
    const tools = Object.entries(TOOL_ACCESS)
      .filter(
        ([, rule]) =>
          (!rule.sensitive || isSuperAdmin) &&
          (isAdmin ||
            rule.permissions.some((permission) =>
              permissions.includes(permission),
            )),
      )
      .map(([tool]) => tool);
    return { userId, roles: codes, isAdmin, isSuperAdmin, permissions, tools };
  }

  canOpenPath(actor: CopilotActor, path?: string): boolean {
    if (!path) return true;
    // Only reviewed local routes can become guide destinations, even for admins.
    if (
      !/^\/[a-zA-Z0-9/_-]+(?:\?[^#\\\s]*)?$/.test(path) ||
      path.startsWith('//')
    )
      return false;
    const pathname = path.split('?')[0];
    if (pathname === '/auth/change-password') return true;
    // Match frontend/config/workspaces.ts: dashboard navigation is available
    // to signed-in users except warehouse-only operators. This is guide access,
    // not authorization for dashboard metrics or any live Copilot data tool.
    if (pathname === '/dashboard') return !this.isWarehouseOnlyActor(actor);
    if (pathname === '/admin/entities') return actor.isSuperAdmin;
    if (
      [
        '/admin/settings',
        '/admin/reimbursement-items',
        '/admin/after-sales-brands',
        '/import',
      ].includes(pathname)
    )
      return actor.isAdmin;
    const routes: Record<string, string[]> = {
      '/ap/expenses': [
        'expense_self:read',
        'accounts:read',
        'purchase_orders:read',
      ],
      '/ap/expense-review': [
        'expense_self:read',
        'accounts:read',
        'purchase_orders:read',
      ],
      '/ap/payable': ['accounts:read', 'purchase_orders:read'],
      '/admin/reimbursement-items': [],
      '/admin/settings': [],
      '/admin/access-control': ['access_control:read', 'access_control:update'],
      '/sales/orders': ['sales_orders:read'],
      '/sales/quotations': ['sales_orders:read', 'purchase_orders:read'],
      '/sales/invoices': ['sales_orders:read', 'accounts:read'],
      '/sales/after-sales': ['after_sales_cases:read', 'sales_orders:read'],
      '/sales/after-sales/quotes': ['after_sales_cases:read'],
      '/sales/after-sales/internal': ['after_sales_cases:read'],
      '/sales/customers': ['sales_orders:read'],
      '/inventory/products': ['inventory:read'],
      '/inventory/sn-labels': ['inventory:read'],
      '/manufacturing/assembly': ['inventory:read'],
      '/warehouse': ['wms_tasks:read'],
      '/warehouse/workstation': ['wms_tasks:read'],
      '/warehouse/picking': ['wms_picking:execute'],
      '/warehouse/packing': ['wms_packing:execute'],
      '/warehouse/completed': ['wms_tasks:read'],
      '/warehouse/dispatch': ['wms_orders:create'],
      '/warehouse/marketplace': ['wms_orders:create'],
      '/warehouse/intakes': [
        'wms_orders:create',
        'wms_picking:execute',
        'wms_packing:execute',
      ],
      '/warehouse/overview': ['wms_overview:read'],
      '/warehouse/logs': ['wms_logs:read'],
      '/warehouse/exceptions': ['wms_exceptions:read'],
      '/warehouse/scan-errors': ['wms_scan_errors:read'],
      '/warehouse/defects': ['wms_defects:read'],
      '/warehouse/team': ['wms_tasks:read'],
      '/warehouse/settings': ['wms_tasks:read'],
      '/warehouse/logistics': [],
      '/warehouse/users': [],
      '/vendors': ['purchase_orders:read', 'accounts:read'],
      '/purchasing/orders': ['purchase_orders:read'],
      '/banking': ['banking:read'],
      '/payroll/employees': ['employees_admin:read'],
      '/payroll/runs': ['payroll_self:read', 'payroll_admin:read'],
      '/attendance/dashboard': ['attendance_self:read'],
      '/attendance/leaves': ['leave_self:read'],
      '/attendance/admin': ['attendance_admin:read', 'attendance_team:read'],
      '/profile': ['profile_self:read'],
      '/accounting/workbench': ['accounts:read', 'journal_entries:read'],
      '/accounting/accounts': ['accounts:read'],
      '/accounting/periods': ['accounts:read'],
      '/accounting/journals': ['journal_entries:read'],
      '/reports': ['reports:read'],
      '/reconciliation': ['banking:read', 'reports:read', 'accounts:read'],
      '/reconciliation/timeout': [
        'reconciliation_timeout:read',
        'accounts:read',
        'journal_entries:read',
      ],
    };
    if (!Object.prototype.hasOwnProperty.call(routes, pathname)) return false;
    if (actor.isAdmin) return true;
    if (
      pathname.startsWith('/warehouse/') &&
      !actor.permissions.includes('wms_tasks:read')
    )
      return false;
    if (pathname === '/warehouse/workstation') {
      const management = [
        'wms_overview:read',
        'wms_logs:read',
        'wms_exceptions:read',
        'wms_scan_errors:read',
        'wms_defects:read',
      ];
      const operations = [
        'wms_orders:create',
        'wms_picking:execute',
        'wms_packing:execute',
      ];
      return (
        management.some((permission) =>
          actor.permissions.includes(permission),
        ) &&
        operations.some((permission) => actor.permissions.includes(permission))
      );
    }
    if (
      pathname === '/warehouse/settings' &&
      !['access_control:read', 'access_control:update'].some((permission) =>
        actor.permissions.includes(permission),
      )
    )
      return false;
    return routes[pathname].some((permission) =>
      actor.permissions.includes(permission),
    );
  }

  private isWarehouseOnlyActor(actor: CopilotActor): boolean {
    if (actor.isAdmin || !actor.permissions.includes('wms_tasks:read'))
      return false;
    const management = [
      'wms_overview:read',
      'wms_logs:read',
      'wms_exceptions:read',
      'wms_scan_errors:read',
      'wms_defects:read',
    ];
    if (management.some((permission) => actor.permissions.includes(permission)))
      return false;
    const personal = [
      'attendance_self:read',
      'leave_self:read',
      'profile_self:read',
      'expense_self:read',
      'expense_self:create',
    ];
    return !actor.permissions.some(
      (permission) =>
        !permission.startsWith('wms_') && !personal.includes(permission),
    );
  }

  actorVersion(actor: CopilotActor): string {
    return JSON.stringify([
      actor.userId,
      [...actor.roles].sort(),
      [...new Set(actor.permissions)].sort(),
      [...actor.tools].sort(),
    ]);
  }

  canReadKnowledge(
    actor: CopilotActor,
    entry: { path?: string; permissions?: string[]; roles?: string[] },
  ): boolean {
    if (
      entry.roles?.length &&
      !entry.roles.some((role) =>
        role === 'SUPER_ADMIN'
          ? actor.isSuperAdmin
          : role === 'ADMIN'
            ? actor.isAdmin
            : actor.roles.includes(role),
      )
    )
      return false;
    if (
      entry.permissions?.length &&
      !actor.isAdmin &&
      !entry.permissions.some((permission) =>
        actor.permissions.includes(permission),
      )
    )
      return false;
    return this.canOpenPath(actor, entry.path);
  }

  async authorizeBriefing(actor: CopilotActor, entityId: string) {
    const resolvedId = typeof entityId === 'string' ? entityId.trim() : '';
    if (!resolvedId) throw new ForbiddenException('請先選取公司再查詢每日簡報');
    if (!actor.isAdmin && !actor.permissions.includes('reports:read')) {
      throw new ForbiddenException('每日簡報需要財務報表查詢權限');
    }
    for (const module of ['accounting', 'sales'] as const) {
      const context = await this.entityAccess.assertAccess(
        actor.userId,
        module,
        resolvedId,
      );
      if (!context.isSuperAdmin && context.scope !== 'ENTITY')
        throw new ForbiddenException(
          '每日簡報需要公司範圍的財務與銷售資料權限',
        );
    }
    return resolvedId;
  }

  async authorize(actor: CopilotActor, tool: string, entityId?: string) {
    const rule = TOOL_ACCESS[tool];
    if (!rule || !actor.tools.includes(tool))
      throw new ForbiddenException('目前沒有這項資料的查詢權限');
    if (!entityId) throw new ForbiddenException('請先選取公司，再查詢即時資料');
    const context = await this.entityAccess.assertAccess(
      actor.userId,
      rule.module,
      entityId,
    );
    if (rule.sensitive && !context.isSuperAdmin)
      throw new ForbiddenException('敏感資料查詢權限已變更');
    if (tool === 'get_expense_stats') {
      const managesExpenses =
        actor.isAdmin ||
        actor.permissions.some((p) =>
          ['accounts:read', 'purchase_orders:read'].includes(p),
        );
      if (
        !managesExpenses ||
        (!context.isSuperAdmin && context.scope === 'SELF')
      ) {
        return {
          entityId: context.entityId,
          filter: { createdBy: actor.userId },
          scope: '自己的費用申請',
        };
      }
      if (!context.isSuperAdmin && context.scope === 'DEPARTMENT') {
        return {
          entityId: context.entityId,
          filter: { departmentId: context.departmentId! },
          scope: '所屬部門的費用申請',
        };
      }
      return {
        entityId: context.entityId,
        filter: {},
        scope: '所選公司的費用申請',
      };
    }
    // These records have no consistent user/department ownership in the ERP schema.
    // Never silently widen SELF or DEPARTMENT to the whole company.
    if (!context.isSuperAdmin && context.scope !== 'ENTITY') {
      throw new ForbiddenException(
        '此查詢需要公司範圍的資料權限；目前 Copilot 無法安全整理個人或部門範圍，請使用原功能頁面',
      );
    }
    return { entityId: context.entityId, filter: {}, scope: '所選公司' };
  }
}
