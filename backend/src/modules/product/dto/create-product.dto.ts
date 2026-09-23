import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, Min, IsBoolean } from 'class-validator';
import { ProductType } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ProductType)
  @IsOptional()
  type?: ProductType;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  salesPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  purchaseCost?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsOptional()
  attributes?: any;

  @IsString()
  @IsNotEmpty()
  barcode: string;

  @IsString()
  @IsOptional()
  modelNumber?: string;

  @IsBoolean()
  @IsOptional()
  hasSerialNumbers?: boolean;

  @IsString()
  @IsOptional()
  hsCode?: string;

  @IsString()
  @IsOptional()
  countryOfOrigin?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  packageLength?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  packageWidth?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  packageHeight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  weight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  grossWeight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  netWeight?: number;
}

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  modelNumber?: string;

  @IsBoolean()
  @IsOptional()
  hasSerialNumbers?: boolean;

  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(ProductType)
  @IsOptional()
  type?: ProductType;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  salesPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  purchaseCost?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsOptional()
  attributes?: any;

  @IsString()
  @IsOptional()
  hsCode?: string;

  @IsString()
  @IsOptional()
  countryOfOrigin?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  packageLength?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  packageWidth?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  packageHeight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  weight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  grossWeight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  netWeight?: number;
}
