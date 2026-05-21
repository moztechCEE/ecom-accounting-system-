import {
  IsDateString,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AdminAdjustAttendanceDto {
  @IsString()
  employeeId!: string;

  @IsDateString()
  workDate!: string;

  @IsOptional()
  @IsISO8601()
  clockInAt?: string;

  @IsOptional()
  @IsISO8601()
  clockOutAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
