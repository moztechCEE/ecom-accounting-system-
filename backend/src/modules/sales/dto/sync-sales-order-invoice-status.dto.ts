import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SyncSalesOrderInvoiceStatusDto {
  @IsString()
  entityId!: string;

  @IsOptional()
  @IsString()
  channelId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
