import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
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
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class B2bPriceBookEntityDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  entityId!: string;
}

export class B2bPriceBookListDto extends B2bPriceBookEntityDto {
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

export class B2bPublicCatalogQueryDto extends B2bPriceBookListDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  brand?: string;

  // Product.category is existing free-form data. Preserve its exact value so
  // every category returned by facets can be used as a filter.
  @IsOptional()
  @IsString()
  category?: string;
}

export class B2bPutPriceBookDto extends B2bPriceBookEntityDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  brand?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000000)
  msrp!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000000)
  regularPrice?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000000)
  groupBuyPrice?: number | null;

  @IsBoolean()
  isPublic!: boolean;

  @IsIn(['TWD'])
  currency!: 'TWD';

  @IsIn(['TAX_INCLUDED', 'TAX_EXCLUDED'])
  taxBasis!: 'TAX_INCLUDED' | 'TAX_EXCLUDED';
}

export class B2bUpsertOfferDto extends B2bPriceBookEntityDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000000)
  unitPrice!: number;

  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;

  @IsIn(['ALL', 'CODE'])
  audience!: 'ALL' | 'CODE';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  audienceCode?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class B2bOfferPreviewDto extends B2bPriceBookEntityDto {
  @IsIn(['MSRP', 'REGULAR', 'GROUP_BUY', 'CAMPAIGN'])
  priceType!: 'MSRP' | 'REGULAR' | 'GROUP_BUY' | 'CAMPAIGN';

  @IsOptional() @IsUUID('4') offerId?: string;
  @IsInt() @Min(1) @Max(100000) quantity!: number;
  @IsOptional() @IsDateString() at?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  audienceCode?: string;
}

export class B2bCustomerDiscountDto extends B2bPriceBookEntityDto {
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(1)
  multiplier!: number;

  @IsIn(['MSRP', 'REGULAR'])
  basePriceType!: 'MSRP' | 'REGULAR';

  @IsDateString() validFrom!: string;
  @IsOptional() @IsDateString() validUntil?: string | null;
  @IsBoolean() isActive!: boolean;
}

export class B2bDiscountPreviewLineDto {
  @IsUUID('4') productId!: string;
  @IsInt() @Min(1) @Max(100000) quantity!: number;
}

export class B2bDiscountPreviewDto extends B2bPriceBookEntityDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => B2bDiscountPreviewLineDto)
  items!: B2bDiscountPreviewLineDto[];

  @IsOptional() @IsDateString() at?: string;
}
