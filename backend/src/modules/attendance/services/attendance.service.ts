import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ClockInDto } from '../dto/clock-in.dto';
import { ClockOutDto } from '../dto/clock-out.dto';
import { ScheduleService } from './schedule.service';
import { PolicyService } from './policy.service';
import { GpsValidationStrategy } from '../strategies/gps-validation.strategy';
import { IpValidationStrategy } from '../strategies/ip-validation.strategy';
import { AttendanceEventType } from '@prisma/client';
import { UsersService } from '../../users/users.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
    private readonly policyService: PolicyService,
    private readonly gpsStrategy: GpsValidationStrategy,
    private readonly ipStrategy: IpValidationStrategy,
    private readonly usersService: UsersService,
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
    const schedule = await this.scheduleService.getScheduleForDate(employee.id, now);
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
      if (!dto.latitude || !dto.longitude) {
        throw new ForbiddenException('Location data is required by policy.');
      }
      isWithinFence = this.gpsStrategy.validate(
        dto.latitude,
        dto.longitude,
        policy.geofence,
      );
      if (!isWithinFence) {
        throw new ForbiddenException('You are outside the allowed clock-in area.');
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
          schedule && record.timestamp > schedule.lateThreshold ? 'late' : 'pending',
      },
      create: {
        entityId: employee.entityId,
        employeeId: employee.id,
        workDate: today,
        clockInTime: record.timestamp,
        breakMinutes: schedule?.breakMinutes ?? 0,
        status:
          schedule && record.timestamp > schedule.lateThreshold ? 'late' : 'pending',
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
    const schedule = await this.scheduleService.getScheduleForDate(employee.id, now);
    const policy = this.policyService.resolvePolicy(schedule?.policy);

    if (policy?.requiresPhoto && !dto.photoUrl) {
      throw new ForbiddenException('Photo is required by attendance policy.');
    }

    let isWithinFence = true;
    let isWithinIpRange = true;

    if (policy?.geofence) {
      if (!dto.latitude || !dto.longitude) {
        throw new ForbiddenException('Location data is required by policy.');
      }
      isWithinFence = this.gpsStrategy.validate(
        dto.latitude,
        dto.longitude,
        policy.geofence,
      );
      if (!isWithinFence) {
        throw new ForbiddenException('You are outside the allowed clock-out area.');
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
        Math.floor((record.timestamp.getTime() - schedule.shiftEndAt.getTime()) / 60000),
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
        status:
          summary?.clockInTime
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
        ...(access.noAccess
          ? { employeeId: '__no_access__' }
          : access.scope === 'SELF'
            ? { employeeId: access.employeeId || '__no_access__' }
            : access.scope === 'DEPARTMENT'
              ? { employee: { departmentId: access.departmentId || '__no_access__' } }
              : {}),
      },
      include: {
        employee: true,
      },
    });
  }
}
