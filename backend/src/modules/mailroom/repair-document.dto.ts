import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  ValidateBy,
} from 'class-validator';
const rawInputValue = ({ obj, key }: { obj: unknown; key: string }): unknown =>
  obj && typeof obj === 'object'
    ? (obj as Record<string, unknown>)[key]
    : undefined;
export class RepairTemplateBindingDto {
  @IsString() @IsNotEmpty() @MaxLength(128) id!: string;
  @IsInt() @Min(1) revision!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) contentHash!: string;
}
export class RepairDocumentMediaRefDto {
  @IsString() @IsNotEmpty() @MaxLength(128) mediaId!: string;
  @IsIn(['BEFORE', 'AFTER', 'DIAGNOSTIC']) phase!:
    | 'BEFORE'
    | 'AFTER'
    | 'DIAGNOSTIC';
  @IsOptional() @IsString() @MaxLength(128) checkKey?: string;
}
export class CustomerRepairReportDraftDto {
  @IsString() @MaxLength(2000) findings!: string;
  @IsString() @MaxLength(2000) handling!: string;
  @IsString() @MaxLength(2000) verification!: string;
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  mediaIds!: string[];
}
class RepairDocumentV2Dto {
  @IsOptional()
  @Transform(rawInputValue, { toClassOnly: true })
  @IsIn([2])
  protocol?: 2;
  @IsOptional()
  @Transform(rawInputValue, { toClassOnly: true })
  @IsBoolean()
  isUnderWarranty?: boolean;
  @IsOptional()
  @Transform(rawInputValue, { toClassOnly: true })
  @IsBoolean()
  isAccidentalDamage?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) customerVisibleSummary?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => RepairTemplateBindingDto)
  templateBinding?: RepairTemplateBindingDto;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => RepairDocumentMediaRefDto)
  mediaRefs?: RepairDocumentMediaRefDto[];
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerRepairReportDraftDto)
  customerReportDraft?: CustomerRepairReportDraftDto;
}
export class RepairMaterialRequirementDto {
  @IsString() @IsNotEmpty() @MaxLength(128) id!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) productId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(100) sku?: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @Transform(rawInputValue, { toClassOnly: true })
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/)
  requiredQuantity!: string;
  @Transform(rawInputValue, { toClassOnly: true })
  @IsBoolean()
  requiredForStart!: boolean;
}
export class RepairMaterialPlanDto {
  @IsIn(['UNASSESSED', 'NONE', 'REQUIRED']) mode!:
    | 'UNASSESSED'
    | 'NONE'
    | 'REQUIRED';
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RepairMaterialRequirementDto)
  lines!: RepairMaterialRequirementDto[];
}
export class RepairCheckDto {
  @IsString() @MaxLength(160) name!: string;
  @IsIn(['PASS', 'FAIL', 'NOT_TESTED']) result!: 'PASS' | 'FAIL' | 'NOT_TESTED';
  @IsString() @MaxLength(1000) observation!: string;
  @IsOptional() @IsString() @MaxLength(128) key?: string;
  // Preserve numeric strings and true booleans; the reviewed template validates their kind.
  @IsOptional()
  @Transform(rawInputValue, { toClassOnly: true })
  @ValidateBy({
    name: 'measurementPrimitive',
    validator: {
      validate: (value) =>
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 100),
      defaultMessage: () => '量測值須為數值字串或功能布林值',
    },
  })
  measurementValue?: string | boolean;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsOptional() @IsString() @MaxLength(128) instrumentId?: string;
  @IsOptional() @IsString() @MaxLength(128) calibrationRecordId?: string;
  @IsOptional() @IsString() @MaxLength(40) measuredAt?: string;
}
export class RepairPartDto {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(100) sku!: string;
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100000)
  quantity!: number;
}
export class InspectionDataDto extends RepairDocumentV2Dto {
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
  @IsIn(['REPAIR', 'REPLACE', 'FACTORY', 'RETURN', 'SCRAP']) plan!:
    | 'REPAIR'
    | 'REPLACE'
    | 'FACTORY'
    | 'RETURN'
    | 'SCRAP';
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
  @IsOptional()
  @ValidateNested()
  @Type(() => RepairMaterialPlanDto)
  materialPlan?: RepairMaterialPlanDto;
}
export class RepairDataDto extends RepairDocumentV2Dto {
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
