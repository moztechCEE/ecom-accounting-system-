import { IsDateString, IsOptional, IsString } from 'class-validator';

export class QueryEcpayServiceFeeInvoiceDto {
  @IsOptional()
  @IsString()
  merchantKey?: string;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsString()
  invoiceNo!: string;

  @IsDateString()
  invoiceDate!: string;
}
