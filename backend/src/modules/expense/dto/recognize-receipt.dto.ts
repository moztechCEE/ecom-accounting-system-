import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ReceiptFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  name!: string;

  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  mimeType!: string;

  @IsString()
  @MaxLength(7_000_000)
  url!: string;
}

export class RecognizeReceiptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  entityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ReceiptFileDto)
  files!: ReceiptFileDto[];
}
