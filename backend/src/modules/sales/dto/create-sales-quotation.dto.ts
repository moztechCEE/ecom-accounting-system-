import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SalesQuotationItemDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsString()
  itemName!: string;

  @IsOptional()
  @IsString()
  itemSpec?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPriceOriginal!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountOriginal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxRate?: number;
}

export class CreateSalesQuotationDto {
  @IsString()
  entityId!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsDateString()
  quotationDate?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  deliveryTerms?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internalNote?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesQuotationItemDto)
  items!: SalesQuotationItemDto[];
}

export class UpdateSalesQuotationStatusDto {
  @IsIn(['draft', 'pending', 'approved', 'sent', 'accepted', 'rejected', 'expired'])
  status!: string;
}
