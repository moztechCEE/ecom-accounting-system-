import { Type } from 'class-transformer';
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
import {
  ACTIONS,
  CATEGORIES,
  GRADES,
  type ActionName,
} from './mailroom.contract';
export class MailroomQuery {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsIn(['mailroom', 'repair', 'mine']) view?:
    | 'mailroom'
    | 'repair'
    | 'mine';
  @IsOptional()
  @IsIn(['all', 'mine', 'acceptance', 'waiting', 'delivery', 'records'])
  repairScope?:
    | 'all'
    | 'mine'
    | 'acceptance'
    | 'waiting'
    | 'delivery'
    | 'records';
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsIn(['true', 'false']) awaiting?: string;
  @IsOptional() @IsString() @MaxLength(128) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
}
export class ReturnInspectionDto {
  @IsIn(['INTACT', 'MINOR_DAMAGE', 'MAJOR_DAMAGE', 'NOT_PROVIDED']) packaging!:
    | 'INTACT'
    | 'MINOR_DAMAGE'
    | 'MAJOR_DAMAGE'
    | 'NOT_PROVIDED';
  @IsIn(['NEW_UNUSED', 'MINOR_WEAR', 'VISIBLE_WEAR', 'SEVERE_DAMAGE'])
  product!: 'NEW_UNUSED' | 'MINOR_WEAR' | 'VISIBLE_WEAR' | 'SEVERE_DAMAGE';
  @IsIn(['COMPLETE', 'MISSING', 'NONE_EXPECTED']) accessories!:
    | 'COMPLETE'
    | 'MISSING'
    | 'NONE_EXPECTED';
}
export class ReceiptItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200) productName!: string;
  @IsOptional() @IsString() @MaxLength(128) sourceItemId?: string;
  @IsOptional() @IsString() @MaxLength(100) sku?: string;
  @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
}
export class CreateReceiptDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
  @IsIn(CATEGORIES) category!: (typeof CATEGORIES)[number];
  @IsOptional() @IsString() @MaxLength(128) sourceCaseId?: string;
  @IsOptional() @IsString() @MaxLength(128) recipientId?: string;
  @IsString() @IsNotEmpty() @MaxLength(160) location!: string;
  @IsOptional() @IsString() @MaxLength(100) carrier?: string;
  @IsOptional() @IsString() @MaxLength(100) trackingNumber?: string;
  @IsOptional() @IsString() @MaxLength(160) senderLabel?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items!: ReceiptItemDto[];
}
export class MailroomCommandDto {
  @IsOptional()
  @IsIn(['REPAIR', 'RETURN', 'LETTER', 'PARCEL'])
  targetCategory?: 'REPAIR' | 'RETURN' | 'LETTER' | 'PARCEL';
  @IsOptional() @IsString() @MaxLength(128) sourceCaseId?: string;
  @IsOptional() @IsString() @MaxLength(128) sourceItemId?: string;
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @IsIn(ACTIONS) action!: ActionName;
  @IsOptional() @IsString() @MaxLength(128) csrUserId?: string;
  @IsOptional() @IsString() @MaxLength(80) sourceVersion?: string;
  @IsOptional() @IsString() @MaxLength(200) productName?: string;
  @IsOptional() @IsString() @MaxLength(100) sku?: string;
  @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(160) location?: string;
  @IsOptional() @IsString() @MaxLength(100) carrier?: string;
  @IsOptional() @IsString() @MaxLength(100) trackingNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsIn(['MATCH', 'MISMATCH']) matchResult?: 'MATCH' | 'MISMATCH';
  @IsOptional() @IsIn(GRADES) grade?: (typeof GRADES)[number];
  @IsOptional()
  @IsIn(['DEFECT_REPLACEMENT', 'WELFARE_SALE'])
  disposition?: string;
  @IsOptional() @IsString() @MaxLength(128) nextUserId?: string;
  @IsOptional() @IsBoolean() confirmedItems?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(1400000, { each: true })
  evidence?: string[];
  @IsOptional()
  @ValidateNested()
  @Type(() => ReturnInspectionDto)
  returnInspection?: ReturnInspectionDto;
}
