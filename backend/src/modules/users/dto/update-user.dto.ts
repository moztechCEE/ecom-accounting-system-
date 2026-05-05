import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * DTO: UpdateUserDto
 * 更新使用者基本資料或重設密碼
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  readonly name?: string;

  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  readonly password?: string;

  @IsOptional()
  @IsBoolean()
  readonly mustChangePassword?: boolean;
}
