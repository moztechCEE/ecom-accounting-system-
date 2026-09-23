import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PermissionsGuard
 * 檢查使用者是否擁有所需的權限
 *
 * 權限格式: resource:action
 * 範例:
 * - accounts:read
 * - journal_entries:create
 * - sales_orders:approve
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 取得 @RequirePermissions() decorator 設定的權限
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 如果沒有設定權限要求，直接通過
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    // 取得當前使用者
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // 查詢使用者的所有權限（透過角色）
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (
      userRoles.some((userRole) =>
        ['SUPER_ADMIN', 'ADMIN'].includes(userRole.role.code),
      )
    ) {
      return true;
    }

    // Fresh department grants are loaded by JwtStrategy, never supplied by the client.
    const departmentPermissions: string[] = user.effectivePermissions || [];

    // 收集所有權限
    const userPermissions: string[] = [...departmentPermissions];
    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.permissions) {
        const permission = rolePermission.permission;
        userPermissions.push(`${permission.resource}:${permission.action}`);
      }
    }

    // Managing access includes reading the users, roles and permissions needed
    // by that workflow; it does not imply read access to other modules.
    if (userPermissions.includes('access_control:update')) {
      userPermissions.push('access_control:read');
    }

    if (userPermissions.includes('attendance_admin:read')) userPermissions.push('attendance_team:read');
    if (userPermissions.includes('attendance_admin:update')) userPermissions.push('attendance_team:review');

    // 檢查是否擁有所有所需權限
    const hasAllPermissions = requiredPermissions.every((perm) =>
      userPermissions.includes(perm),
    );

    if (!hasAllPermissions) {
      const missingPermissions = requiredPermissions.filter(
        (perm) => !userPermissions.includes(perm),
      );
      throw new ForbiddenException(
        `Missing permissions: [${missingPermissions.join(', ')}]`,
      );
    }

    return true;
  }
}
