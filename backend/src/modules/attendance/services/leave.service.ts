import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { CreateLeaveRequestDto } from '../dto/create-leave-request.dto';
import { LeaveStatus, Prisma } from '@prisma/client';
import { BalanceService } from './balance.service';
import { UpsertLeaveTypeDto } from '../dto/upsert-leave-type.dto';
import { AdjustLeaveBalanceDto } from '../dto/adjust-leave-balance.dto';
import { AuditLogService } from '../../../common/audit/audit-log.service';

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly balanceService: BalanceService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async createLeaveRequest(userId: string, dto: CreateLeaveRequestDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    const leaveType = await this.prisma.leaveType.findFirst({
      where: {
        id: dto.leaveTypeId,
        entityId: employee.entityId,
        isActive: true,
      },
    });

    if (!leaveType) {
      throw new BadRequestException('Leave type not found');
    }

    // TODO: Validate balance
    // TODO: Validate notice period
    // TODO: Validate documents

    await this.balanceService.reserveLeaveHours({
      employee: {
        id: employee.id,
        entityId: employee.entityId,
        hireDate: employee.hireDate,
      },
      leaveType,
      referenceDate: new Date(dto.startAt),
      hours: dto.hours,
    });

    const leaveRequest = await this.prisma.leaveRequest.create({
      data: {
        entityId: employee.entityId,
        employeeId: employee.id,
        leaveTypeId: dto.leaveTypeId,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        hours: dto.hours,
        reason: dto.reason,
        location: dto.location,
        status: LeaveStatus.SUBMITTED,
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'leave_requests',
      recordId: leaveRequest.id,
      action: 'CREATE',
      newData: leaveRequest,
    });

    // Notify Employee
    await this.notificationService.create({
      userId: userId,
      title: 'Leave Request Submitted',
      message: `Your leave request for ${dto.hours} hours has been submitted.`,
      type: 'LEAVE_REQUEST',
      category: 'ATTENDANCE',
      data: { entityId: employee.entityId },
    });

    // TODO: Notify Manager (Need hierarchy logic)

    return leaveRequest;
  }

  async updateLeaveStatus(
    requestId: string,
    status: LeaveStatus,
    reviewerId: string,
  ) {
    const existingRequest = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: {
        employee: true,
        leaveType: true,
      },
    });

    if (!existingRequest) {
      throw new BadRequestException('Leave request not found');
    }

    await this.balanceService.reconcileLeaveRequestStatus({
      employee: {
        id: existingRequest.employee.id,
        entityId: existingRequest.entityId,
        hireDate: existingRequest.employee.hireDate,
      },
      leaveType: existingRequest.leaveType,
      referenceDate: existingRequest.startAt,
      hours: existingRequest.hours,
      fromStatus: existingRequest.status,
      toStatus: status,
    });

    const request = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status,
        reviewerId,
      },
      include: { employee: true, leaveType: true },
    });

    await this.auditLogService.record({
      userId: reviewerId,
      tableName: 'leave_requests',
      recordId: requestId,
      action: 'STATUS_CHANGE',
      oldData: {
        status: existingRequest.status,
        reviewerId: existingRequest.reviewerId,
      },
      newData: {
        status: request.status,
        reviewerId: request.reviewerId,
      },
    });

    if (request.employee?.userId) {
      await this.notificationService.create({
        userId: request.employee.userId,
        title: `Leave Request ${status}`,
        message: `Your leave request has been ${status.toLowerCase()}.`,
        type: 'LEAVE_STATUS_UPDATE',
        category: 'ATTENDANCE',
        data: { entityId: request.entityId },
      });
    }

    return request;
  }

  async getLeaveTypes(userId: string) {
    return this.balanceService.getLeaveTypesForUser(userId);
  }

  async getLeaveBalances(userId: string, year?: number) {
    return this.balanceService.getBalancesForUser(userId, year);
  }

  async getLeaveRequests(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    return this.prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      include: { leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAdminLeaveRequests(
    userId: string,
    filters: {
      status?: string;
      employeeId?: string;
      leaveTypeId?: string;
      year?: number;
      entityId?: string;
    },
  ) {
    const entityId = await this.resolveEntityId(userId, filters.entityId);
    const periodFilter =
      filters.year !== undefined
        ? {
            gte: new Date(filters.year, 0, 1),
            lte: new Date(filters.year, 11, 31, 23, 59, 59, 999),
          }
        : undefined;

    return this.prisma.leaveRequest.findMany({
      where: {
        ...(entityId ? { entityId } : {}),
        ...(filters.status ? { status: filters.status as LeaveStatus } : {}),
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters.leaveTypeId ? { leaveTypeId: filters.leaveTypeId } : {}),
        ...(periodFilter ? { startAt: periodFilter } : {}),
      },
      include: {
        employee: {
          include: {
            department: true,
          },
        },
        leaveType: true,
        reviewer: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async getAdminLeaveTypes(userId: string, entityId?: string) {
    const resolvedEntityId = await this.resolveEntityId(userId, entityId);

    return this.prisma.leaveType.findMany({
      where: resolvedEntityId ? { entityId: resolvedEntityId } : undefined,
      orderBy: [{ code: 'asc' }],
    });
  }

  async createLeaveType(userId: string, dto: UpsertLeaveTypeDto) {
    const entityId = await this.resolveEntityId(userId, dto.entityId);

    const leaveType = await this.prisma.leaveType.create({
      data: {
        entityId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        balanceResetPolicy: dto.balanceResetPolicy || 'CALENDAR_YEAR',
        requiresDocument: dto.requiresDocument ?? false,
        maxDaysPerYear:
          dto.maxDaysPerYear !== undefined
            ? new Prisma.Decimal(dto.maxDaysPerYear)
            : undefined,
        paidPercentage:
          dto.paidPercentage !== undefined
            ? new Prisma.Decimal(dto.paidPercentage)
            : undefined,
        minNoticeHours: dto.minNoticeHours,
        allowCarryOver: dto.allowCarryOver ?? false,
        carryOverLimitHours: new Prisma.Decimal(dto.carryOverLimitHours || 0),
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'leave_types',
      recordId: leaveType.id,
      action: 'CREATE',
      newData: leaveType,
    });

    return leaveType;
  }

  async updateLeaveType(userId: string, id: string, dto: UpsertLeaveTypeDto) {
    const existing = await this.prisma.leaveType.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new BadRequestException('Leave type not found');
    }

    const entityId = await this.resolveEntityId(userId, existing.entityId);
    if (entityId && existing.entityId !== entityId) {
      throw new BadRequestException('Leave type not found in current entity');
    }

    const leaveType = await this.prisma.leaveType.update({
      where: { id },
      data: {
        code: dto.code ? dto.code.trim().toUpperCase() : existing.code,
        name: dto.name ? dto.name.trim() : existing.name,
        balanceResetPolicy:
          dto.balanceResetPolicy || existing.balanceResetPolicy,
        requiresDocument: dto.requiresDocument ?? existing.requiresDocument,
        maxDaysPerYear:
          dto.maxDaysPerYear !== undefined
            ? new Prisma.Decimal(dto.maxDaysPerYear)
            : existing.maxDaysPerYear,
        paidPercentage:
          dto.paidPercentage !== undefined
            ? new Prisma.Decimal(dto.paidPercentage)
            : existing.paidPercentage,
        minNoticeHours:
          dto.minNoticeHours !== undefined
            ? dto.minNoticeHours
            : existing.minNoticeHours,
        allowCarryOver: dto.allowCarryOver ?? existing.allowCarryOver,
        carryOverLimitHours:
          dto.carryOverLimitHours !== undefined
            ? new Prisma.Decimal(dto.carryOverLimitHours)
            : existing.carryOverLimitHours,
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'leave_types',
      recordId: id,
      action: 'UPDATE',
      oldData: existing,
      newData: leaveType,
    });

    return leaveType;
  }

  async getAdminLeaveBalances(
    userId: string,
    filters: {
      year?: number;
      employeeId?: string;
      leaveTypeId?: string;
      entityId?: string;
    },
  ) {
    const entityId = await this.resolveEntityId(userId, filters.entityId);

    if (entityId) {
      const [employees, leaveTypes] = await Promise.all([
        this.prisma.employee.findMany({
          where: {
            entityId,
            ...(filters.employeeId ? { id: filters.employeeId } : {}),
            isActive: true,
          },
          select: {
            id: true,
            entityId: true,
            hireDate: true,
          },
        }),
        this.prisma.leaveType.findMany({
          where: {
            entityId,
            isActive: true,
            ...(filters.leaveTypeId ? { id: filters.leaveTypeId } : {}),
          },
        }),
      ]);

      for (const employee of employees) {
        for (const leaveType of leaveTypes.filter((type) =>
          this.balanceService.leaveTypeUsesBalance(type),
        )) {
          await this.balanceService.ensureBalanceForDate(
            employee,
            leaveType,
            this.resolveReferenceDateForAdminBalance(
              employee.hireDate,
              leaveType.balanceResetPolicy,
              filters.year,
            ),
          );
        }
      }
    }

    const balances = await this.prisma.leaveBalance.findMany({
      where: {
        ...(entityId ? { entityId } : {}),
        ...(filters.year !== undefined ? { year: filters.year } : {}),
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters.leaveTypeId ? { leaveTypeId: filters.leaveTypeId } : {}),
      },
      include: {
        leaveType: true,
        employee: {
          include: {
            department: true,
          },
        },
      },
      orderBy: [{ periodStart: 'desc' }, { employeeId: 'asc' }],
    });

    return balances.map((balance) => ({
      ...balance,
      remainingHours:
        Number(balance.accruedHours) +
        Number(balance.carryOverHours) +
        Number(balance.manualAdjustmentHours) -
        Number(balance.usedHours) -
        Number(balance.pendingHours),
      accruedHours: Number(balance.accruedHours),
      usedHours: Number(balance.usedHours),
      carryOverHours: Number(balance.carryOverHours),
      pendingHours: Number(balance.pendingHours),
      manualAdjustmentHours: Number(balance.manualAdjustmentHours),
    }));
  }

  async adjustLeaveBalance(
    userId: string,
    id: string,
    dto: AdjustLeaveBalanceDto,
  ) {
    const existing = await this.prisma.leaveBalance.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new BadRequestException('Leave balance not found');
    }

    const entityId = await this.resolveEntityId(userId, existing.entityId);
    if (entityId && existing.entityId !== entityId) {
      throw new BadRequestException(
        'Leave balance not found in current entity',
      );
    }

    const updated = await this.prisma.leaveBalance.update({
      where: { id },
      data: {
        accruedHours:
          dto.accruedHours !== undefined
            ? new Prisma.Decimal(dto.accruedHours)
            : existing.accruedHours,
        carryOverHours:
          dto.carryOverHours !== undefined
            ? new Prisma.Decimal(dto.carryOverHours)
            : existing.carryOverHours,
        manualAdjustmentHours:
          dto.manualAdjustmentHours !== undefined
            ? new Prisma.Decimal(dto.manualAdjustmentHours)
            : existing.manualAdjustmentHours,
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'leave_balances',
      recordId: id,
      action: 'ADJUST',
      oldData: existing,
      newData: updated,
    });

    return updated;
  }

  private async resolveEntityId(userId: string, requestedEntityId?: string) {
    if (requestedEntityId) {
      return requestedEntityId;
    }

    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { entityId: true },
    });

    if (employee?.entityId) {
      return employee.entityId;
    }

    const firstEntity = await this.prisma.entity.findFirst({
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    if (!firstEntity) {
      throw new BadRequestException('Entity not found');
    }

    return firstEntity.id;
  }

  private resolveReferenceDateForAdminBalance(
    hireDate: Date,
    balanceResetPolicy: string,
    year?: number,
  ) {
    if (year === undefined) {
      return new Date();
    }

    if (balanceResetPolicy === 'HIRE_ANNIVERSARY') {
      return new Date(
        year,
        hireDate.getMonth(),
        hireDate.getDate(),
        12,
        0,
        0,
        0,
      );
    }

    return new Date(year, 11, 31, 12, 0, 0, 0);
  }
}
