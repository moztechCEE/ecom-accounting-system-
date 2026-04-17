import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class UpsertAttendanceScheduleDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'shiftStart must be in HH:mm format',
  })
  shiftStart: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'shiftEnd must be in HH:mm format',
  })
  shiftEnd: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allowRemote?: boolean;
}

export class UpsertAttendancePolicyDto {
  @IsOptional()
  @IsString()
  entityId?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsIn(['office', 'remote', 'hybrid'])
  type?: 'office' | 'remote' | 'hybrid';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ipAllowList?: string[];

  @IsOptional()
  geofence?: unknown;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requiresPhoto?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxEarlyClock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxLateClock?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertAttendanceScheduleDto)
  schedules?: UpsertAttendanceScheduleDto[];
}
