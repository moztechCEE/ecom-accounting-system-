import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, TransformFnParams, Type } from 'class-transformer';

// The global ValidationPipe enables implicit conversion. Keep numeric input
// types intact so a string or boolean cannot silently become a cost or qty.
const original = ({ obj, key }: TransformFnParams): unknown =>
  (obj as Record<string, unknown>)[key];
const trim = (args: TransformFnParams): unknown => {
  const value = original(args);
  return typeof value === 'string' ? value.trim() : value;
};

export class B2bPurchaseOrderItemDto {
  @IsUUID('4')
  requestItemId!: string;

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

export class CreateB2bPurchaseOrderDto {
  @IsUUID('4')
  requestId!: string;

  @IsUUID('4')
  requestKey!: string;

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
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => B2bPurchaseOrderItemDto)
  items!: B2bPurchaseOrderItemDto[];
}
