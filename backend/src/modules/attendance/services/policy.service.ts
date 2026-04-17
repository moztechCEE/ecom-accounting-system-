import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendancePolicy, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../../common/audit/audit-log.service';
import { ScheduleService } from './schedule.service';
import { UpsertAttendancePolicyDto } from '../dto/upsert-attendance-policy.dto';

export type ResolvedAttendancePolicy = {
  id: string;
  name: string;
  type: string;
  requiresPhoto: boolean;
  maxEarlyClock: number;
  maxLateClock: number;
  ipAllowList: unknown;
  geofence: unknown;
};

@Injectable()
export class PolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getPolicyForEmployee(employeeId: string, date: Date = new Date()) {
    const schedule = await this.scheduleService.getScheduleForDate(employeeId, date);
    return this.resolvePolicy(schedule?.policy);
  }

  resolvePolicy(
    policy?: AttendancePolicy | null,
  ): ResolvedAttendancePolicy | null {
    if (!policy) {
      return null;
    }

    return {
      id: policy.id,
      name: policy.name,
      type: policy.type,
      requiresPhoto: policy.requiresPhoto,
      maxEarlyClock: policy.maxEarlyClock,
      maxLateClock: policy.maxLateClock,
      ipAllowList: policy.ipAllowList,
      geofence: policy.geofence,
    };
  }

  async getAdminPolicies(userId: string, entityId?: string) {
    const resolvedEntityId = await this.resolveEntityId(userId, entityId);

    return this.prisma.attendancePolicy.findMany({
      where: { entityId: resolvedEntityId },
      include: {
        schedules: {
          include: {
            department: {
              select: {
                id: true,
                name: true,
              },
            },
            employee: {
              select: {
                id: true,
                name: true,
                employeeNo: true,
              },
            },
          },
          orderBy: [{ weekday: 'asc' }, { shiftStart: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async createPolicy(userId: string, dto: UpsertAttendancePolicyDto) {
    const entityId = await this.resolveEntityId(userId, dto.entityId);
    const schedules = await this.normalizeSchedules(entityId, dto.schedules);
    const geofence = this.normalizeGeofence(dto.geofence);

    const created = await this.prisma.attendancePolicy.create({
      data: {
        entityId,
        name: dto.name.trim(),
        type: dto.type || 'office',
        ipAllowList:
          dto.ipAllowList && dto.ipAllowList.length > 0 ? dto.ipAllowList : null,
        geofence,
        requiresPhoto: Boolean(dto.requiresPhoto),
        maxEarlyClock: dto.maxEarlyClock ?? 15,
        maxLateClock: dto.maxLateClock ?? 5,
        schedules:
          schedules.length > 0
            ? {
                create: schedules,
              }
            : undefined,
      },
      include: {
        schedules: {
          include: {
            department: { select: { id: true, name: true } },
            employee: { select: { id: true, name: true, employeeNo: true } },
          },
          orderBy: [{ weekday: 'asc' }, { shiftStart: 'asc' }],
        },
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'attendance_policies',
      recordId: created.id,
      action: 'CREATE',
      newData: created,
    });

    return created;
  }

  async updatePolicy(userId: string, id: string, dto: UpsertAttendancePolicyDto) {
    const existing = await this.prisma.attendancePolicy.findUnique({
      where: { id },
      include: {
        schedules: true,
      },
    });

    if (!existing) {
      throw new BadRequestException('Attendance policy not found');
    }

    const entityId = await this.resolveEntityId(userId, existing.entityId);
    if (entityId !== existing.entityId) {
      throw new BadRequestException('Attendance policy not found in current entity');
    }

    const schedules = await this.normalizeSchedules(entityId, dto.schedules);
    const geofence = this.normalizeGeofence(dto.geofence);

    const updated = await this.prisma.attendancePolicy.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        type: dto.type || 'office',
        ipAllowList:
          dto.ipAllowList && dto.ipAllowList.length > 0 ? dto.ipAllowList : null,
        geofence,
        requiresPhoto: Boolean(dto.requiresPhoto),
        maxEarlyClock: dto.maxEarlyClock ?? 15,
        maxLateClock: dto.maxLateClock ?? 5,
        schedules: {
          deleteMany: {},
          ...(schedules.length > 0
            ? {
                create: schedules,
              }
            : {}),
        },
      },
      include: {
        schedules: {
          include: {
            department: { select: { id: true, name: true } },
            employee: { select: { id: true, name: true, employeeNo: true } },
          },
          orderBy: [{ weekday: 'asc' }, { shiftStart: 'asc' }],
        },
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'attendance_policies',
      recordId: id,
      action: 'UPDATE',
      oldData: existing,
      newData: updated,
    });

    return updated;
  }

  async deletePolicy(userId: string, id: string) {
    const existing = await this.prisma.attendancePolicy.findUnique({
      where: { id },
      include: {
        schedules: true,
      },
    });

    if (!existing) {
      throw new BadRequestException('Attendance policy not found');
    }

    const entityId = await this.resolveEntityId(userId, existing.entityId);
    if (entityId !== existing.entityId) {
      throw new BadRequestException('Attendance policy not found in current entity');
    }

    await this.prisma.attendancePolicy.delete({
      where: { id },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'attendance_policies',
      recordId: id,
      action: 'DELETE',
      oldData: existing,
    });

    return { success: true };
  }

  private async normalizeSchedules(
    entityId: string,
    schedules?: UpsertAttendancePolicyDto['schedules'],
  ) {
    const normalizedSchedules = (schedules || []).map((schedule) => ({
      departmentId: schedule.departmentId?.trim() || undefined,
      employeeId: schedule.employeeId?.trim() || undefined,
      weekday: Number(schedule.weekday),
      shiftStart: schedule.shiftStart,
      shiftEnd: schedule.shiftEnd,
      breakMinutes: schedule.breakMinutes ?? 60,
      allowRemote: Boolean(schedule.allowRemote),
    }));

    for (const schedule of normalizedSchedules) {
      if (!schedule.departmentId && !schedule.employeeId) {
        throw new BadRequestException('Each schedule must be assigned to a department or employee');
      }

      if (schedule.departmentId && schedule.employeeId) {
        throw new BadRequestException('A schedule cannot target both department and employee');
      }

      if (schedule.departmentId) {
        const department = await this.prisma.department.findFirst({
          where: {
            id: schedule.departmentId,
            entityId,
          },
          select: { id: true },
        });

        if (!department) {
          throw new BadRequestException('Department not found for attendance schedule');
        }
      }

      if (schedule.employeeId) {
        const employee = await this.prisma.employee.findFirst({
          where: {
            id: schedule.employeeId,
            entityId,
          },
          select: { id: true },
        });

        if (!employee) {
          throw new BadRequestException('Employee not found for attendance schedule');
        }
      }
    }

    return normalizedSchedules;
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

  private normalizeGeofence(
    geofence: unknown,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null {
    if (geofence === undefined || geofence === null || geofence === '') {
      return null;
    }

    try {
      return JSON.parse(JSON.stringify(geofence)) as Prisma.InputJsonValue;
    } catch {
      throw new BadRequestException('Geofence must be valid JSON data');
    }
  }
}
