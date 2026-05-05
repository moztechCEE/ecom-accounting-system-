import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

export interface PermissionRequirement {
  resource: string;
  action: string;
}

/**
 * RequirePermissions 裝飾器
 * 標記需要特定權限才能存取的路由
 *
 * @param permissions - 需要的權限列表
 *
 * @example
 * ```typescript
 * @RequirePermissions({ resource: 'sales_orders', action: 'create' })
 * @Post()
 * async createOrder() {
 *   // 需要 sales_orders:create 權限
 * }
 * ```
 */
export const RequirePermissions = (...permissions: PermissionRequirement[]) =>
  SetMetadata(
    PERMISSIONS_KEY,
    permissions.map((permission) => `${permission.resource}:${permission.action}`),
  );
