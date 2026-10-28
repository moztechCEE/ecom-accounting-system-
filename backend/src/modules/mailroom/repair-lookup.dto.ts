import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export const REPAIR_CASE_CODE = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

export class RepairLookupQuery {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  entityId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(REPAIR_CASE_CODE)
  code!: string;
}
