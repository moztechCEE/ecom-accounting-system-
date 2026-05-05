import { IsEmail } from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail()
  readonly email: string;
}
