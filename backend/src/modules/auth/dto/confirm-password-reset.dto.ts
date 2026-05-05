import { IsString, MinLength } from 'class-validator';

export class ConfirmPasswordResetDto {
  @IsString()
  readonly token: string;

  @IsString()
  @MinLength(8)
  readonly newPassword: string;
}
