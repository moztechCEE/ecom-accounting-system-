import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsISO8601,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const raw = ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
  obj[key];
export class RepairStandardLimitDto {
  @IsIn(['OBSERVATION', 'NUMBER', 'BOOLEAN']) kind!:
    | 'OBSERVATION'
    | 'NUMBER'
    | 'BOOLEAN';
  @IsString() @IsNotEmpty() @MaxLength(2000) instruction!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30) unit?: string;
  @IsOptional()
  @Transform(raw)
  @IsString()
  @Matches(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
  min?: string;
  @IsOptional()
  @Transform(raw)
  @IsString()
  @Matches(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
  max?: string;
  @IsOptional() @Transform(raw) @IsBoolean() expected?: boolean;
}
export class RepairStandardCheckDto {
  @IsString() @IsNotEmpty() @MaxLength(128) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @Transform(raw) @IsBoolean() requiredForInspection!: boolean;
  @Transform(raw) @IsBoolean() requiredForCompletion!: boolean;
  @Transform(raw) @IsBoolean() requiresCalibration!: boolean;
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  equipmentType?: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => RepairStandardLimitDto)
  standard!: RepairStandardLimitDto;
}
export class RepairStandardDefinitionDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) modelNumber?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RepairStandardCheckDto)
  checks!: RepairStandardCheckDto[];
}
export class RepairRegistryRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @Transform(raw)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,80}$/)
  requestId!: string;
}
export class CreateRepairStandardDto extends RepairRegistryRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(128) productId!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) sku!: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => RepairStandardDefinitionDto)
  data!: RepairStandardDefinitionDto;
}
export class NewRepairStandardRevisionDto extends RepairRegistryRequestDto {
  @Transform(raw) @IsInt() @Min(1) @Max(2147483645) expectedRevision!: number;
  @IsDefined()
  @ValidateNested()
  @Type(() => RepairStandardDefinitionDto)
  data!: RepairStandardDefinitionDto;
}
export class ReviewRepairStandardDto extends RepairRegistryRequestDto {
  @Transform(raw) @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
}
export class RecordRepairCalibrationDto extends RepairRegistryRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(128) instrumentId!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) equipmentType!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) proofReference!: string;
  @IsISO8601({ strict: true, strictSeparator: true }) validFrom!: string;
  @IsISO8601({ strict: true, strictSeparator: true }) validUntil!: string;
}
export class RepairRegistryQueryDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128) productId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128) instrumentId?: string;
}
export class RepairItemStandardQueryDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsIn(['inspection', 'repair']) kind!: 'inspection' | 'repair';
}
