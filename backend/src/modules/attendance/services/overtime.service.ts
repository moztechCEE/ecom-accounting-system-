import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalRequest } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateOvertimeRequestDto } from '../dto/create-overtime-request.dto';
import { ReviewOvertimeRequestDto } from '../dto/review-overtime-request.dto';

type OvertimeRequestPayload = {
  employeeId: string;
  workDate: string;
  requestedMinutes: number;
  reason: string;
  note?: string | null;
  managerApprovedBy?: string | null;
  managerApprovedAt?: string | null;
  managerApprovedName?: string | null;
  finalApprovedBy?: string | null;
  finalApprovedAt?: string | null;
  finalApprovedName?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
};

type DailyCompensationInput = {
  shiftStartAt?: Date | null;
  shiftEndAt?: Date | null;
  workedMinutes: number;
  leaveMinutes?: number;
  clockInTime?: Date | null;
  clockOutTime?: Date | null;
  approvedRequestMinutes?: number;
};

@Injectable()
export class OvertimeService {
  private readonly overtimeType = 'attendance_overtime';
  private readonly payrollBaseMinutes = 8 * 60;
  private readonly lateGraceMinutes = 20;
  private readonly intervalMinutes = 30;

  constructor(private readonly prisma: PrismaService) {}

  async createRequest(userId: string, dto: CreateOvertimeRequestDto) {
    if (dto.requestedMinutes % this.intervalMinutes !== 0) {
      throw new BadRequestException('加班申請分鐘數需以 30 分鐘為單位');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: {
        id: true,
        entityId: true,
        name: true,
        employeeNo: true,
        department: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    const workDate = this.normalizeDate(dto.workDate);
    const workDateKey = this.dateKey(workDate);
    const todayKey = this.dateKey(new Date());
    if (workDateKey > todayKey) {
      throw new BadRequestException('加班申請不可選擇未來日期');
    }

    const summary = await this.prisma.attendanceDailySummary.findUnique({
      where: {
        entityId_employeeId_workDate: {
          entityId: employee.entityId,
          employeeId: employee.id,
          workDate,
        },
      },
      select: {
        workDate: true,
        workedMinutes: true,
        clockInTime: true,
        clockOutTime: true,
        breakMinutes: true,
      },
    });

    if (!summary?.clockInTime || !summary?.clockOutTime) {
      throw new BadRequestException('請先完成當日上下班打卡，再提出加班申請');
    }

    const schedule = await this.resolveSchedule(employee.id, workDate);
    if (!schedule?.shiftEndAt) {
      throw new BadRequestException('當日沒有可用班表，暫時無法提出加班申請');
    }

    const payable = this.calculateDailyCompensation({
      shiftStartAt: schedule.shiftStartAt,
      shiftEndAt: schedule.shiftEndAt,
      clockInTime: summary.clockInTime,
      clockOutTime: summary.clockOutTime,
      workedMinutes: Number(summary.workedMinutes || 0),
      leaveMinutes: 0,
      approvedRequestMinutes: dto.requestedMinutes,
    });

    if (payable.extraWorkMinutes < this.intervalMinutes) {
      throw new BadRequestException('當日沒有可申請的延後下班時數');
    }

    if (dto.requestedMinutes > payable.extraWorkMinutes) {
      throw new BadRequestException(
        `申請分鐘數不可超過當日可認列的延後下班時數 ${payable.extraWorkMinutes} 分鐘`,
      );
    }

    const existing = await this.prisma.approvalRequest.findMany({
      where: {
        entityId: employee.entityId,
        type: this.overtimeType,
        requestedBy: userId,
      },
      include: {
        requester: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const duplicate = existing.find((request) => {
      const payload = this.parsePayload(request.remark);
      return (
        payload?.employeeId === employee.id &&
        payload.workDate === workDateKey &&
        ['pending_manager', 'pending_final', 'approved'].includes(request.status)
      );
    });

    if (duplicate) {
      throw new BadRequestException('這一天已經有待審核或已核准的加班申請');
    }

    const payload: OvertimeRequestPayload = {
      employeeId: employee.id,
      workDate: workDateKey,
      requestedMinutes: dto.requestedMinutes,
      reason: dto.reason.trim(),
    };

    const request = await this.prisma.approvalRequest.create({
      data: {
        entityId: employee.entityId,
        type: this.overtimeType,
        refId: `${employee.id}:${workDateKey}:${Date.now()}`,
        status: 'pending_manager',
        requestedBy: userId,
        priority: 'normal',
        remark: JSON.stringify(payload),
      },
      include: {
        requester: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
      },
    });

    return this.serializeRequest(request, {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeNo: employee.employeeNo,
      departmentName: employee.department?.name ?? null,
    });
  }

  async getMyRequests(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        employeeNo: true,
        department: {
          select: { name: true },
        },
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    const requests = await this.prisma.approvalRequest.findMany({
      where: {
        requestedBy: userId,
        type: this.overtimeType,
      },
      include: {
        requester: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 30,
    });

    return requests
      .map((request) =>
        this.serializeRequest(request, {
          employeeId: employee.id,
          employeeName: employee.name,
          employeeNo: employee.employeeNo,
          departmentName: employee.department?.name ?? null,
        }),
      )
      .filter(Boolean);
  }

  async getAdminRequests(
    params?: {
      status?: string;
      employeeId?: string;
      year?: number;
    },
  ) {
    const requests = await this.prisma.approvalRequest.findMany({
      where: {
        type: this.overtimeType,
        ...(params?.status ? { status: params.status } : {}),
      },
      include: {
        requester: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    const employeeIds = Array.from(
      new Set(
        requests
          .map((request) => this.parsePayload(request.remark)?.employeeId)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: {
        id: true,
        name: true,
        employeeNo: true,
        department: {
          select: { name: true },
        },
      },
    });

    const employeeMap = new Map(
      employees.map((employee) => [
        employee.id,
        {
          employeeId: employee.id,
          employeeName: employee.name,
          employeeNo: employee.employeeNo,
          departmentName: employee.department?.name ?? null,
        },
      ]),
    );

    return requests
      .map((request) => {
        const payload = this.parsePayload(request.remark);
        const context = payload?.employeeId
          ? employeeMap.get(payload.employeeId)
          : undefined;
        return context ? this.serializeRequest(request, context) : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((request) => {
        if (params?.employeeId && request.employeeId !== params.employeeId) {
          return false;
        }
        if (
          params?.year &&
          new Date(request.workDate).getFullYear() !== params.year
        ) {
          return false;
        }
        return true;
      });
  }

  async reviewRequest(userId: string, id: string, dto: ReviewOvertimeRequestDto) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id },
      include: {
        requester: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
      },
    });

    if (!request || request.type !== this.overtimeType) {
      throw new NotFoundException('Overtime request not found');
    }

    const payload = this.parsePayload(request.remark);
    if (!payload) {
      throw new BadRequestException('加班申請資料格式錯誤');
    }

    const reviewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });

    const now = new Date();
    const note = dto.note?.trim() || null;

    if (dto.action === 'approve_manager') {
      if (request.status !== 'pending_manager') {
        throw new BadRequestException('這筆加班申請目前不能做主管初審');
      }

      payload.managerApprovedBy = userId;
      payload.managerApprovedAt = now.toISOString();
      payload.managerApprovedName = reviewer?.name || null;
      payload.note = note;

      const updated = await this.prisma.approvalRequest.update({
        where: { id },
        data: {
          status: 'pending_final',
          approverId: userId,
          remark: JSON.stringify(payload),
        },
        include: {
          requester: {
            select: { id: true, name: true },
          },
          approver: {
            select: { id: true, name: true },
          },
        },
      });

      return this.serializeRequest(
        updated,
        await this.getEmployeeContext(payload.employeeId),
      );
    }

    if (dto.action === 'approve_final') {
      if (request.status !== 'pending_final') {
        throw new BadRequestException('這筆加班申請目前不能做覆核');
      }
      if (payload.managerApprovedBy && payload.managerApprovedBy === userId) {
        throw new BadRequestException('覆核人需與主管初審人不同');
      }

      payload.finalApprovedBy = userId;
      payload.finalApprovedAt = now.toISOString();
      payload.finalApprovedName = reviewer?.name || null;
      payload.note = note;

      const updated = await this.prisma.approvalRequest.update({
        where: { id },
        data: {
          status: 'approved',
          approverId: userId,
          approvedAt: now,
          remark: JSON.stringify(payload),
        },
        include: {
          requester: {
            select: { id: true, name: true },
          },
          approver: {
            select: { id: true, name: true },
          },
        },
      });

      return this.serializeRequest(
        updated,
        await this.getEmployeeContext(payload.employeeId),
      );
    }

    if (!['pending_manager', 'pending_final'].includes(request.status)) {
      throw new BadRequestException('這筆加班申請目前不能駁回');
    }

    payload.rejectedBy = userId;
    payload.rejectedAt = now.toISOString();
    payload.note = note;

    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        approverId: userId,
        approvedAt: now,
        remark: JSON.stringify(payload),
      },
      include: {
        requester: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
      },
    });

    return this.serializeRequest(
      updated,
      await this.getEmployeeContext(payload.employeeId),
    );
  }

  async getApprovedMinutesByDate(
    employeeId: string,
    start: Date,
    end: Date,
  ): Promise<Map<string, number>> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!employee?.userId) {
      return new Map();
    }

    const requests = await this.prisma.approvalRequest.findMany({
      where: {
        requestedBy: employee.userId,
        type: this.overtimeType,
        status: 'approved',
      },
      select: {
        remark: true,
      },
    });

    const result = new Map<string, number>();
    const startKey = this.dateKey(start);
    const endKey = this.dateKey(end);

    for (const request of requests) {
      const payload = this.parsePayload(request.remark);
      if (!payload || payload.employeeId !== employeeId) {
        continue;
      }
      if (payload.workDate < startKey || payload.workDate > endKey) {
        continue;
      }
      result.set(payload.workDate, Number(payload.requestedMinutes || 0));
    }

    return result;
  }

