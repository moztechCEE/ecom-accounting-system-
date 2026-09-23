import { ArrayUnique, IsArray, IsString, MinLength } from 'class-validator';

/**
 * DTO: SetUserRolesDto
 * 替使用者重新指派角色
 */
export class SetUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  readonly roleIds: string[];
}
