import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

type ImportRowValue = string | number | boolean | null;

export class ImportProviderPayoutsDto {
  @ApiProperty({
    description: '公司實體 ID',
    example: 'tw-entity-001',
  })
  @IsString()
  entityId!: string;

  @ApiProperty({
    description: '金流供應商',
    enum: ['ecpay', 'hitrust', 'linepay', 'shoplinepay'],
  })
  @IsIn(['ecpay', 'hitrust', 'linepay', 'shoplinepay'])
  provider!: 'ecpay' | 'hitrust' | 'linepay' | 'shoplinepay';

  @ApiPropertyOptional({
    description: '匯入來源型態',
    enum: ['statement', 'reconciliation'],
    default: 'statement',
  })
  @IsOptional()
  @IsIn(['statement', 'reconciliation'])
  sourceType?: 'statement' | 'reconciliation';

  @ApiPropertyOptional({
    description: '原始檔名',
    example: 'ecpay-payout-2026-04.csv',
  })
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiProperty({
    description:
      '原始報表列資料。可直接傳 CSV / XLSX 轉成的 JSON 列，每列欄位名稱保留原始表頭即可。',
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
      },
    },
  })
  @IsArray()
  rows!: Record<string, ImportRowValue>[];

  @ApiPropertyOptional({
    description:
      '自訂欄位映射。key 為系統欄位，value 可為單一欄位名或欄位名陣列。',
    type: 'object',
    additionalProperties: {
      oneOf: [
        { type: 'string' },
        {
          type: 'array',
          items: { type: 'string' },
        },
      ],
    },
  })
  @IsOptional()
  @IsObject()
  mapping?: Record<string, string | string[]>;

  @ApiPropertyOptional({
    description: '批次備註',
    example: '2026/04 第一次匯入綠界撥款明細',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
