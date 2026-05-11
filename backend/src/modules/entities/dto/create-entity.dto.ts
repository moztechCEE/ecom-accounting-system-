import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsEmail,
  MinLength,
} from 'class-validator';

export class CreateEntityDto {
  @ApiProperty({ example: '900324', description: '登入使用的事業代號（唯一）' })
  @IsString()
  @IsNotEmpty()
  loginCode: string;

  @ApiProperty({ example: '台灣總公司', description: '實體名稱' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'TWD', description: '基礎貨幣' })
  @IsString()
  @IsNotEmpty()
  baseCurrency: string;

  @ApiProperty({ example: 'TW', description: '國家代碼' })
  @IsString()
  @IsNotEmpty()
  country: string;

  @ApiProperty({
    example: '12345678',
    description: '統一編號',
    required: false,
  })
  @IsString()
  @IsOptional()
  taxId?: string;

  @ApiProperty({
    example: true,
    description: '是否啟用',
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({
    example: '台北市信義區信義路五段7號',
    description: '公司地址',
    required: false,
  })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiProperty({
    example: 'ops@example.com',
    description: '聯絡信箱',
    required: false,
  })
  @IsString()
  @IsOptional()
  contactEmail?: string;

  @ApiProperty({
    example: '+886-2-2345-6789',
    description: '聯絡電話',
    required: false,
  })
  @IsString()
  @IsOptional()
  contactPhone?: string;

  @ApiProperty({
    example: '公司管理員',
    description: '首位公司管理員姓名',
    required: false,
  })
  @IsString()
  @IsOptional()
  adminName?: string;

  @ApiProperty({
    example: 'admin@example.com',
    description: '首位公司管理員登入信箱',
    required: false,
  })
  @IsEmail()
  @IsOptional()
  adminEmail?: string;

  @ApiProperty({
    example: '0001',
    description: '首位公司管理員員工代號',
    required: false,
  })
  @IsString()
  @IsOptional()
  adminEmployeeNo?: string;

  @ApiProperty({
    example: 'TempPass123',
    description: '首位公司管理員初始密碼',
    required: false,
  })
  @IsString()
  @MinLength(8)
  @IsOptional()
  adminPassword?: string;
}
