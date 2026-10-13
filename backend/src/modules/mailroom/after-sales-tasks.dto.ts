import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AfterSalesTaskEntityDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
}
export class AfterSalesTasksQuery extends AfterSalesTaskEntityDto {
  @IsOptional() @IsIn(['mine', 'all']) scope?: 'mine' | 'all';
  @IsOptional() @IsIn(['active', 'closed', 'deleted']) lifecycle?: string;
  @IsOptional()
  @IsIn([
    'RESHIPMENT',
    'PRIVATE_PURCHASE',
    'REPAIR',
    'EXCHANGE_RETURN',
    'REFUND_PICKUP',
    'CUSTOMER_ISSUE',
  ])
  type?: string;
  @IsOptional()
  @IsIn([
    'registration',
    'customer',
    'payment',
    'repair',
    'logistics',
    'issue',
    'closed',
  ])
  stage?: string;
  @IsOptional()
  @IsIn(['MOZTECH', 'BONSON', 'MORITEK', 'OTHER', 'UNKNOWN'])
  brand?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
export class AfterSalesOptionsQuery extends AfterSalesTaskEntityDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}
export class RegisterAfterSalesCaseDto extends AfterSalesTaskEntityDto {
  @IsUUID() requestId!: string;
  @IsIn(['MOZTECH', 'BONSON', 'MORITEK', 'OTHER']) brand!: string;
  @IsIn(['TO_C', 'TO_B']) customerKind!: string;
  @IsObject() payload!: Record<string, unknown>;
  @IsOptional() @IsObject() verifiedApplicationRef?: { id: string; revision: number; reviewHash: string };
}
export class AfterSalesApplicationsQuery extends AfterSalesTaskEntityDto {
  @IsOptional() @IsIn(['INVITED', 'SUBMITTED', 'REVIEWED', 'REJECTED', 'CONVERTED']) status?: string;
  @IsOptional() @IsUUID() cursor?: string;
}
export class AfterSalesTaskCaseParams {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) id!: string;
}
export class AfterSalesApplicationPhotoParams extends AfterSalesTaskCaseParams {
  @IsIn(['0', '1', '2', '3']) index!: string;
}
export class AfterSalesCaseCommandDto extends AfterSalesTaskEntityDto {
  @IsObject() command!: Record<string, unknown>;
}
export class AfterSalesCasePhotoParams extends AfterSalesTaskCaseParams {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) confirmationId!: string;
  @IsIn(['0', '1', '2', '3']) index!: string;
}
