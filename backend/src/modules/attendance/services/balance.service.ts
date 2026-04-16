import { BadRequestException, Injectable } from '@nestjs/common';
import { LeaveType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

type EmployeeRecord = {
  id: string;
  entityId: string;
  hireDate: Date;
};

type BalancePeriod = {
  year: number;
  start: Date;
  end: Date;
};

@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getLeaveTypesForUser(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { entityId: true },
    });

    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    return this.prisma.leaveType.findMany({
      where: {
        entityId: employee.entityId,
        isActive: true,
      },
      orderBy: [{ code: 'asc' }],
    });
  }

  async getBalancesForUser(userId: string, year?: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: {
        id: true,
        entityId: true,
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    const balances = await this.prisma.leaveBalance.findMany({
      where: {
        entityId: employee.entityId,
        employeeId: employee.id,
        ...(year ? { year } : {}),
      },
      include: {
        leaveType: true,
      },
      orderBy: [{ periodStart: 'desc' }, { leaveTypeId: 'asc' }],
    });

    return balances.map((balance) => ({
      ...balance,
      remainingHours: this.calculateRemainingHours(balance).toNumber(),
      accruedHours: Number(balance.accruedHours),
      usedHours: Number(balance.usedHours),
      carryOverHours: Number(balance.carryOverHours),
      pendingHours: Number(balance.pendingHours),
      manualAdjustmentHours: Number(balance.manualAdjustmentHours),
    }));
  }

  async reserveLeaveHours(params: {
    employee: EmployeeRecord;
    leaveType: LeaveType;
    referenceDate: Date;
    hours: number;
  }) {
    if (!this.leaveTypeUsesBalance(params.leaveType)) {
      return null;
    }

    const balance = await this.ensureBalanceForDate(
      params.employee,
      params.leaveType,
      params.referenceDate,
    );
    const requestedHours = new Prisma.Decimal(params.hours);
    const remaining = this.calculateRemainingHours(balance);

    if (remaining.lessThan(requestedHours)) {
      throw new BadRequestException(
        `剩餘假別額度不足，尚餘 ${remaining.toFixed(2)} 小時。`,
      );
    }

    return this.prisma.leaveBalance.update({
      where: { id: balance.id },
      data: {
        pendingHours: balance.pendingHours.add(requestedHours),
      },
    });
  }

  async reconcileLeaveRequestStatus(params: {
    employee: EmployeeRecord;
    leaveType: LeaveType;
    referenceDate: Date;
    hours: Prisma.Decimal;
    fromStatus: string;
    toStatus: string;
  }) {
    if (!this.leaveTypeUsesBalance(params.leaveType)) {
      return null;
    }

    const balance = await this.ensureBalanceForDate(
      params.employee,
      params.leaveType,
      params.referenceDate,
    );

    const nextPending = this.computeStatusTransitionValue(
      params.hours,
      balance.pendingHours,
      params.fromStatus,
      params.toStatus,
      'pending',
    );
    const nextUsed = this.computeStatusTransitionValue(
      params.hours,
      balance.usedHours,
      params.fromStatus,
      params.toStatus,
      'used',
    );

    return this.prisma.leaveBalance.update({
      where: { id: balance.id },
      data: {
        pendingHours: nextPending,
        usedHours: nextUsed,
      },
    });
  }

  async ensureBalanceForDate(
    employee: EmployeeRecord,
    leaveType: LeaveType,
    referenceDate: Date,
  ) {
    const period = this.resolveBalancePeriod(
      leaveType.balanceResetPolicy,
      employee.hireDate,
      referenceDate,
    );

    const existing = await this.prisma.leaveBalance.findUnique({
      where: {
        entityId_employeeId_leaveTypeId_year: {
          entityId: employee.entityId,
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          year: period.year,
        },
      },
    });

    if (existing) {
      return existing;
    }

    const carryOverHours = await this.calculateCarryOverHours(
      employee.entityId,
      employee.id,
      leaveType,
      period.year,
    );

    return this.prisma.leaveBalance.create({
      data: {
        entityId: employee.entityId,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        year: period.year,
        periodStart: period.start,
        periodEnd: period.end,
        accruedHours: this.calculateDefaultAccruedHours(leaveType),
        carryOverHours,
      },
    });
  }

  private leaveTypeUsesBalance(leaveType: LeaveType) {
    return (
      leaveType.balanceResetPolicy !== 'NONE' &&
      leaveType.maxDaysPerYear !== null
    );
  }

  private resolveBalancePeriod(
    resetPolicy: string,
    hireDate: Date,
    referenceDate: Date,
  ): BalancePeriod {
    if (resetPolicy === 'HIRE_ANNIVERSARY') {
      const start = new Date(referenceDate);
      start.setHours(0, 0, 0, 0);
      start.setMonth(hireDate.getMonth(), hireDate.getDate());

      if (start > referenceDate) {
        start.setFullYear(start.getFullYear() - 1);
      }

      const end = new Date(start);
      end.setFullYear(end.getFullYear() + 1);
      end.setMilliseconds(end.getMilliseconds() - 1);

      return {
        year: start.getFullYear(),
        start,
        end,
      };
    }

    const start = new Date(referenceDate.getFullYear(), 0, 1);
    const end = new Date(referenceDate.getFullYear(), 11, 31, 23, 59, 59, 999);

    return {
      year: referenceDate.getFullYear(),
      start,
      end,
    };
  }

  private calculateDefaultAccruedHours(leaveType: LeaveType) {
    const days = leaveType.maxDaysPerYear || new Prisma.Decimal(0);
    return days.mul(8);
  }

  private async calculateCarryOverHours(
    entityId: string,
    employeeId: string,
    leaveType: LeaveType,
    year: number,
  ) {
    if (!leaveType.allowCarryOver) {
      return new Prisma.Decimal(0);
    }

    const previousBalance = await this.prisma.leaveBalance.findUnique({
      where: {
        entityId_employeeId_leaveTypeId_year: {
          entityId,
          employeeId,
          leaveTypeId: leaveType.id,
          year: year - 1,
        },
      },
    });

    if (!previousBalance) {
      return new Prisma.Decimal(0);
    }

    const previousRemaining = this.calculateRemainingHours(previousBalance);
    const limit = leaveType.carryOverLimitHours || new Prisma.Decimal(0);

    if (limit.lessThanOrEqualTo(0)) {
      return previousRemaining;
    }

    return previousRemaining.lessThan(limit) ? previousRemaining : limit;
  }

  private calculateRemainingHours(balance: {
    accruedHours: Prisma.Decimal;
    carryOverHours: Prisma.Decimal;
    manualAdjustmentHours: Prisma.Decimal;
    usedHours: Prisma.Decimal;
    pendingHours: Prisma.Decimal;
  }) {
    return balance.accruedHours
      .add(balance.carryOverHours)
      .add(balance.manualAdjustmentHours)
      .sub(balance.usedHours)
      .sub(balance.pendingHours);
  }

  private computeStatusTransitionValue(
    hours: Prisma.Decimal,
    current: Prisma.Decimal,
    fromStatus: string,
    toStatus: string,
    target: 'pending' | 'used',
  ) {
    let next = current;

    if (target === 'pending') {
      if (['SUBMITTED', 'UNDER_REVIEW'].includes(fromStatus)) {
        if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(toStatus)) {
          next = next.sub(hours);
        }
      }

      if (['REJECTED', 'CANCELLED'].includes(fromStatus) && ['SUBMITTED', 'UNDER_REVIEW'].includes(toStatus)) {
        next = next.add(hours);
      }
    }

    if (target === 'used') {
      if (fromStatus !== 'APPROVED' && toStatus === 'APPROVED') {
        next = next.add(hours);
      }

      if (fromStatus === 'APPROVED' && ['REJECTED', 'CANCELLED'].includes(toStatus)) {
        next = next.sub(hours);
      }
    }

    return next.lessThan(0) ? new Prisma.Decimal(0) : next;
  }
}
