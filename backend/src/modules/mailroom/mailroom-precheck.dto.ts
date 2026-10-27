import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  PRECHECK_RESULTS,
  type PrecheckResult,
} from './mailroom-precheck.contract';
import {
  WARRANTY_REVIEW_STATUSES,
  type WarrantyReviewStatus,
} from './mailroom-precheck-context.contract';

export class PrecheckQueryDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional()
  @IsIn(['NOT_STARTED', 'DRAFT', 'READY', 'SUBMITTED'])
  stage?: string;
}
export class RecordedPrecheckPhotoQueryDto extends PrecheckQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483646) revision!: number;
}
export class PrecheckRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsUUID() requestId!: string;
}
export class StartPrecheckItemDto {
  @IsUUID() itemId!: string;
  @IsUUID() requestId!: string;
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
}
export class StartPrechecksDto extends PrecheckRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StartPrecheckItemDto)
  items!: StartPrecheckItemDto[];
}
export class PrecheckTemplateBindingDto {
  @IsString() @IsNotEmpty() @MaxLength(160) id!: string;
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsInt()
  @Min(1)
  @Max(2147483646)
  revision!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) contentHash!: string;
}
export class PrecheckCheckDto {
  @IsString() @IsNotEmpty() @MaxLength(64) key!: string;
  @IsIn(PRECHECK_RESULTS) result!: PrecheckResult;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(3, { each: true })
  evidenceIndexes?: number[];
}
export class WarrantyReviewDto {
  @IsIn(WARRANTY_REVIEW_STATUSES) status!: WarrantyReviewStatus;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @IsString() @MaxLength(200) warrantyNumber?: string | null;
}
export class MailroomIssueDto {
  @IsOptional() @IsString() @MaxLength(2000) symptom?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) preliminaryReason?: string | null;
}
export class SavePrecheckDto extends PrecheckRequestDto {
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedRevision!: number;
  @IsIn(['DRAFT', 'READY']) status!: 'DRAFT' | 'READY';
  @ValidateIf((_object, value) => value !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => PrecheckTemplateBindingDto)
  templateBinding!: PrecheckTemplateBindingDto | null;
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => PrecheckCheckDto)
  checks!: PrecheckCheckDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(1400000, { each: true })
  evidence?: string[];
  @IsOptional() @IsString() @MaxLength(2000) notRequiredReason?: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WarrantyReviewDto)
  warrantyReview?: WarrantyReviewDto | null;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MailroomIssueDto)
  mailroomIssue?: MailroomIssueDto | null;
}

export class HandoffPrecheckItemDto extends StartPrecheckItemDto {
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsInt()
  @Min(1)
  @Max(2147483646)
  precheckRevision!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) precheckHash!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) identityHash!: string;
}
export class HandoffPrechecksDto extends PrecheckRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HandoffPrecheckItemDto)
  items!: HandoffPrecheckItemDto[];
}
