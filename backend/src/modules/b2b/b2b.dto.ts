import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
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
export class B2bLoginDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  companyCode!: string;
  @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class B2bEntityDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
}
export class B2bProductOptionsDto extends B2bEntityDto {
  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsString() @MaxLength(200)
  search?: string;

  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsString() @Matches(/^(?:[1-9][0-9]?|100)$/)
  limit?: string;
}
export class B2bAccountDto extends B2bEntityDto {
  @IsString() @IsNotEmpty() @MaxLength(128) customerId!: string;
  @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString() @MinLength(12) @MaxLength(72) password!: string;
}
export class B2bAccountUpdateDto extends B2bEntityDto {
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsString() @MinLength(12) @MaxLength(72) password?: string;
}
export class B2bCatalogDto extends B2bEntityDto {
  @IsString() @IsNotEmpty() @MaxLength(128) productId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000000) unitPrice!: number;
  @IsBoolean() isPublished!: boolean;
}
export class B2bPriceDto extends B2bEntityDto {
  @IsString() @IsNotEmpty() @MaxLength(128) customerId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) productId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000000) unitPrice!: number;
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsDateString() validUntil?: string;
}
export class B2bRequestLineDto {
  @IsString() @IsNotEmpty() @MaxLength(128) productId!: string;
  @IsInt() @Min(1) @Max(100000) quantity!: number;
}
export class B2bRequestDto {
  @IsUUID('4') requestId!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  customerPoNumber!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => B2bRequestLineDto)
  items!: B2bRequestLineDto[];
}
export class B2bReviewLineDto {
  @IsUUID('4') id!: string;
  @IsInt() @Min(0) @Max(100000) confirmedQuantity!: number;
}
export class B2bReviewDto extends B2bEntityDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => B2bReviewLineDto)
  items!: B2bReviewLineDto[];
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  reviewNote?: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  deliveryDate?: string;
}

export class B2bSupplierAccountDto extends B2bEntityDto {
  @IsString() @IsNotEmpty() @MaxLength(128) vendorId!: string;
  @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString() @MinLength(12) @MaxLength(72) password!: string;
}

export class B2bConfirmDto extends B2bEntityDto {
  @IsString() @IsNotEmpty() @MaxLength(128) channelId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) warehouseId!: string;
}

export class B2bIssueQuoteDto extends B2bEntityDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  validUntil?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) paymentTerms?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) deliveryTerms?: string;
}

export class B2bWithdrawQuoteDto extends B2bEntityDto {
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}
