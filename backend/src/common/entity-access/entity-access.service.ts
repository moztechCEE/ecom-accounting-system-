import { DEPARTMENT_ACCESS_SELECT, departmentAccess } from '../department-access/department-access';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type DataAccessScope = 'SELF' | 'DEPARTMENT' | 'ENTITY';

export type DataAccessModule =
  | 'employees'
  | 'attendance'
  | 'payroll'
  | 'accounting'
  | 'inventory'
  | 'sales'
  | 'purchasing'
  | 'banking';

export type UserDataAccessContext = {
  scope: DataAccessScope;
  entityId: string;
  employeeId: string | null;
  departmentId: string | null;
  noAccess: boolean;
  isSuperAdmin: boolean;
};

const DATA_SCOPE_FIELDS: Record<
  DataAccessModule,
  | 'employeeDataScope'
  | 'attendanceDataScope'
  | 'payrollDataScope'
  | 'accountingDataScope'
  | 'inventoryDataScope'
  | 'salesDataScope'
  | 'purchasingDataScope'
  | 'bankingDataScope'
> = {
  employees: 'employeeDataScope',
  attendance: 'attendanceDataScope',
  payroll: 'payrollDataScope',
  accounting: 'accountingDataScope',
  inventory: 'inventoryDataScope',
  sales: 'salesDataScope',
  purchasing: 'purchasingDataScope',
  banking: 'bankingDataScope',
};

@Injectable()
export class EntityAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getContext(
    userId: string,
    module: DataAccessModule,
    requestedEntityId?: string,
  ): Promise<UserDataAccessContext> {
    const requestedId = requestedEntityId?.trim() || undefined;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        employeeDataScope: true,
        attendanceDataScope: true,
        payrollDataScope: true,
        accountingDataScope: true,
        inventoryDataScope: true,
        salesDataScope: true,
        purchasingDataScope: true,
        bankingDataScope: true,
        employee: { select: DEPARTMENT_ACCESS_SELECT },
        entityMemberships: {
          orderBy: [{ isPrimary: 'desc' }, { entityId: 'asc' }],
          select: {
            entityId: true,
            isPrimary: true,
          },
        },
        roles: {
          select: {
            role: {
              select: { code: true, name: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const isSuperAdmin = user.roles.some(
      ({ role }) => role.code === 'SUPER_ADMIN' || role.name === 'SUPER_ADMIN',
    );
    const storedScope = this.normalizeScope(user[DATA_SCOPE_FIELDS[module]]);
    const scope = module === 'attendance' && storedScope === 'SELF' && departmentAccess(user.employee).isSupervisor
      ? 'DEPARTMENT' : storedScope;

    if (isSuperAdmin) {
      const entityId =
        requestedId ||
        user.employee?.entityId ||
        (await this.findFirstEntityId());

      if (!entityId) {
        throw new NotFoundException('No entity configured');
      }

      if (requestedId) {
        await this.assertEntityExists(requestedId);
      }

      return {
        scope,
        entityId,
        employeeId: user.employee?.id || null,
        departmentId: user.employee?.departmentId || null,
        noAccess: false,
        isSuperAdmin: true,
      };
    }

    const employee = user.employee;
    const allowedEntityIds = new Set([
      ...(employee?.entityId ? [employee.entityId] : []),
      ...user.entityMemberships.map(({ entityId }) => entityId),
    ]);
    const entityId =
      requestedId ||
      employee?.entityId ||
      user.entityMemberships.find(({ isPrimary }) => isPrimary)?.entityId ||
      user.entityMemberships[0]?.entityId ||
      '';
    const wrongEntity = !entityId || !allowedEntityIds.has(entityId);
    const missingScopeAnchor =
      scope !== 'ENTITY' &&
      (!employee?.id ||
        employee.entityId !== entityId ||
        (scope === 'DEPARTMENT' && !employee.departmentId));

    return {
      scope,
      entityId,
      employeeId: employee?.id || null,
      departmentId: employee?.departmentId || null,
      noAccess: wrongEntity || missingScopeAnchor,
      isSuperAdmin: false,
    };
  }

  async assertAccess(
    userId: string,
    module: DataAccessModule,
    entityId: string,
  ): Promise<UserDataAccessContext> {
    const requestedId = entityId?.trim();
    if (!requestedId) {
      throw new ForbiddenException('Company access could not be verified');
    }

    const context = await this.getContext(userId, module, requestedId);
    if (context.noAccess) {
      throw new ForbiddenException(
        'You do not have access to this company entity',
      );
    }
    return context;
  }

  async getAccessibleEntityIds(userId: string): Promise<string[] | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        employee: { select: { entityId: true } },
        entityMemberships: {
          orderBy: [{ isPrimary: 'desc' }, { entityId: 'asc' }],
          select: { entityId: true },
        },
        roles: {
          select: { role: { select: { code: true, name: true } } },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const isSuperAdmin = user.roles.some(
      ({ role }) => role.code === 'SUPER_ADMIN' || role.name === 'SUPER_ADMIN',
    );
    if (isSuperAdmin) {
      return null;
    }

    return [
      ...new Set([
        ...(user.employee?.entityId ? [user.employee.entityId] : []),
        ...user.entityMemberships.map(({ entityId }) => entityId),
      ]),
    ];
  }

  private normalizeScope(value?: string | null): DataAccessScope {
    return value === 'DEPARTMENT' || value === 'ENTITY' ? value : 'SELF';
  }

  private async findFirstEntityId(): Promise<string | undefined> {
    const entity = await this.prisma.entity.findFirst({
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return entity?.id;
  }

  private async assertEntityExists(entityId: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true },
    });
    if (!entity) {
      throw new NotFoundException(`Entity with ID ${entityId} not found`);
    }
  }
}
