import {
  Equals,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** The recipient credential exists only for this request; it never becomes the tablet session. */
export class MailroomTabletAcceptDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @IsString() @IsNotEmpty() @MaxLength(128) employeeNo!: string;
  @IsString() @MinLength(8) @MaxLength(256) password!: string;
  @IsOptional() @IsString() @Matches(/^\d{6}$/) twoFactorToken?: string;
  @IsBoolean() @Equals(true) confirmedItems!: true;
  @IsString() @IsNotEmpty() @MaxLength(160) location!: string;
}