  calculateDailyCompensation(input: DailyCompensationInput) {
    const workedMinutes = Math.max(0, Math.floor(Number(input.workedMinutes || 0)));
    const leaveMinutes = Math.max(0, Math.floor(Number(input.leaveMinutes || 0)));
    const approvedRequestMinutes = this.roundDownInterval(
      Number(input.approvedRequestMinutes || 0),
    );
    const lateActualMinutes =
      input.shiftStartAt && input.clockInTime
        ? Math.max(
            0,
            Math.floor(
              (input.clockInTime.getTime() - input.shiftStartAt.getTime()) / 60000,
            ),
          )
        : 0;

    const latePenaltyMinutes =
      lateActualMinutes > this.lateGraceMinutes
        ? this.roundUpInterval(lateActualMinutes)
        : 0;

    const extraWorkMinutes =
      input.shiftEndAt && input.clockOutTime
        ? this.roundDownInterval(
            Math.max(
              0,
              Math.floor(
                (input.clockOutTime.getTime() - input.shiftEndAt.getTime()) / 60000,
              ),
            ),
          )
        : 0;

    const approvedOvertimeRequestMinutes = Math.min(
      approvedRequestMinutes,
      extraWorkMinutes,
    );

    const approvedOffsetMinutes =
      workedMinutes >= this.payrollBaseMinutes
        ? Math.min(latePenaltyMinutes, approvedOvertimeRequestMinutes)
        : 0;

    const overtimePremiumBaseMinutes = this.roundDownInterval(
      Math.max(0, workedMinutes + leaveMinutes - this.payrollBaseMinutes),
    );

    const payableOvertimeMinutes = Math.min(
      Math.max(0, approvedOvertimeRequestMinutes - approvedOffsetMinutes),
      overtimePremiumBaseMinutes,
    );

    return {
      scheduledMinutes: this.payrollBaseMinutes,
      workedMinutes,
      leaveMinutes,
      lateActualMinutes,
      latePenaltyMinutes,
      approvedOvertimeRequestMinutes,
      approvedOffsetMinutes,
      remainingLatePenaltyMinutes: Math.max(
        0,
        latePenaltyMinutes - approvedOffsetMinutes,
      ),
      payableOvertimeMinutes,
      extraWorkMinutes,
    };
  }

