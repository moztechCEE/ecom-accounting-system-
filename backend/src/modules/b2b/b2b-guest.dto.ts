import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class B2bGuestEntityDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  entityId!: string;
}

export class B2bGuestLineDto {
  @IsUUID('4') productId!: string;
  @IsInt() @Min(1) @Max(1000) quantity!: number;
}

export class B2bGuestSubmitDto extends B2bGuestEntityDto {
  @IsUUID('4') requestId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  companyName!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  contactName!: string;

  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  contactEmail!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  customerPoNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => B2bGuestLineDto)
  items!: B2bGuestLineDto[];
}

export class B2bGuestListDto extends B2bGuestEntityDto {
  @IsOptional()
  @IsIn(['NEW', 'MATCHED', 'REJECTED'])
  status?: 'NEW' | 'MATCHED' | 'REJECTED';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Matches(/^(?:[1-9][0-9]?|100)$/)
  limit?: string;

  @IsOptional()
  @Matches(/^(?:0|[1-9][0-9]{0,5})$/)
  offset?: string;
}

export class B2bGuestMatchDto extends B2bGuestEntityDto {
  @IsUUID('4') customerId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class B2bGuestRejectDto extends B2bGuestEntityDto {
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class B2bGuestConversionLineDto {
  @IsUUID('4') id!: string;
  @IsInt() @Min(1) @Max(1000) quantity!: number;
  // Explicit staff-approved tax-exclusive amount; never derive this from MSRP.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000000)
  netUnitPrice!: number;
}

export class B2bGuestConvertDto extends B2bGuestEntityDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => B2bGuestConversionLineDto)
  items!: B2bGuestConversionLineDto[];
}
