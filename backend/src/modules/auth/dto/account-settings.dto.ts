import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
}
export class EnableTwoFactorDto {
  @IsString() @Matches(/^\d{6}$/) token!: string;
  @IsString() @MaxLength(2048) setupToken!: string;
  @IsString() @MinLength(8) @MaxLength(256) currentPassword!: string;
}