  async resolveSchedule(employeeId: string, workDate: Date) {
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

    const weekday = workDate.getDay();
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

    const shiftStartAt = this.combineDateAndTime(workDate, selectedSchedule.shiftStart);
    const shiftEndAt = this.combineDateAndTime(workDate, selectedSchedule.shiftEnd);
    if (shiftEndAt <= shiftStartAt) {
      shiftEndAt.setDate(shiftEndAt.getDate() + 1);
    }

    return {
      id: selectedSchedule.id,
      shiftStartAt,
      shiftEndAt,
      breakMinutes: selectedSchedule.breakMinutes,
      weekday,
    };
  }

  private serializeRequest(
    request: ApprovalRequest & {
      requester?: { id: string; name: string } | null;
      approver?: { id: string; name: string } | null;
    },
    context?: {
      employeeId: string;
      employeeName: string;
      employeeNo?: string | null;
      departmentName?: string | null;
    },
  ) {
    const payload = this.parsePayload(request.remark);
    if (!payload) {
      return null;
    }

    return {
      id: request.id,
      entityId: request.entityId,
      employeeId: context?.employeeId || payload.employeeId,
      employeeName: context?.employeeName || '未綁定員工',
      employeeNo: context?.employeeNo || undefined,
      departmentName: context?.departmentName || null,
      workDate: payload.workDate,
      requestedMinutes: payload.requestedMinutes,
      approvedMinutes:
        request.status === 'approved' ? payload.requestedMinutes : 0,
      reason: payload.reason,
      note: payload.note || null,
      status: request.status,
      submittedAt: request.createdAt.toISOString(),
      managerApprovedAt: payload.managerApprovedAt || null,
      finalApprovedAt: payload.finalApprovedAt || null,
      managerApproverName: payload.managerApprovedName || null,
      finalApproverName: payload.finalApprovedName || null,
      requestedByName: request.requester?.name || null,
    };
  }

  private parsePayload(value?: string | null) {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as OvertimeRequestPayload;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.employeeId !== 'string' ||
        typeof parsed.workDate !== 'string'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async getEmployeeContext(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        employeeNo: true,
        department: {
          select: { name: true },
        },
      },
    });

    if (!employee) {
      return undefined;
    }

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeNo: employee.employeeNo,
      departmentName: employee.department?.name ?? null,
    };
  }

  private normalizeDate(value: string | Date) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('日期格式不正確');
    }
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private dateKey(value: Date) {
    return this.normalizeDate(value).toISOString().slice(0, 10);
  }

  private roundUpInterval(minutes: number) {
    return Math.ceil(Math.max(0, minutes) / this.intervalMinutes) * this.intervalMinutes;
  }

  private roundDownInterval(minutes: number) {
    return Math.floor(Math.max(0, minutes) / this.intervalMinutes) * this.intervalMinutes;
  }

  private combineDateAndTime(baseDate: Date, time: string) {
    const [hours, minutes] = time.split(':').map((value) => Number(value));
    const result = new Date(baseDate);
    result.setHours(hours || 0, minutes || 0, 0, 0);
    return result;
  }
}
