import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';

export class OutboundQuery {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) caseId?: string;
  @IsOptional() @IsString() @MaxLength(128) cursor?: string;
  @IsOptional()
  @IsIn([
    'PENDING_PICK',
    'WAITING_MAILROOM_ACCEPTANCE',
    'READY_FOR_DISPATCH',
    'DISPATCHED',
    'CANCELLED',
  ])
  status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
}
class OutboundLine {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) sourceCaseItemId!: string;
  @IsInt() @Min(1) @Max(200) quantity!: number;
}
export class CreateOutboundDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) sourceCaseId!: string;
  @IsString() @MaxLength(80) sourceVersion!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OutboundLine)
  lines!: OutboundLine[];
}
class PreparedOutboundUnit {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) unitId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) productId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) warehouseId!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) sku!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) serialNumber?: string;
}
export class OutboundCommandDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn([
    'prepare',
    'accept',
    'dispatch',
    'cancel',
    'retry_sync',
    'refresh_source',
  ])
  action!:
    | 'prepare'
    | 'accept'
    | 'dispatch'
    | 'cancel'
    | 'retry_sync'
    | 'refresh_source';
  @IsOptional()
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  confirmedItems?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) location?: string;
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,128}$/)
  nextUserId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) carrier?: string;
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  trackingNumber?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PreparedOutboundUnit)
  items?: PreparedOutboundUnit[];
}
