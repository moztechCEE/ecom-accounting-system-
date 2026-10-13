import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RepairMaterialsReadQuery {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
}

export class RepairMaterialsCommand extends RepairMaterialsReadQuery {
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
}

export class RepairMaterialsContextCommand extends RepairMaterialsCommand {
  @IsInt() @Min(1) @Max(2147483646) expectedItemVersion!: number;
  @IsInt() @Min(1) @Max(2147483646) inspectionRevision!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) planHash!: string;
}

export class AllocateRepairMaterialDto extends RepairMaterialsContextCommand {
  @IsString() @IsNotEmpty() @MaxLength(128) requirementId!: string;
}

export class PhysicalRepairMaterialDto extends RepairMaterialsContextCommand {
  @IsString() @IsNotEmpty() @MaxLength(128) allocationId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedAllocationVersion!: number;
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key], {
    toClassOnly: true,
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/)
  quantity!: string;
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key], {
    toClassOnly: true,
  })
  @IsBoolean()
  confirmedItems!: boolean;
}

export class ReleaseRepairMaterialDto extends RepairMaterialsCommand {
  @IsString() @IsNotEmpty() @MaxLength(128) allocationId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedAllocationVersion!: number;
  @IsOptional()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key], {
    toClassOnly: true,
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/)
  returnedQuantity?: string;
  @IsOptional()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key], {
    toClassOnly: true,
  })
  @IsBoolean()
  confirmedReturned?: boolean;
  @IsOptional() @IsString() @MaxLength(200) returnLocation?: string;
}
