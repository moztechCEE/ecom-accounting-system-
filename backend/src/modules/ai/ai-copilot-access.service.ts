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
    const permissions = user.roles.flatMap(({ role }) =>
      role.permissions.map(
        ({ permission }) => `${permission.resource}:${permission.action}`,
      ),
    );
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
    return { userId, isAdmin, isSuperAdmin, permissions, tools };
  }

  canOpenPath(actor: CopilotActor, path?: string): boolean {
    if (!path) return true;
    if (actor.isAdmin) return true;
    const routes: Record<string, string[]> = {
      '/dashboard': ['reports:read', 'accounts:read', 'sales_orders:read'],
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
      '/sales/customers': ['sales_orders:read'],
      '/inventory/products': ['inventory:read'],
      '/inventory/sn-labels': ['inventory:read'],
      '/warehouse': ['wms_tasks:read'],
      '/vendors': ['purchase_orders:read', 'accounts:read'],
      '/purchasing/orders': ['purchase_orders:read'],
      '/banking': ['banking:read'],
      '/payroll/employees': ['employees_admin:read'],
      '/payroll/runs': ['payroll_self:read', 'payroll_admin:read'],
      '/attendance/dashboard': ['attendance_self:read'],
      '/attendance/leaves': ['leave_self:read'],
      '/profile': ['profile_self:read'],
      '/accounting/workbench': ['accounts:read', 'journal_entries:read'],
      '/reports': ['reports:read'],
      '/reconciliation': ['banking:read', 'reports:read', 'accounts:read'],
    };
    return (routes[path] || []).some((permission) =>
      actor.permissions.includes(permission),
    );
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
