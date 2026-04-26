import { IsString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IssueInvoiceDto {
  @ApiPropertyOptional({
    description:
      '綠界電子發票帳號 key；Shopify 官網用 shopify-main，1Shop / 團購用 groupbuy-main',
    example: 'shopify-main',
  })
  @IsOptional()
  @IsString()
  merchantKey?: string;

  @ApiPropertyOptional({
    description: '綠界商店代號；3290494 或 3150241',
    example: '3290494',
  })
  @IsOptional()
  @IsString()
  merchantId?: string;

  @ApiProperty({
    description: '交易ID',
    example: 'uuid-of-transaction',
  })
  @IsUUID()
  transactionId: string;

  @ApiProperty({
    description: '交易類型',
    enum: ['order', 'payment', 'refund'],
    example: 'order',
  })
  @IsEnum(['order', 'payment', 'refund'])
  transactionType: string;

  @ApiProperty({
    description: '發票類型',
    enum: ['B2C', 'B2B'],
    example: 'B2C',
    required: false,
  })
  @IsOptional()
  @IsEnum(['B2C', 'B2B'])
  invoiceType?: string;

  @ApiProperty({
    description: '買方名稱',
    example: '王小明',
  })
  @IsString()
  buyerName: string;

  @ApiProperty({
    description: '買方統一編號（B2B必填）',
    example: '12345678',
    required: false,
  })
  @IsOptional()
  @IsString()
  buyerTaxId?: string;

  @ApiProperty({
    description: '買方地址（B2B必填）',
    example: '台北市信義區信義路五段7號',
    required: false,
  })
  @IsOptional()
  @IsString()
  buyerAddress?: string;

  @ApiProperty({
    description: '買方email（用於寄送發票）',
    example: 'customer@example.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  buyerEmail?: string;

  @ApiProperty({
    description: '買方手機（用於簡訊通知）',
    example: '0912345678',
    required: false,
  })
  @IsOptional()
  @IsString()
  buyerPhone?: string;
}
