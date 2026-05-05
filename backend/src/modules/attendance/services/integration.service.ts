import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DisasterClosureService } from './disaster-closure.service';
import { OvertimeService } from './overtime.service';

@Injectable()
export class AttendanceIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disasterClosureService: DisasterClosureService,
    private readonly overtimeService: OvertimeService,
  ) {}

  async getPayrollData(employeeId: string, start: Date, end: Date) {
    // 1. Get Daily Summaries
    const summaries = await this.prisma.attendanceDailySummary.findMany({
      where: {
        employeeId,
        workDate: {
          gte: start,
          lte: end,
        },
      },
    });

    // 2. Get Approved Leaves
    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        startAt: { gte: start },
        endAt: { lte: end },
      },
      include: { leaveType: true },
    });

    // 3. Get company-wide stop-work events that affect payroll.
    const disasterClosures =
      await this.disasterClosureService.getEmployeeClosures(
        employeeId,
        start,
        end,
      );

    const approvedMinutesByDate =
      await this.overtimeService.getApprovedMinutesByDate(employeeId, start, end);

    // 4. Calculate Totals
    let regularHours = 0;
    let overtimeHours = 0;
    let leaveHours = 0;
    let deductibleLeaveHours = 0;
    let lateDeductionHours = 0;

    const leaveMinutesByDate = new Map<string, number>();
    const leaveEntries = leaves.map((leave) => {
      const paidPercentage = Number(leave.leaveType.paidPercentage || 100);
      const hours = Number(leave.hours);
      const deductionFactor = Math.max(0, (100 - paidPercentage) / 100);

      deductibleLeaveHours += hours * deductionFactor;
      leaveHours += hours;

      const dayKey = new Date(leave.startAt).toISOString().slice(0, 10);
      leaveMinutesByDate.set(dayKey, (leaveMinutesByDate.get(dayKey) ?? 0) + hours * 60);

      return {
        id: leave.id,
        code: leave.leaveType.code,
        name: leave.leaveType.name,
        hours,
        paidPercentage,
        deductionFactor,
      };
    });

    for (const summary of summaries) {
      const workDateKey = new Date(summary.workDate).toISOString().slice(0, 10);
      const leaveMinutes = leaveMinutesByDate.get(workDateKey) ?? 0;
      const schedule = await this.overtimeService.resolveSchedule(
        employeeId,
        summary.workDate,
      );
      const metrics = this.overtimeService.calculateDailyCompensation({
        shiftStartAt: schedule?.shiftStartAt,
        shiftEndAt: schedule?.shiftEndAt,
        clockInTime: summary.clockInTime,
        clockOutTime: summary.clockOutTime,
        workedMinutes: summary.workedMinutes,
        leaveMinutes,
        approvedRequestMinutes: approvedMinutesByDate.get(workDateKey) ?? 0,
      });

      if (summary.workedMinutes) regularHours += summary.workedMinutes / 60;
      if (metrics.payableOvertimeMinutes) {
        overtimeHours += metrics.payableOvertimeMinutes / 60;
      }
      if (metrics.remainingLatePenaltyMinutes) {
        lateDeductionHours += metrics.remainingLatePenaltyMinutes / 60;
      }
    }

    return {
      employeeId,
      period: { start, end },
      regularHours,
      overtimeHours,
      leaveHours,
      deductibleLeaveHours,
      lateDeductionHours,
      leaveEntries,
      disasterClosures,
      details: {
        daysWorked: summaries.length,
        leavesTaken: leaves.length,
        disasterClosureDays: disasterClosures.length,
      },
    };
  }
}
