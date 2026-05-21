import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ClockInDto } from '../dto/clock-in.dto';
import { ClockOutDto } from '../dto/clock-out.dto';
import { ScheduleService } from './schedule.service';
import { PolicyService } from './policy.service';
import { GpsValidationStrategy } from '../strategies/gps-validation.strategy';
import { IpValidationStrategy } from '../strategies/ip-validation.strategy';
import { AttendanceEventType, AttendanceMethod } from '@prisma/client';
import { UsersService } from '../../users/users.service';
import { AuditLogService } from '../../../common/audit/audit-log.service';
import { AdminAdjustAttendanceDto } from '../dto/admin-adjust-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
    private readonly policyService: PolicyService,
    private readonly gpsStrategy: GpsValidationStrategy,
    private readonly ipStrategy: IpValidationStrategy,
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async getAdminAccessContext(userId: string) {
    return this.usersService.getDataAccessContext(userId, 'attendance');
  }

  async clockIn(userId: string, dto: ClockInDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    const now = new Date();
    const schedule = await this.scheduleService.getScheduleForDate(
      employee.id,
      now,
    );
    const policy = this.policyService.resolvePolicy(schedule?.policy);

    if (policy?.requiresPhoto && !dto.photoUrl) {
      throw new ForbiddenException('Photo is required by attendance policy.');
    }

    if (schedule && now < schedule.allowedClockInFrom) {
      throw new ForbiddenException(
        `Clock-in is allowed after ${schedule.allowedClockInFrom.toISOString()}.`,
      );
    }

    let isWithinFence = true;
    let isWithinIpRange = true;

    if (policy?.geofence) {
      const hasCoordinates =
        typeof dto.latitude === 'number' && typeof dto.longitude === 'number';
      if (!hasCoordinates) {
        isWithinFence = false;
      } else {
        isWithinFence = this.gpsStrategy.validate(
          dto.latitude,
          dto.longitude,
          policy.geofence,
        );
        if (!isWithinFence) {
          throw new ForbiddenException(
            'You are outside the allowed clock-in area.',
          );
        }
      }
    }

    if (policy?.ipAllowList) {
      if (!dto.ipAddress) {
        throw new ForbiddenException('IP address is required by policy.');
      }
      isWithinIpRange = this.ipStrategy.validate(
        dto.ipAddress,
        policy.ipAllowList,
      );
      if (!isWithinIpRange) {
        throw new ForbiddenException(
          `IP address ${dto.ipAddress} is not authorized.`,
        );
      }
    }

    const record = await this.prisma.attendanceRecord.create({
      data: {
        entityId: employee.entityId,
        employeeId: employee.id,
        scheduleId: schedule?.id,
        eventType: AttendanceEventType.CLOCK_IN,
        method: dto.method,
        timestamp: now,
        latitude: dto.latitude,
        longitude: dto.longitude,
        ipAddress: dto.ipAddress,
        deviceInfo: dto.deviceInfo ?? undefined,
        photoUrl: dto.photoUrl,
        isWithinFence,
        isWithinIpRange,
        notes: dto.notes,
      },
    });

    // Update Daily Summary
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.attendanceDailySummary.upsert({
      where: {
        entityId_employeeId_workDate: {
          entityId: employee.entityId,
          employeeId: employee.id,
          workDate: today,
        },
      },
      update: {
        clockInTime: record.timestamp,
        breakMinutes: schedule?.breakMinutes ?? 0,
        status:
          schedule && record.timestamp > schedule.lateThreshold
            ? 'late'
            : 'pending',
      },
      create: {
        entityId: employee.entityId,
        employeeId: employee.id,
        workDate: today,
        clockInTime: record.timestamp,
        breakMinutes: schedule?.breakMinutes ?? 0,
        status:
          schedule && record.timestamp > schedule.lateThreshold
            ? 'late'
            : 'pending',
      },
    });

    return record;
  }

  async clockOut(userId: string, dto: ClockOutDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    const now = new Date();
    const schedule = await this.scheduleService.getScheduleForDate(
      employee.id,
      now,
    );
    const policy = this.policyService.resolvePolicy(schedule?.policy);

    if (policy?.requiresPhoto && !dto.photoUrl) {
      throw new ForbiddenException('Photo is required by attendance policy.');
    }

    let isWithinFence = true;
    let isWithinIpRange = true;

    if (policy?.geofence) {
      const hasCoordinates =
        typeof dto.latitude === 'number' && typeof dto.longitude === 'number';
      if (!hasCoordinates) {
        isWithinFence = false;
      } else {
        isWithinFence = this.gpsStrategy.validate(
          dto.latitude,
          dto.longitude,
          policy.geofence,
        );
        if (!isWithinFence) {
          throw new ForbiddenException(
            'You are outside the allowed clock-out area.',
          );
        }
      }
    }

    if (policy?.ipAllowList) {
      if (!dto.ipAddress) {
        throw new ForbiddenException('IP address is required by policy.');
      }
      isWithinIpRange = this.ipStrategy.validate(
        dto.ipAddress,
        policy.ipAllowList,
      );
      if (!isWithinIpRange) {
        throw new ForbiddenException(
          `IP address ${dto.ipAddress} is not authorized.`,
        );
      }
    }

    const record = await this.prisma.attendanceRecord.create({
      data: {
        entityId: employee.entityId,
        employeeId: employee.id,
        scheduleId: schedule?.id,
        eventType: AttendanceEventType.CLOCK_OUT,
        method: dto.method,
        timestamp: now,
        latitude: dto.latitude,
        longitude: dto.longitude,
        ipAddress: dto.ipAddress,
        deviceInfo: dto.deviceInfo ?? undefined,
        photoUrl: dto.photoUrl,
        isWithinFence,
        isWithinIpRange,
        notes: dto.notes,
      },
    });

    // Update Daily Summary
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate worked minutes (simplified)
    const summary = await this.prisma.attendanceDailySummary.findUnique({
      where: {
        entityId_employeeId_workDate: {
          entityId: employee.entityId,
          employeeId: employee.id,
          workDate: today,
        },
      },
    });

    let workedMinutes = 0;
    let breakMinutes = schedule?.breakMinutes ?? summary?.breakMinutes ?? 0;
    let overtimeMinutes = 0;
    if (summary && summary.clockInTime) {
      const diffMs = record.timestamp.getTime() - summary.clockInTime.getTime();
      workedMinutes = Math.max(0, Math.floor(diffMs / 60000) - breakMinutes);
    }

    if (schedule && record.timestamp > schedule.shiftEndAt) {
      overtimeMinutes = Math.max(
        0,
        Math.floor(
          (record.timestamp.getTime() - schedule.shiftEndAt.getTime()) / 60000,
        ),
      );
    }

    await this.prisma.attendanceDailySummary.upsert({
      where: {
        entityId_employeeId_workDate: {
          entityId: employee.entityId,
          employeeId: employee.id,
          workDate: today,
        },
      },
      update: {
        clockOutTime: record.timestamp,
        workedMinutes: workedMinutes,
        breakMinutes,
        overtimeMinutes,
        status: summary?.clockInTime
          ? summary.status === 'late'
            ? 'late'
            : 'completed'
          : 'missing_clock',
      },
      create: {
        entityId: employee.entityId,
        employeeId: employee.id,
        workDate: today,
        clockOutTime: record.timestamp,
        workedMinutes: 0,
        breakMinutes,
        overtimeMinutes,
        status: 'missing_clock',
      },
    });

    return record;
  }

  private buildAttendanceAccessWhere(access: {
    scope: 'SELF' | 'DEPARTMENT' | 'ENTITY';
    entityId: string;
    employeeId: string | null;
    departmentId: string | null;
    noAccess: boolean;
  }) {
    if (access.noAccess) {
      return { employeeId: '__no_access__' };
    }

    if (access.scope === 'SELF') {
      return { employeeId: access.employeeId || '__no_access__' };
    }

    if (access.scope === 'DEPARTMENT') {
      return {
        employee: { departmentId: access.departmentId || '__no_access__' },
      };
    }

    return {};
  }

  async getDailySummaries(userId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    const access = await this.getAdminAccessContext(userId);

    return this.prisma.attendanceDailySummary.findMany({
      where: {
        entityId: access.entityId,
        workDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
        ...this.buildAttendanceAccessWhere(access),
      },
      include: {
        employee: { include: { department: true } },
      },
      orderBy: [{ employee: { employeeNo: 'asc' } }],
    });
  }

  async getAttendanceRecords(
    userId: string,
    filters: {
      startDate?: Date;
      endDate?: Date;
      employeeId?: string;
      employeeStatus?: string;
      attendanceType?: string;
    },
  ) {
    const access = await this.getAdminAccessContext(userId);
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();
    endDate.setHours(23, 59, 59, 999);

    if (endDate < startDate) {
      throw new BadRequestException('查詢結束日不可早於開始日');
    }

    const employeeWhere: Record<string, any> = {};
    const normalizedEmployeeStatus = String(filters.employeeStatus || 'ALL')
      .trim()
      .toUpperCase();
    if (normalizedEmployeeStatus === 'ACTIVE') {
      employeeWhere.isActive = true;
    } else if (normalizedEmployeeStatus === 'TERMINATED') {
      employeeWhere.isActive = false;
    }

    const normalizedAttendanceType = String(filters.attendanceType || 'ALL')
      .trim()
      .toUpperCase();
    if (
      normalizedAttendanceType === 'INTERNAL' ||
      normalizedAttendanceType === 'EXTERNAL'
    ) {
      employeeWhere.attendanceType = normalizedAttendanceType;
    }

    const accessWhere = this.buildAttendanceAccessWhere(access);
    const accessEmployeeWhere =
      'employee' in accessWhere && accessWhere.employee
        ? accessWhere.employee
        : {};

    return this.prisma.attendanceDailySummary.findMany({
      where: {
        entityId: access.entityId,
        workDate: {
          gte: startDate,
          lte: endDate,
        },
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(Object.keys({ ...accessEmployeeWhere, ...employeeWhere }).length
          ? { employee: { ...accessEmployeeWhere, ...employeeWhere } }
          : {}),
        ...('employeeId' in accessWhere
          ? { employeeId: accessWhere.employeeId }
          : {}),
      },
      include: {
        employee: { include: { department: true } },
      },
      orderBy: [{ workDate: 'desc' }, { employee: { employeeNo: 'asc' } }],
    });
  }

  async adjustAdminAttendance(
    userId: string,
    dto: AdminAdjustAttendanceDto,
  ) {
    const access = await this.getAdminAccessContext(userId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: { department: true },
    });

    if (!employee || employee.entityId !== access.entityId) {
      throw new BadRequestException('Employee record not found');
    }

    const canAccessEmployee =
      !access.noAccess &&
      (access.scope === 'ENTITY' ||
        (access.scope === 'SELF' && access.employeeId === employee.id) ||
        (access.scope === 'DEPARTMENT' &&
          access.departmentId === employee.departmentId));
    if (!canAccessEmployee) {
      throw new BadRequestException('Employee record not found');
    }

    const workDate = new Date(dto.workDate);
    if (Number.isNaN(workDate.getTime())) {
      throw new BadRequestException('出勤日期格式不正確');
    }
    workDate.setHours(0, 0, 0, 0);

    const clockInAt = dto.clockInAt ? new Date(dto.clockInAt) : null;
    const clockOutAt = dto.clockOutAt ? new Date(dto.clockOutAt) : null;
    if (!clockInAt && !clockOutAt) {
      throw new BadRequestException('請至少提供上班或下班時間');
    }
    if (clockInAt && Number.isNaN(clockInAt.getTime())) {
      throw new BadRequestException('上班時間格式不正確');
    }
    if (clockOutAt && Number.isNaN(clockOutAt.getTime())) {
      throw new BadRequestException('下班時間格式不正確');
    }
    if (clockInAt && clockOutAt && clockOutAt <= clockInAt) {
      throw new BadRequestException('下班時間必須晚於上班時間');
    }

    const [existingSummary, schedule] = await Promise.all([
      this.prisma.attendanceDailySummary.findUnique({
        where: {
          entityId_employeeId_workDate: {
            entityId: employee.entityId,
            employeeId: employee.id,
            workDate,
          },
        },
      }),
      this.scheduleService.getScheduleForDate(employee.id, workDate),
    ]);

    const nextClockInTime = clockInAt ?? existingSummary?.clockInTime ?? null;
    const nextClockOutTime = clockOutAt ?? existingSummary?.clockOutTime ?? null;
    const breakMinutes =
      dto.breakMinutes ??
      existingSummary?.breakMinutes ??
      schedule?.breakMinutes ??
      0;
    const workedMinutes =
      nextClockInTime && nextClockOutTime
        ? Math.max(
            0,
            Math.floor(
              (nextClockOutTime.getTime() - nextClockInTime.getTime()) / 60000,
            ) - breakMinutes,
          )
        : 0;
    const overtimeMinutes =
      schedule && nextClockOutTime && nextClockOutTime > schedule.shiftEndAt
        ? Math.max(
            0,
            Math.floor(
              (nextClockOutTime.getTime() - schedule.shiftEndAt.getTime()) /
                60000,
            ),
          )
        : 0;

    const isLate =
      Boolean(schedule && nextClockInTime && nextClockInTime > schedule.lateThreshold);
    const status =
      nextClockInTime && nextClockOutTime
        ? isLate
          ? 'late'
          : 'completed'
        : 'missing_clock';
    const anomalyReason =
      status === 'missing_clock'
        ? '管理員已補登部分打卡時間，仍需確認另一筆打卡。'
        : null;
    const note = dto.note?.trim() || '管理員補登出勤時間';

    const updatedSummary = await this.prisma.$transaction(async (tx) => {
      if (clockInAt) {
        await tx.attendanceRecord.create({
          data: {
            entityId: employee.entityId,
            employeeId: employee.id,
            scheduleId: schedule?.id,
            eventType: AttendanceEventType.CLOCK_IN,
            method: AttendanceMethod.WEB,
            timestamp: clockInAt,
            notes: note,
          },
        });
      }

      if (clockOutAt) {
        await tx.attendanceRecord.create({
          data: {
            entityId: employee.entityId,
            employeeId: employee.id,
            scheduleId: schedule?.id,
            eventType: AttendanceEventType.CLOCK_OUT,
            method: AttendanceMethod.WEB,
            timestamp: clockOutAt,
            notes: note,
          },
        });
      }

      return tx.attendanceDailySummary.upsert({
        where: {
          entityId_employeeId_workDate: {
            entityId: employee.entityId,
            employeeId: employee.id,
            workDate,
          },
        },
        update: {
          clockInTime: nextClockInTime,
          clockOutTime: nextClockOutTime,
          breakMinutes,
          workedMinutes,
          overtimeMinutes,
          status,
          anomalyReason,
        },
        create: {
          entityId: employee.entityId,
          employeeId: employee.id,
          workDate,
          clockInTime: nextClockInTime,
          clockOutTime: nextClockOutTime,
          breakMinutes,
          workedMinutes,
          overtimeMinutes,
          status,
          anomalyReason,
        },
        include: {
          employee: { include: { department: true } },
        },
      });
    });

    await this.auditLogService.record({
      userId,
      tableName: 'attendance_daily_summaries',
      recordId: updatedSummary.id,
      action: 'ADMIN_ADJUST',
      oldData: existingSummary,
      newData: {
        clockInTime: nextClockInTime,
        clockOutTime: nextClockOutTime,
        breakMinutes,
        workedMinutes,
        overtimeMinutes,
        status,
        note,
      },
    });

    return updatedSummary;
  }
}
