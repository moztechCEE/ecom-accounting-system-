import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
export class RepairCheckDto {
  @IsString() @MaxLength(160) name!: string;
  @IsIn(['PASS', 'FAIL', 'NOT_TESTED']) result!: 'PASS' | 'FAIL' | 'NOT_TESTED';
  @IsString() @MaxLength(1000) observation!: string;
}
export class RepairPartDto {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(100) sku!: string;
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100000)
  quantity!: number;
}
export class InspectionDataDto {
  @IsString() @MaxLength(2000) complaint!: string;
  @IsIn(['YES', 'INTERMITTENT', 'NO', 'NOT_TESTED']) reproduction!:
    | 'YES'
    | 'INTERMITTENT'
    | 'NO'
    | 'NOT_TESTED';
  @IsString() @MaxLength(2000) testConditions!: string;
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RepairCheckDto)
  checks!: RepairCheckDto[];
  @IsString() @MaxLength(2000) diagnosis!: string;
  @IsIn(['CONFIRMED', 'SUSPECTED', 'UNKNOWN']) causeStatus!:
    | 'CONFIRMED'
    | 'SUSPECTED'
    | 'UNKNOWN';
  @IsIn(['REPAIR', 'REPLACE', 'FACTORY', 'RETURN']) plan!:
    | 'REPAIR'
    | 'REPLACE'
    | 'FACTORY'
    | 'RETURN';
  @IsString() @MaxLength(2000) planNote!: string;
  @IsIn(['FREE', 'PAID', 'REVIEW']) feeSuggestion!: 'FREE' | 'PAID' | 'REVIEW';
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  estimateAmount?: number;
  @IsString() @MaxLength(2000) estimateNote!: string;
  @IsOptional() @IsIn(['NEW', 'REFURBISHED']) replacementCondition?:
    | 'NEW'
    | 'REFURBISHED';
  @IsOptional() @IsString() @MaxLength(100) replacementSku?: string;
}
export class RepairDataDto {
  @IsIn(['REPAIRED', 'REPLACED', 'FACTORY_REPAIRED']) outcome!:
    | 'REPAIRED'
    | 'REPLACED'
    | 'FACTORY_REPAIRED';
  @IsString() @MaxLength(4000) workPerformed!: string;
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RepairPartDto)
  parts!: RepairPartDto[];
  @IsInt() @Min(0) @Max(100000) laborMinutes!: number;
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RepairCheckDto)
  checks!: RepairCheckDto[];
  @IsIn(['PASS', 'FAIL', 'NOT_TESTED']) qcResult!:
    | 'PASS'
    | 'FAIL'
    | 'NOT_TESTED';
  @IsString() @MaxLength(2000) qcNotes!: string;
  @IsOptional() @IsIn(['NEW', 'REFURBISHED']) replacementCondition?:
    | 'NEW'
    | 'REFURBISHED';
  @IsOptional() @IsString() @MaxLength(100) replacementSku?: string;
  @IsOptional() @IsString() @MaxLength(100) replacementSerial?: string;
  @IsOptional() @IsString() @MaxLength(200) replacementSource?: string;
  @IsOptional() @IsString() @MaxLength(1000) originalDisposition?: string;
  @IsOptional() @IsString() @MaxLength(200) inventoryReference?: string;
  @IsOptional() @IsString() @MaxLength(200) factoryReference?: string;
  @IsString() @MaxLength(1000) deliveredAccessories!: string;
}
class DocumentBaseDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @IsIn(['DRAFT', 'SUBMITTED']) status!: 'DRAFT' | 'SUBMITTED';
}
export class SaveInspectionDto extends DocumentBaseDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => InspectionDataDto)
  data!: InspectionDataDto;
}
export class SaveRepairDto extends DocumentBaseDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => RepairDataDto)
  data!: RepairDataDto;
}
