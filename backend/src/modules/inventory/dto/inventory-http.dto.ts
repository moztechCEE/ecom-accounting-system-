import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class InventoryCompanyQueryDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  entityId!: string;
}

export class InventorySnapshotsQueryDto extends InventoryCompanyQueryDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  productId!: string;
}

export class CreateInventoryWarehouseDto extends InventoryCompanyQueryDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  type?: string;
}

export class InventoryImportQueryDto extends InventoryCompanyQueryDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  sheet?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  dryRun?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  force?: string;
}

// The multipart file is handled separately. All scope/options must be in the
// query, which EntityAccessGuard can inspect before the upload interceptor.
export class InventoryImportBodyDto {}
