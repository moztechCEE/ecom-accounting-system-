import { IsEnum } from 'class-validator';
import { LeaveStatus } from '@prisma/client';

export class UpdateLeaveStatusDto {
  @IsEnum(LeaveStatus)
  status: LeaveStatus;
}
