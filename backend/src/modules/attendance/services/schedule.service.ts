import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

type ScheduleWithPolicy = Prisma.AttendanceScheduleGetPayload<{
  include: { policy: true };
}>;

export type ResolvedAttendanceSchedule = ScheduleWithPolicy & {
  source: 'employee' | 'department';
  shiftStartAt: Date;
  shiftEndAt: Date;
  allowedClockInFrom: Date;
  lateThreshold: Date;
  earlyLeaveThreshold: Date;
  expectedWorkedMinutes: number;
};

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async getScheduleForDate(employeeId: string, date: Date) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        entityId: true,
        departmentId: true,
        isActive: true,
      },
    });

    if (!employee?.isActive) {
      return null;
    }

    const weekday = date.getDay();
    const schedules = await this.prisma.attendanceSchedule.findMany({
      where: {
        weekday,
        policy: {
          entityId: employee.entityId,
        },
        OR: [
          { employeeId: employee.id },
          ...(employee.departmentId ? [{ departmentId: employee.departmentId }] : []),
        ],
      },
      include: { policy: true },
      orderBy: [{ createdAt: 'desc' }],
    });

    const directSchedule = schedules.find(
      (schedule) => schedule.employeeId === employee.id,
    );
    const departmentSchedule = employee.departmentId
      ? schedules.find((schedule) => schedule.departmentId === employee.departmentId)
      : undefined;
    const selectedSchedule = directSchedule || departmentSchedule;

    if (!selectedSchedule) {
      return null;
    }

    const shiftStartAt = this.combineDateAndTime(date, selectedSchedule.shiftStart);
    const shiftEndAt = this.combineDateAndTime(date, selectedSchedule.shiftEnd);
    if (shiftEndAt <= shiftStartAt) {
      shiftEndAt.setDate(shiftEndAt.getDate() + 1);
    }

    const maxEarlyClock = selectedSchedule.policy?.maxEarlyClock ?? 15;
    const maxLateClock = Math.max(selectedSchedule.policy?.maxLateClock ?? 5, 20);
    const allowedClockInFrom = new Date(
      shiftStartAt.getTime() - maxEarlyClock * 60 * 1000,
    );
    const lateThreshold = new Date(
      shiftStartAt.getTime() + maxLateClock * 60 * 1000,
    );
    const earlyLeaveThreshold = new Date(shiftEndAt);
    const expectedWorkedMinutes = Math.max(
      0,
      Math.floor((shiftEndAt.getTime() - shiftStartAt.getTime()) / 60000) -
        selectedSchedule.breakMinutes,
    );

    return {
      ...selectedSchedule,
      source: directSchedule ? 'employee' : 'department',
      shiftStartAt,
      shiftEndAt,
      allowedClockInFrom,
      lateThreshold,
      earlyLeaveThreshold,
      expectedWorkedMinutes,
    } satisfies ResolvedAttendanceSchedule;
  }

  private combineDateAndTime(baseDate: Date, time: string) {
    const [hours, minutes] = time.split(':').map((value) => Number(value));
    const result = new Date(baseDate);
    result.setHours(hours || 0, minutes || 0, 0, 0);
    return result;
  }
}
