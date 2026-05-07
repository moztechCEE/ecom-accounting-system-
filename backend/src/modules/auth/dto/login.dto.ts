import { IsEmail, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com', description: '使用者 Email', required: false })
  @ValidateIf((dto: LoginDto) => !dto.employeeNo)
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'tw-entity-001', description: '事業別 ID', required: false })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiProperty({ example: '0001', description: '員工代碼', required: false })
  @ValidateIf((dto: LoginDto) => !dto.email)
  @IsString()
  employeeNo?: string;

  @ApiProperty({ example: 'SecureP@ssw0rd', description: '密碼' })
  @IsString()
  @MinLength(8)
  password!: string;
}
