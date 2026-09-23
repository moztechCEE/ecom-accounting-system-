import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsUUID,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  IsIn,
  IsObject,
  IsArray,
  ValidateNested,
  IsDate,
  IsEnum,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export class EvidenceFileDto {
  @ApiProperty({ description: '檔案名稱' })
  @IsString()
  @MaxLength(250)
  name!: string;

  @ApiProperty({ description: '檔案 URL' })
  @IsString()
  @MaxLength(7_000_000)
  url!: string;

  @ApiPropertyOptional({ description: '檔案類型' })
  @IsOptional()
  @IsString()
  mimeType?: string;
}

export class CreateExpenseRequestDto {
  @ApiProperty({ description: '公司實體 ID' })
  @IsString()
  entityId!: string;

  @ApiPropertyOptional({ description: '受款人類型', enum: ['employee', 'vendor'] })
  @IsOptional()
  @IsIn(['employee', 'vendor'])
  payeeType?: string;

  @ApiPropertyOptional({ description: '付款方式', enum: ['cash', 'bank_transfer', 'check', 'other'] })
  @IsOptional()
  @IsIn(['cash', 'bank_transfer', 'check', 'other'])
  paymentMethod?: string;

  @ApiPropertyOptional({ description: '供應商 ID' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ description: '報銷項目 ID' })
  @IsOptional()
  @IsUUID()
  reimbursementItemId?: string;

  @ApiProperty({ description: '原始金額' })
  @IsNumber()
  @Min(0)
  amountOriginal!: number;

  @ApiPropertyOptional({ description: '幣別，預設 TWD' })
  @IsOptional()
  @IsString()
  amountCurrency?: string;

  @ApiPropertyOptional({ description: '稅別', enum: TaxType })
  @IsOptional()
  @IsEnum(TaxType)
  taxType?: TaxType;

  @ApiPropertyOptional({ description: '稅額' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @ApiPropertyOptional({ description: '匯率，預設 1' })
  @IsOptional()
  @IsNumber()
  amountFxRate?: number;

  @ApiPropertyOptional({ description: '到期日' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @ApiProperty({ description: '費用描述' })
  @IsString()
  description!: string;

  @ApiPropertyOptional({ description: '備註' })
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional({ description: '優先順序', enum: ['normal', 'urgent'] })
  @IsOptional()
  @IsIn(['normal', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ description: '附件主檔 URL' })
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @ApiPropertyOptional({ description: '憑證資料', type: [EvidenceFileDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => EvidenceFileDto)
  evidenceFiles?: EvidenceFileDto[];

  @ApiPropertyOptional({ description: '部門 ID' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: '預設發票/收據類型' })
  @IsOptional()
  @IsString()
  receiptType?: string;

  @ApiPropertyOptional({ description: '額外的自訂欄位 JSON' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
