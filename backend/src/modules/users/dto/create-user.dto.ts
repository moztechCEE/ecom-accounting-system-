import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ArrayUnique,
} from 'class-validator';

/**
 * DTO: CreateUserDto
 * 給系統管理員建立新使用者帳號用
 */
export class CreateUserDto {
  @IsEmail()
  readonly email: string;

  @IsString()
  @MinLength(8)
  readonly password: string;

  @IsString()
  readonly name: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  readonly roleIds?: string[];

  @IsOptional()
  @IsBoolean()
  readonly mustChangePassword?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['SELF', 'DEPARTMENT', 'ENTITY'])
  readonly employeeDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY';

  @IsOptional()
  @IsString()
  @IsIn(['SELF', 'DEPARTMENT', 'ENTITY'])
  readonly attendanceDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY';

  @IsOptional()
  @IsString()
  @IsIn(['SELF', 'DEPARTMENT', 'ENTITY'])
  readonly payrollDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY';
}
