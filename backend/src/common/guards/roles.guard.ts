import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * RolesGuard
 * 檢查使用者是否擁有所需的角色
 *
 * 支援三種角色：
 * - ADMIN: 系統管理員（最高權限）
 * - ACCOUNTANT: 會計人員（可查看、建立、審核會計相關資料）
 * - OPERATOR: 操作員（可查看、建立訂單等基本操作）
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 取得 @Roles() decorator 設定的角色
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 如果沒有設定 @Roles()，表示不需要角色檢查
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // 取得當前使用者（由 JwtAuthGuard 設定）
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // 查詢使用者的角色
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });

    const userRoleNames = userRoles.flatMap((ur) => {
      const roleNames = [ur.role.code, ur.role.name].filter(Boolean);
      return roleNames;
    });

    // 檢查是否擁有任一所需角色
    const hasRole = requiredRoles.some((role) => userRoleNames.includes(role));

    if (!hasRole) {
      throw new ForbiddenException(
        `User does not have required roles. Required: [${requiredRoles.join(', ')}], Has: [${userRoleNames.join(', ')}]`,
      );
    }

    return true;
  }
}
