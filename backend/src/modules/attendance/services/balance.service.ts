import { BadRequestException, Injectable } from '@nestjs/common';
import { LeaveStatus, LeaveType, Prisma } from '@prisma/client';
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

type SeniorityTier = {
  minYears: number;
  maxYears?: number;
  days: number;
};

type AnnualLeaveTerminationAdjustment = {
  excessHours: number;
  excessDays: number;
  vestedHours: number;
  vestedDays: number;
  usedHours: number;
  usedDays: number;
  serviceMonths: number;
  stageStart: Date;
  stageEnd: Date;
  note?: string;
};

const DEFAULT_TW_ANNUAL_LEAVE_TIERS: SeniorityTier[] = [
  { minYears: 0.5, maxYears: 1, days: 3 },
  { minYears: 1, maxYears: 2, days: 7 },
  { minYears: 2, maxYears: 3, days: 10 },
  { minYears: 3, maxYears: 5, days: 14 },
  { minYears: 5, maxYears: 10, days: 15 },
  { minYears: 10, days: 16 },
];

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
        hireDate: true,
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    const leaveTypes = await this.prisma.leaveType.findMany({
      where: {
        entityId: employee.entityId,
        isActive: true,
      },
      orderBy: [{ code: 'asc' }],
    });

    for (const leaveType of leaveTypes) {
      if (!this.leaveTypeUsesBalance(leaveType)) {
        continue;
      }

      await this.ensureBalanceForDate(
        {
          id: employee.id,
          entityId: employee.entityId,
          hireDate: employee.hireDate,
        },
        leaveType,
        this.resolveReferenceDateForYear(employee.hireDate, leaveType, year),
      );
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

    const accruedHours = this.calculateDefaultAccruedHours(
      leaveType,
      employee,
      leaveType.balanceResetPolicy === 'CALENDAR_YEAR'
        ? period.end
        : referenceDate,
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
      if (
        existing.periodStart.getTime() !== period.start.getTime() ||
        existing.periodEnd.getTime() !== period.end.getTime() ||
        !existing.accruedHours.equals(accruedHours)
      ) {
        return this.prisma.leaveBalance.update({
          where: { id: existing.id },
          data: {
            periodStart: period.start,
            periodEnd: period.end,
            accruedHours,
          },
        });
      }

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
        accruedHours,
        carryOverHours,
      },
    });
  }

  async getTerminationAnnualLeaveAdjustment(
    employeeId: string,
    terminateDate: Date,
  ): Promise<AnnualLeaveTerminationAdjustment | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        entityId: true,
        hireDate: true,
        country: true,
      },
    });

    if (!employee || employee.country !== 'TW') {
      return null;
    }

    const annualLeaveType = await this.prisma.leaveType.findFirst({
      where: {
        entityId: employee.entityId,
        isActive: true,
        OR: [
          { code: 'ANNUAL' },
          { name: '特休' },
          { name: '特別休假' },
        ],
      },
    });

    if (!annualLeaveType) {
      return null;
    }

    const stage = this.resolveAnnualLeaveSettlementStage(
      employee.hireDate,
      terminateDate,
    );
    const usedHours = await this.sumApprovedAnnualLeaveHours({
      employeeId: employee.id,
      leaveTypeId: annualLeaveType.id,
      stageStart: stage.stageStart,
      terminateDate,
    });
    const serviceMonths = this.roundTo(
      this.calculateServiceMonths(stage.stageStart, terminateDate),
    );
    const vestedDays = this.roundTo(
      (stage.fullStageDays * Math.min(serviceMonths, 12)) / 12,
    );
    const vestedHours = this.roundTo(vestedDays * 8);
    const excessHours = this.roundTo(Math.max(0, usedHours - vestedHours));
    const excessDays = this.roundTo(excessHours / 8);
    const usedDays = this.roundTo(usedHours / 8);

    return {
      excessHours,
      excessDays,
      vestedHours,
      vestedDays,
      usedHours,
      usedDays,
      serviceMonths,
      stageStart: stage.stageStart,
      stageEnd: terminateDate,
      note:
        excessHours > 0
          ? `曆年制離職結算：按 ${serviceMonths} 個月比例可得 ${vestedDays} 天，已請特休 ${usedDays} 天，超休 ${excessDays} 天需轉事假扣薪。`
          : undefined,
    };
  }

  leaveTypeUsesBalance(leaveType: LeaveType) {
    return (
      leaveType.balanceResetPolicy !== 'NONE' &&
      (leaveType.maxDaysPerYear !== null ||
        this.isAnnualLeaveType(leaveType) ||
        this.getSeniorityTiers(leaveType).length > 0)
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

  private calculateDefaultAccruedHours(
    leaveType: LeaveType,
    employee: EmployeeRecord,
    referenceDate: Date,
  ) {
    const tierDays = this.calculateTierDays(leaveType, employee, referenceDate);
    if (tierDays !== null) {
      return new Prisma.Decimal(tierDays).mul(8);
    }

    if (leaveType.maxDaysPerYear !== null) {
      return leaveType.maxDaysPerYear.mul(8);
    }

    const days = leaveType.maxDaysPerYear || new Prisma.Decimal(0);
    return days.mul(8);
  }

  private calculateTierDays(
    leaveType: LeaveType,
    employee: EmployeeRecord,
    referenceDate: Date,
  ) {
    const tiers = this.getSeniorityTiers(leaveType);
    if (tiers.length === 0) {
      return null;
    }

    const serviceYears = this.calculateServiceYears(
      employee.hireDate,
      referenceDate,
    );
    const matchedTier = tiers.find((tier) => {
      if (serviceYears < tier.minYears) {
        return false;
      }

      if (tier.maxYears === undefined) {
        return true;
      }

      return serviceYears < tier.maxYears;
    });

    if (!matchedTier) {
      return 0;
    }

    if (matchedTier.minYears >= 10 && matchedTier.maxYears === undefined) {
      const additionalYears = Math.max(0, Math.floor(serviceYears) - 10);
      return Math.min(30, matchedTier.days + additionalYears);
    }

    return matchedTier.days;
  }

  private calculateServiceYears(hireDate: Date, referenceDate: Date) {
    const diffMs = referenceDate.getTime() - hireDate.getTime();
    if (diffMs <= 0) {
      return 0;
    }

    return diffMs / (365.2425 * 24 * 60 * 60 * 1000);
  }

  private resolveAnnualLeaveSettlementStage(
    hireDate: Date,
    terminateDate: Date,
  ) {
    const completedYears = Math.max(
      0,
      Math.floor(this.calculateServiceMonths(hireDate, terminateDate) / 12),
    );
    const stageStart = this.addYears(this.startOfDay(hireDate), completedYears);

    return {
      stageStart,
      fullStageDays: this.getAnnualLeaveStageDays(completedYears),
    };
  }

  private getAnnualLeaveStageDays(completedYears: number) {
    if (completedYears <= 0) {
      return 7;
    }

    if (completedYears === 1) {
      return 10;
    }

    if (completedYears === 2 || completedYears === 3) {
      return 14;
    }

    if (completedYears >= 4 && completedYears < 10) {
      return 15;
    }

    return Math.min(30, 16 + Math.max(0, completedYears - 10));
  }

  private calculateServiceMonths(startDate: Date, endDate: Date) {
    const start = this.startOfDay(startDate);
    const end = this.startOfDay(endDate);
    if (end <= start) {
      return 0;
    }

    let fullMonths =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    let anchor = this.addMonths(start, fullMonths);

    if (anchor > end) {
      fullMonths -= 1;
      anchor = this.addMonths(start, fullMonths);
    }

    const nextAnchor = this.addMonths(anchor, 1);
    const remainderMs = end.getTime() - anchor.getTime();
    const monthMs = nextAnchor.getTime() - anchor.getTime();

    return fullMonths + Math.max(0, remainderMs / monthMs);
  }

  private async sumApprovedAnnualLeaveHours(params: {
    employeeId: string;
    leaveTypeId: string;
    stageStart: Date;
    terminateDate: Date;
  }) {
    const aggregate = await this.prisma.leaveRequest.aggregate({
      where: {
        employeeId: params.employeeId,
        leaveTypeId: params.leaveTypeId,
        status: LeaveStatus.APPROVED,
        startAt: { lte: params.terminateDate },
        endAt: { gte: params.stageStart },
      },
      _sum: {
        hours: true,
      },
    });

    return Number(aggregate._sum.hours || 0);
  }

  private addYears(date: Date, years: number) {
    const next = new Date(date);
    next.setFullYear(next.getFullYear() + years);
    return next;
  }

  private addMonths(date: Date, months: number) {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
  }

  private startOfDay(date: Date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
  }

  private roundTo(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private getSeniorityTiers(leaveType: LeaveType): SeniorityTier[] {
    const metadata = leaveType.metadata as
      | { seniorityTiers?: SeniorityTier[] }
      | null
      | undefined;
    const configuredTiers = Array.isArray(metadata?.seniorityTiers)
      ? metadata.seniorityTiers
          .filter(
            (tier) =>
              typeof tier?.minYears === 'number' &&
              typeof tier?.days === 'number',
          )
          .map((tier) => ({
            minYears: tier.minYears,
            maxYears: tier.maxYears,
            days: tier.days,
          }))
      : [];

    if (configuredTiers.length > 0) {
      return configuredTiers.sort((a, b) => a.minYears - b.minYears);
    }

    if (this.isAnnualLeaveType(leaveType)) {
      return DEFAULT_TW_ANNUAL_LEAVE_TIERS;
    }

    return [];
  }

  private isAnnualLeaveType(leaveType: LeaveType) {
    const code = leaveType.code.trim().toUpperCase();
    const name = leaveType.name.trim();

    return code === 'ANNUAL' || ['特休', '特別休假'].includes(name);
  }

  private resolveReferenceDateForYear(
    hireDate: Date,
    leaveType: LeaveType,
    requestedYear?: number,
  ) {
    if (requestedYear === undefined) {
      return new Date();
    }

    if (leaveType.balanceResetPolicy === 'HIRE_ANNIVERSARY') {
      return new Date(
        requestedYear,
        hireDate.getMonth(),
        hireDate.getDate(),
        12,
        0,
        0,
        0,
      );
    }

    return new Date(requestedYear, 11, 31, 12, 0, 0, 0);
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

      if (
        ['REJECTED', 'CANCELLED'].includes(fromStatus) &&
        ['SUBMITTED', 'UNDER_REVIEW'].includes(toStatus)
      ) {
        next = next.add(hours);
      }
    }

    if (target === 'used') {
      if (fromStatus !== 'APPROVED' && toStatus === 'APPROVED') {
        next = next.add(hours);
      }

      if (
        fromStatus === 'APPROVED' &&
        ['REJECTED', 'CANCELLED'].includes(toStatus)
      ) {
        next = next.sub(hours);
      }
    }

    return next.lessThan(0) ? new Prisma.Decimal(0) : next;
  }
}
