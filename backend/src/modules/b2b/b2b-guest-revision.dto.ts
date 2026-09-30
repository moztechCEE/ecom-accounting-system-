import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { B2bEntityDto } from './b2b.dto';

class B2bGuestRevisionLineDto {
  @IsUUID('4') requestItemId!: string;
  @IsInt() @Min(1) @Max(100000) quantity!: number;
}

export class B2bGuestRevisionDto extends B2bEntityDto {
  @IsUUID('4') amendmentId!: string;
  @IsUUID('4') expectedStockReviewId!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => B2bGuestRevisionLineDto)
  items!: B2bGuestRevisionLineDto[];
}
