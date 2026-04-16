import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class AttendanceIntegrationService {
  constructor(private readonly prisma: PrismaService) {}

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

    // 3. Calculate Totals
    let regularHours = 0;
    let overtimeHours = 0;
    let leaveHours = 0;
    let deductibleLeaveHours = 0;

    for (const summary of summaries) {
      if (summary.workedMinutes) regularHours += summary.workedMinutes / 60;
      if (summary.overtimeMinutes) overtimeHours += summary.overtimeMinutes / 60;
    }

    const leaveEntries = leaves.map((leave) => {
      const paidPercentage = Number(leave.leaveType.paidPercentage || 100);
      const hours = Number(leave.hours);
      const deductionFactor = Math.max(0, (100 - paidPercentage) / 100);

      deductibleLeaveHours += hours * deductionFactor;
      leaveHours += hours;

      return {
        id: leave.id,
        code: leave.leaveType.code,
        name: leave.leaveType.name,
        hours,
        paidPercentage,
        deductionFactor,
      };
    });

    return {
      employeeId,
      period: { start, end },
      regularHours,
      overtimeHours,
      leaveHours,
      deductibleLeaveHours,
      leaveEntries,
      details: {
        daysWorked: summaries.length,
        leavesTaken: leaves.length,
      },
    };
  }
}
