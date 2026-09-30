import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { B2bEntityDto } from './b2b.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class B2bQuoteEmailDto extends B2bEntityDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  recipientEmail!: string;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  verificationReason!: string;
}

export class B2bQuoteTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}
