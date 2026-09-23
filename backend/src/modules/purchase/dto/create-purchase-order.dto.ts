import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
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
import { Transform, TransformFnParams, Type } from 'class-transformer';

// The global pipe enables implicit conversion. Read the original value so that
// booleans and numeric strings cannot silently become quantities or exchange rates.
const original = ({ obj, key }: TransformFnParams): unknown => obj[key];
const trim = (args: TransformFnParams): unknown => {
  const value = original(args);
  return typeof value === 'string' ? value.trim() : value;
};

export class PurchaseOrderItemDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  productId!: string;

  @Transform(original)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;

  @Transform(original)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(100_000_000)
  unitCost!: number;
}

export class CreatePurchaseOrderDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  vendorId!: string;

  @Transform(trim)
  @IsDateString({ strict: true })
  orderDate!: string;

  @Transform((args: TransformFnParams): unknown => {
    const value = trim(args);
    return typeof value === 'string' ? value.toUpperCase() : value;
  })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @Transform(original)
  @IsNumber({ maxDecimalPlaces: 6, allowNaN: false, allowInfinity: false })
  @Min(0.000001)
  @Max(1_000_000)
  fxRate!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
