import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  REPAIR_WORKFLOW_ACTIONS,
  type RepairWorkflowAction,
} from './repair-workflow.contract';

export class RepairWorkflowDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @IsIn(REPAIR_WORKFLOW_ACTIONS) action!: RepairWorkflowAction;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsInt() @Min(1) @Max(2147483646) inspectionRevision?: number;
  @IsOptional() @IsIn(['APPROVE', 'DECLINE']) decision?: 'APPROVE' | 'DECLINE';
  @IsOptional() @IsBoolean() confirmedItems?: boolean;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(160) factoryName?: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsString() @MaxLength(100) carrier?: string;
  @IsOptional() @IsString() @MaxLength(100) trackingNumber?: string;
}
export class RepairCustomerQueueQuery {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
