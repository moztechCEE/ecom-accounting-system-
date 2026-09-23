import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class HandoverPackageDto {
  @IsString() @IsNotEmpty() @MaxLength(128) packageId!: string;
  @IsInt() @Min(1) @Max(50000) quantity!: number;
}
export class HandoverLineDto {
  @IsUUID('4') shipmentLineId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) salesOrderLineId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) productId!: string;
  @IsString() @IsNotEmpty() @MaxLength(256) sku!: string;
  @IsInt() @Min(1) @Max(50000) quantity!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => HandoverPackageDto)
  packages!: HandoverPackageDto[];
}
export class HandoverEvidenceDto {
  @IsIn(['carrier_collection', 'customer_pickup']) method!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) carrier?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) trackingNo?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) manifestId?: string;
  @IsString() @IsNotEmpty() @MaxLength(128) operatorId!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class WmsHandoverDto {
  @IsIn(['corely.wms.handover.v1']) contractVersion!: string;
  @IsUUID('4') eventId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) warehouseId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) salesOrderId!: string;
  @IsInt() @Min(1) @Max(2147483647) nativeIntakeId!: number;
  @IsInt() @Min(1) @Max(2147483647) wmsOrderId!: number;
  @IsUUID('4') shipmentId!: string;
  @Matches(/^[a-f0-9]{64}$/) sourceHash!: string;
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  occurredAt!: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => HandoverEvidenceDto)
  handover!: HandoverEvidenceDto;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => HandoverLineDto)
  lines!: HandoverLineDto[];
}
export class ReconciliationQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) occurredOn?: string;
  @IsOptional() @IsString() @MaxLength(128) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsIn(['pending', 'posted', 'all']) status?: string;
}
export class PostShipmentLineDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
