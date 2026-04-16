import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class SyncEcpayShopifyPayoutsDto {
  @ApiPropertyOptional({
    description: '公司實體 ID。未提供時會退回 SHOPIFY_DEFAULT_ENTITY_ID。',
    example: 'tw-entity-001',
  })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({
    description:
      '綠界 Shopify PaymentID。提供後會改走單筆查詢，不再使用日期區間。',
    example: 'ASDFshopifyPaymentId123',
  })
  @IsOptional()
  @IsString()
  paymentId?: string;

  @ApiPropertyOptional({
    description: '查詢開始日期，格式 yyyy-MM-dd。',
    example: '2026-04-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  beginDate?: string;

  @ApiPropertyOptional({
    description: '查詢結束日期，格式 yyyy-MM-dd。',
    example: '2026-04-16',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @ApiPropertyOptional({
    description: '查詢日期類別。1=結算日期，2=撥款日期。',
    enum: ['1', '2'],
    default: '2',
  })
  @IsOptional()
  @IsIn(['1', '2'])
  dateType?: '1' | '2';

  @ApiPropertyOptional({
    description:
      '付款方式過濾。01=信用卡，02=網路ATM，03=ATM櫃員機，11=圓夢彈性分期。',
    enum: ['01', '02', '03', '11'],
  })
  @IsOptional()
  @IsIn(['01', '02', '03', '11'])
  paymentType?: '01' | '02' | '03' | '11';
}
