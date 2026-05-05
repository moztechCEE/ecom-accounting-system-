import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  UpsertDisasterClosureDto,
  disasterClosurePayPolicies,
  disasterClosureScopeTypes,
} from '../dto/upsert-disaster-closure.dto';

export type DisasterClosureScopeType =
  (typeof disasterClosureScopeTypes)[number];
export type DisasterClosurePayPolicy =
  (typeof disasterClosurePayPolicies)[number];

@Injectable()
export class DisasterClosureService {
  constructor(private readonly prisma: PrismaService) {}

  async getAdminClosures(
    userId: string,
    params?: { year?: number; entityId?: string },
  ) {
    const entityId = await this.resolveEntityId(userId, params?.entityId);
    const year = params?.year;
    const dateFilter = year
      ? {
          gte: new Date(year, 0, 1),
          lte: new Date(year, 11, 31, 23, 59, 59, 999),
        }
      : undefined;

    const events = await this.prisma.disasterClosureEvent.findMany({
      where: {
        entityId,
        ...(dateFilter ? { closureDate: dateFilter } : {}),
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ closureDate: 'desc' }, { createdAt: 'desc' }],
    });

    return events.map((event) => this.serializeClosure(event));
  }

  async createClosure(userId: string, dto: UpsertDisasterClosureDto) {
    const entityId = await this.resolveEntityId(userId, dto.entityId);
    const data = this.normalizePayload(dto);

    const event = await this.prisma.disasterClosureEvent.create({
      data: {
        ...data,
        entityId,
        createdBy: userId,
      } as Prisma.DisasterClosureEventUncheckedCreateInput,
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    if (event.isActive) {
      await this.applyClosureToDailySummaries(event.id);
    }

    return this.serializeClosure(event);
  }

  async updateClosure(
    userId: string,
    id: string,
    dto: UpsertDisasterClosureDto,
  ) {
    const existing = await this.prisma.disasterClosureEvent.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Disaster closure event not found');
    }

    const entityId = await this.resolveEntityId(userId, existing.entityId);
    if (entityId !== existing.entityId) {
      throw new NotFoundException('Disaster closure event not found');
    }

    const event = await this.prisma.disasterClosureEvent.update({
      where: { id },
      data: this.normalizePayload(dto, true),
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    if (event.isActive) {
      await this.applyClosureToDailySummaries(event.id);
    }

    return this.serializeClosure(event);
  }

  async deactivateClosure(userId: string, id: string) {
    const existing = await this.prisma.disasterClosureEvent.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Disaster closure event not found');
    }

    const entityId = await this.resolveEntityId(userId, existing.entityId);
    if (entityId !== existing.entityId) {
      throw new NotFoundException('Disaster closure event not found');
    }

    await this.prisma.disasterClosureEvent.update({
      where: { id },
      data: { isActive: false },
    });

    return { success: true };
  }

  async getEmployeeClosures(employeeId: string, start: Date, end: Date) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        entityId: true,
        departmentId: true,
        location: true,
      },
    });

    if (!employee) {
      return [];
    }

    const events = await this.prisma.disasterClosureEvent.findMany({
      where: {
        entityId: employee.entityId,
        isActive: true,
        closureDate: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { closureDate: 'asc' },
    });

    return events
      .filter((event) => this.matchesEmployeeScope(event, employee))
      .map((event) => this.serializeClosure(event));
  }

  private normalizePayload(dto: UpsertDisasterClosureDto, partial = false) {
    const updateData: Record<string, any> = {};

    if (!partial || dto.name !== undefined) {
      const name = dto.name?.trim();
      if (!name) {
        throw new BadRequestException('Disaster closure name is required');
      }
      updateData.name = name;
    }

    if (!partial || dto.closureDate !== undefined) {
      if (!dto.closureDate) {
        throw new BadRequestException('Closure date is required');
      }
      updateData.closureDate = this.normalizeDate(dto.closureDate);
    }

    const scopeType = (dto.scopeType ?? 'ENTITY') as DisasterClosureScopeType;
    if (!disasterClosureScopeTypes.includes(scopeType)) {
      throw new BadRequestException('Invalid closure scope type');
    }

    if (!partial || dto.scopeType !== undefined) {
      updateData.scopeType = scopeType;
    }

    if (!partial || dto.scopeIds !== undefined || dto.scopeType !== undefined) {
      const scopeIds = Array.from(
        new Set((dto.scopeIds ?? []).map((item) => item.trim()).filter(Boolean)),
      );

      if (scopeType !== 'ENTITY' && scopeIds.length === 0) {
        throw new BadRequestException('Scope targets are required');
      }

      updateData.scopeIds = scopeType === 'ENTITY' ? Prisma.JsonNull : scopeIds;
    }

    const payPolicy = (dto.payPolicy ?? 'NO_DEDUCTION') as DisasterClosurePayPolicy;
    if (!disasterClosurePayPolicies.includes(payPolicy)) {
      throw new BadRequestException('Invalid closure pay policy');
    }

    if (!partial || dto.payPolicy !== undefined) {
      updateData.payPolicy = payPolicy;
    }

    if (!partial || dto.paidPercentage !== undefined || dto.payPolicy !== undefined) {
      updateData.paidPercentage =
        payPolicy === 'PARTIAL' ? Number(dto.paidPercentage ?? 50) : null;
    }

    if (dto.source !== undefined) {
      updateData.source = dto.source?.trim() || null;
    } else if (!partial) {
      updateData.source = 'GOV_ANNOUNCEMENT';
    }

    if (dto.announcementRegion !== undefined) {
      updateData.announcementRegion = dto.announcementRegion?.trim() || null;
    }

    if (dto.notes !== undefined) {
      updateData.notes = dto.notes?.trim() || null;
    }

    if (dto.isActive !== undefined) {
      updateData.isActive = dto.isActive;
    }

    return updateData;
  }

  private normalizeDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid closure date');
    }
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private async applyClosureToDailySummaries(eventId: string) {
    const event = await this.prisma.disasterClosureEvent.findUnique({
      where: { id: eventId },
    });

    if (!event || !event.isActive) {
      return;
    }

    const employees = await this.getAffectedEmployees(event);
    const anomalyReason = this.buildSummaryReason(event);

    for (const employee of employees) {
      const existing = await this.prisma.attendanceDailySummary.findUnique({
        where: {
          entityId_employeeId_workDate: {
            entityId: employee.entityId,
            employeeId: employee.id,
            workDate: event.closureDate,
          },
        },
      });

      if (existing?.clockInTime || existing?.clockOutTime) {
        continue;
      }

      await this.prisma.attendanceDailySummary.upsert({
        where: {
          entityId_employeeId_workDate: {
            entityId: employee.entityId,
            employeeId: employee.id,
            workDate: event.closureDate,
          },
        },
        update: {
          status: 'disaster_closure',
          anomalyReason,
          workedMinutes: 0,
          overtimeMinutes: 0,
        },
        create: {
          entityId: employee.entityId,
          employeeId: employee.id,
          workDate: event.closureDate,
          status: 'disaster_closure',
          anomalyReason,
        },
      });
    }
  }

  private async getAffectedEmployees(event: {
    entityId: string;
    scopeType: string;
    scopeIds: Prisma.JsonValue | null;
    closureDate: Date;
  }) {
    const scopeIds = this.getScopeIds(event.scopeIds);
    const baseWhere: Prisma.EmployeeWhereInput = {
      entityId: event.entityId,
      isActive: true,
      hireDate: { lte: event.closureDate },
      OR: [{ terminateDate: null }, { terminateDate: { gte: event.closureDate } }],
    };

    if (event.scopeType === 'DEPARTMENT') {
      baseWhere.departmentId = { in: scopeIds };
    } else if (event.scopeType === 'EMPLOYEE') {
      baseWhere.id = { in: scopeIds };
    } else if (event.scopeType === 'LOCATION') {
      baseWhere.location = { in: scopeIds };
    }

    return this.prisma.employee.findMany({
      where: baseWhere,
      select: { id: true, entityId: true },
    });
  }

  private matchesEmployeeScope(
    event: { scopeType: string; scopeIds: Prisma.JsonValue | null },
    employee: { id: string; departmentId: string | null; location: string | null },
  ) {
    if (event.scopeType === 'ENTITY') {
      return true;
    }

    const scopeIds = this.getScopeIds(event.scopeIds);
    if (event.scopeType === 'DEPARTMENT') {
      return Boolean(employee.departmentId && scopeIds.includes(employee.departmentId));
    }
    if (event.scopeType === 'EMPLOYEE') {
      return scopeIds.includes(employee.id);
    }
    if (event.scopeType === 'LOCATION') {
      return Boolean(employee.location && scopeIds.includes(employee.location));
    }
    return false;
  }

  private getScopeIds(value: Prisma.JsonValue | null) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private buildSummaryReason(event: {
    name: string;
    payPolicy: string;
    announcementRegion: string | null;
  }) {
    const policyLabel =
      event.payPolicy === 'UNPAID'
        ? '不支薪'
        : event.payPolicy === 'PARTIAL'
          ? '部分支薪'
          : '不扣薪';
    return [
      `統一放假宣告：${event.name}`,
      event.announcementRegion ? `區域：${event.announcementRegion}` : null,
      `薪資：${policyLabel}`,
    ]
      .filter(Boolean)
      .join('；');
  }

  private serializeClosure<T extends Record<string, any>>(event: T) {
    return {
      ...event,
      paidPercentage:
        event.paidPercentage === null || event.paidPercentage === undefined
          ? null
          : Number(event.paidPercentage),
      scopeIds: this.getScopeIds(event.scopeIds ?? null),
    };
  }

  private async resolveEntityId(userId: string, requestedEntityId?: string) {
    if (requestedEntityId) {
      const entity = await this.prisma.entity.findUnique({
        where: { id: requestedEntityId },
        select: { id: true },
      });

      if (!entity) {
        throw new NotFoundException('Entity not found');
      }

      return entity.id;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          select: { entityId: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.employee?.entityId) {
      return user.employee.entityId;
    }

    const fallbackEntity = await this.prisma.entity.findFirst({
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    if (!fallbackEntity) {
      throw new NotFoundException('No entity configured');
    }

    return fallbackEntity.id;
  }
}
