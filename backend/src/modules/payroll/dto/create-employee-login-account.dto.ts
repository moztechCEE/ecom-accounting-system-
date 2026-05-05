import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEmployeeLoginAccountDto {
  @IsEmail()
  readonly email: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  readonly password?: string;
}
