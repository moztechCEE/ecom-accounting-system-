import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateVendorDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsOptional() @IsString() @MaxLength(100)
  country?: string;

  @IsOptional() @IsString() @MaxLength(10)
  defaultCurrency?: string;

  @IsOptional() @IsString() @MaxLength(30)
  taxId?: string;

  @IsOptional() @IsString() @MaxLength(100)
  contactPerson?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  contactEmail?: string;

  @IsOptional() @IsString() @MaxLength(50)
  contactPhone?: string;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateVendorDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsString() @MaxLength(100)
  country?: string;

  @IsOptional() @IsString() @MaxLength(10)
  defaultCurrency?: string;

  @IsOptional() @IsString() @MaxLength(30)
  taxId?: string;

  @IsOptional() @IsString() @MaxLength(100)
  contactPerson?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  contactEmail?: string;

  @IsOptional() @IsString() @MaxLength(50)
  contactPhone?: string;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
