import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class StorageQueryDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class StorageRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
}
export class CreateStorageRackDto extends StorageRequestDto {
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsIn(['RECEIVING', 'OUTBOUND']) zone!: 'RECEIVING' | 'OUTBOUND';
  @Type(() => Number) @IsInt() @Min(1) @Max(8) rows!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(8) columns!: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-10000)
  @Max(10000)
  layoutX?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-10000)
  @Max(10000)
  layoutY?: number;
}
export class UpdateStorageRackDto extends StorageRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsIn(['RECEIVING', 'OUTBOUND']) zone?:
    | 'RECEIVING'
    | 'OUTBOUND';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8) rows?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8) columns?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-10000)
  @Max(10000)
  layoutX?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-10000)
  @Max(10000)
  layoutY?: number;
  @IsOptional()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsBoolean()
  isActive?: boolean;
}
export class CreateStorageLocationDto extends StorageRequestDto {
  @IsUUID() rackId!: string;
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(8) level!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(8) slot!: number;
}
export class UpdateStorageLocationDto extends StorageRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsBoolean()
  isActive?: boolean;
}
export class MoveStorageItemDto extends StorageRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
  @IsOptional() @IsUUID() storageLocationId?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) location?: string;
}
