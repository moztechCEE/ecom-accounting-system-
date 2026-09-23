import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

/**
 * DTO: CreateRoleDto
 * 管理員建立新角色所需資料
 */
export class CreateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  readonly templateRoleId?: string;

  @IsString()
  @MinLength(3)
  @Matches(/^[A-Z_]+$/, {
    message: 'code must contain only uppercase letters and underscores',
  })
  readonly code: string;

  @IsString()
  @MinLength(3)
  readonly name: string;

  @IsOptional()
  @IsString()
  readonly description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly hierarchyLevel?: number;
}
