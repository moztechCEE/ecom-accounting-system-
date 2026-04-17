import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EcpayServiceFeeInvoiceItemDto {
  @IsString()
  invoiceNo!: string;

  @IsDateString()
  invoiceDate!: string;

  @IsNumber()
  @Min(0)
  amountOriginal!: number;

  @IsOptional()
  @IsString()
  amountCurrency?: string;

  @IsOptional()
  @IsString()
  serviceType?: string;

  @IsOptional()
  @IsString()
  invoiceStatus?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  relateNumber?: string;
}

export class ImportEcpayServiceFeeInvoicesDto {
  @IsString()
  entityId!: string;

  @IsOptional()
  @IsString()
  merchantKey?: string;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsString()
  vendorName?: string;

  @IsOptional()
  @IsBoolean()
  autoOffsetByMatchedFees?: boolean;

  @IsOptional()
  @IsBoolean()
  verifyIssuedStatus?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EcpayServiceFeeInvoiceItemDto)
  records!: EcpayServiceFeeInvoiceItemDto[];
}
