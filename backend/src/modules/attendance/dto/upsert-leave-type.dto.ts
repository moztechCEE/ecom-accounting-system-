import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class LeaveSeniorityTierDto {
  @Type(() => Number)
  @IsNumber()
  minYears: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxYears?: number;

  @Type(() => Number)
  @IsNumber()
  days: number;
}

export class UpsertLeaveTypeDto {
  @IsOptional()
  @IsString()
  entityId?: string;

  @IsNotEmpty()
  @IsString()
  code: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsIn(['CALENDAR_YEAR', 'HIRE_ANNIVERSARY', 'NONE'])
  balanceResetPolicy?: 'CALENDAR_YEAR' | 'HIRE_ANNIVERSARY' | 'NONE';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxDaysPerYear?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  paidPercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minNoticeHours?: number;

  @IsOptional()
  @IsBoolean()
  requiresDocument?: boolean;

  @IsOptional()
  @IsBoolean()
  allowCarryOver?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresEmployeeAuthorization?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  authorizedEmployeeIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  carryOverLimitHours?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeaveSeniorityTierDto)
  seniorityTiers?: LeaveSeniorityTierDto[];
}
