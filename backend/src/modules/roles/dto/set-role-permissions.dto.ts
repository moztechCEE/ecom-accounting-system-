import { ArrayUnique, IsArray, IsString, MinLength } from 'class-validator';

/**
 * DTO: SetRolePermissionsDto
 * 更新角色的權限列表
 */
export class SetRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  readonly permissionIds: string[];
}
