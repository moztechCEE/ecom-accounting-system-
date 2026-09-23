import {
  IsUUID,
  IsOptional,
  IsString,
  IsNumber,
  IsDate,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class SalesOrderItemDto {
  @ApiProperty({ description: '商品 ID' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: '數量' })
  @IsNumber()
  @Min(0.01)
  qty!: number;

  @ApiProperty({ description: '單價' })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiProperty({ description: '折扣金額', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;
}

export class CreateSalesOrderDto {
  @ApiProperty({ description: '公司實體 ID' })
  @IsUUID()
  entityId!: string;

  @ApiProperty({ description: '確認供貨及預留庫存的出貨倉庫 ID', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ description: '銷售渠道 ID' })
  @IsUUID()
  channelId!: string;

  @ApiProperty({ description: '客戶 ID', required: false })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ description: '外部訂單編號（平台訂單號）', required: false })
  @IsOptional()
  @IsString()
  externalOrderId?: string;

  @ApiProperty({ description: '訂單日期' })
  @Type(() => Date)
  @IsDate()
  orderDate!: Date;

  @ApiProperty({ description: '幣別', required: false, default: 'TWD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ description: '匯率', required: false, default: 1 })
  @IsOptional()
  @IsNumber()
  fxRate?: number;

  @ApiProperty({ description: '訂單明細', type: [SalesOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemDto)
  items!: SalesOrderItemDto[];
}
