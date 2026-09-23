import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsNumber, IsString, Length, Min, ValidateNested } from 'class-validator';

export class LandedCostWeightDto {
  @IsString()
  purchaseOrderItemId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  chargeableWeightKg!: number;
}

export class LandedCostDto {
  @IsString()
  @Length(3, 3)
  freightCurrency!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  ratePerKgOriginal!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  fxRateToBase!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => LandedCostWeightDto)
  weights!: LandedCostWeightDto[];
}
