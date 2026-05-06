import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

type ImportRowValue = string | number | boolean | null;

export class ImportEcpayIssuedInvoicesDto {
  @IsString()
  entityId!: string;

  @IsOptional()
  @IsString()
  merchantKey?: string;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsBoolean()
  markIssued?: boolean;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsArray()
  rows!: Record<string, ImportRowValue>[];

  @IsOptional()
  @IsObject()
  mapping?: Record<string, string | string[]>;
}
