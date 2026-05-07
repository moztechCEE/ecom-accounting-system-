import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  readonly currentPassword: string;

  @IsString()
  @MinLength(8)
  readonly newPassword: string;

  @IsOptional()
  @IsEmail()
  readonly email?: string;
}
