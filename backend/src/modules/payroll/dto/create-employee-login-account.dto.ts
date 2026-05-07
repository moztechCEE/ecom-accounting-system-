import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEmployeeLoginAccountDto {
  @IsOptional()
  @IsEmail()
  readonly email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  readonly password?: string;
}
