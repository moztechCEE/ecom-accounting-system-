import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { CreateLeaveRequestDto } from '../dto/create-leave-request.dto';
import { LeaveStatus, Prisma, LeaveType } from '@prisma/client';
import { BalanceService } from './balance.service';
import { UpsertLeaveTypeDto } from '../dto/upsert-leave-type.dto';
import { AdjustLeaveBalanceDto } from '../dto/adjust-leave-balance.dto';
import { AuditLogService } from '../../../common/audit/audit-log.service';
import { UsersService } from '../../users/users.service';

type DefaultLeaveTypeTemplate = {
  code: string;
  name: string;
  balanceResetPolicy: 'CALENDAR_YEAR' | 'HIRE_ANNIVERSARY' | 'NONE';
  requiresDocument: boolean;
  documentExamples?: string;
  maxDaysPerYear?: number;
  paidPercentage?: number;
  minNoticeHours?: number;
  allowCarryOver?: boolean;
  carryOverLimitHours?: number;
  requiresChildData?: boolean;
};

const DEFAULT_TW_LEAVE_TYPES: DefaultLeaveTypeTemplate[] = [
  {
    code: 'SICK',
    name: '病假',
    balanceResetPolicy: 'CALENDAR_YEAR',
    requiresDocument: true,
    maxDaysPerYear: 30,
    paidPercentage: 50,
    minNoticeHours: 0,
  },
  {
    code: 'PERSONAL',
    name: '事假',
    balanceResetPolicy: 'CALENDAR_YEAR',
    requiresDocument: false,
    maxDaysPerYear: 14,
    paidPercentage: 0,
    minNoticeHours: 24,
  },
  {
    code: 'ANNUAL',
    name: '特休',
    balanceResetPolicy: 'CALENDAR_YEAR',
    requiresDocument: false,
    paidPercentage: 100,
    minNoticeHours: 24,
  },
  {
    code: 'MENSTRUAL',
    name: '生理假',
    balanceResetPolicy: 'CALENDAR_YEAR',
    requiresDocument: false,
    maxDaysPerYear: 12,
    paidPercentage: 50,
    minNoticeHours: 0,
  },
  {
    code: 'MARRIAGE',
    name: '婚假',
    balanceResetPolicy: 'NONE',
    requiresDocument: true,
    maxDaysPerYear: 8,
    paidPercentage: 100,
    minNoticeHours: 168,
  },
  {
    code: 'FUNERAL',
    name: '喪假',
    balanceResetPolicy: 'NONE',
    requiresDocument: true,
    documentExamples: '訃聞、死亡證明或其他可佐證親屬喪亡事實之文件',
    paidPercentage: 100,
    minNoticeHours: 0,
  },
  {
    code: 'MATERNITY',
    name: '產假',
    balanceResetPolicy: 'NONE',
    requiresDocument: true,
    maxDaysPerYear: 56,
    paidPercentage: 100,
    minNoticeHours: 720,
    requiresChildData: true,
  },
  {
    code: 'PATERNITY',
    name: '陪產假',
    balanceResetPolicy: 'NONE',
    requiresDocument: true,
    maxDaysPerYear: 7,
    paidPercentage: 100,
    minNoticeHours: 48,
    requiresChildData: true,
  },
];

type LeaveRequestDocumentInput = {
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  docType?: string;
  checksum?: string;
};

type FuneralLeaveRelationship =
  | 'PARENT_OR_SPOUSE'
  | 'GRANDPARENT_CHILD_OR_SPOUSE_PARENT'
  | 'GREAT_GRANDPARENT_SIBLING_OR_SPOUSE_GRANDPARENT';

type FuneralLeaveDetails = {
  relationship: FuneralLeaveRelationship;
  relationshipLabel: string;
  maxDays: number;
  maxHours: number;
  deceasedName: string;
  deceasedDate: string;
  eventKey: string;
};

const FUNERAL_LEAVE_RELATIONSHIP_RULES: Record<
  FuneralLeaveRelationship,
  { label: string; days: number }
> = {
  PARENT_OR_SPOUSE: {
    label: '父母、養父母、繼父母、配偶',
    days: 8,
  },
  GRANDPARENT_CHILD_OR_SPOUSE_PARENT: {
    label: '祖父母/外祖父母、子女、配偶之父母',
    days: 6,
  },
  GREAT_GRANDPARENT_SIBLING_OR_SPOUSE_GRANDPARENT: {
    label: '曾祖父母、兄弟姊妹、配偶之祖父母',
    days: 3,
  },
};

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly balanceService: BalanceService,
    private readonly auditLogService: AuditLogService,
    private readonly usersService: UsersService,
  ) {}

  private async getAdminAccessContext(userId: string, requestedEntityId?: string) {
    return this.usersService.getDataAccessContext(
      userId,
      'attendance',
      requestedEntityId,
    );
  }

  async initializeEmployeeLeaveSetup(
    actorUserId: string,
    employee: {
      id: string;
      entityId: string;
      hireDate: Date;
    },
  ) {
    const leaveTypes = await this.ensureDefaultLeaveTypes(
      employee.entityId,
      actorUserId,
    );
    const referenceDate = this.resolveEmployeeReferenceDate(employee.hireDate);

    for (const leaveType of leaveTypes) {
      if (
        !leaveType.isActive ||
        !this.balanceService.leaveTypeUsesBalance(leaveType)
      ) {
        continue;
      }

      await this.balanceService.ensureBalanceForDate(
        {
          id: employee.id,
          entityId: employee.entityId,
          hireDate: employee.hireDate,
        },
        leaveType,
        referenceDate,
      );
    }
  }

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

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    const documents = this.normalizeLeaveRequestDocuments(dto.documents);
    const funeralDetails = this.resolveFuneralLeaveDetails(leaveType, dto);

    await this.validateLeaveRequestPayload({
      employee: {
        id: employee.id,
        entityId: employee.entityId,
        hireDate: employee.hireDate,
      },
      leaveType,
      startAt,
      endAt,
      hours: dto.hours,
      documents,
      funeralDetails,
    });

    await this.balanceService.reserveLeaveHours({
      employee: {
        id: employee.id,
        entityId: employee.entityId,
        hireDate: employee.hireDate,
      },
      leaveType,
      referenceDate: startAt,
      hours: dto.hours,
    });

    const leaveRequest = await this.prisma.leaveRequest.create({
      data: {
        entityId: employee.entityId,
        employeeId: employee.id,
        leaveTypeId: dto.leaveTypeId,
        startAt,
        endAt,
        hours: dto.hours,
        reason: dto.reason,
        location: dto.location,
        status: LeaveStatus.SUBMITTED,
        requiredDocsMet: !leaveType.requiresDocument || documents.length > 0,
        metadata: this.buildLeaveRequestMetadata(
          documents.length,
          funeralDetails,
        ),
        documents:
          documents.length > 0
            ? {
                create: documents.map((document) => ({
                  fileName: document.fileName,
                  fileUrl:
                    document.fileUrl ||
                    `manual://${encodeURIComponent(document.fileName)}`,
                  mimeType: document.mimeType || 'application/octet-stream',
                  checksum: document.checksum || null,
                  docType: document.docType || null,
                  uploadedBy: userId,
                })),
              }
            : undefined,
        histories: {
          create: {
            action: 'SUBMIT',
            fromStatus: LeaveStatus.DRAFT,
            toStatus: LeaveStatus.SUBMITTED,
            actorId: userId,
            note: dto.reason || null,
            metadata: this.buildLeaveRequestMetadata(
              documents.length,
              funeralDetails,
            ),
          },
        },
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

    await this.notifyLeaveApprovers({
      requesterUserId: userId,
      entityId: employee.entityId,
      employeeName: employee.name,
      leaveTypeName: leaveType.name,
      leaveRequestId: leaveRequest.id,
      hours: dto.hours,
      startAt,
      endAt,
    });

    return leaveRequest;
  }

  async updateLeaveStatus(
    requestId: string,
    status: LeaveStatus,
    reviewerId: string,
    note?: string,
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

    const access = await this.getAdminAccessContext(
      reviewerId,
      existingRequest.entityId,
    );
    const canAccessRequest =
      !access.noAccess &&
      (access.scope === 'ENTITY' ||
        (access.scope === 'SELF' && access.employeeId === existingRequest.employeeId) ||
        (access.scope === 'DEPARTMENT' &&
          access.departmentId === existingRequest.employee.departmentId));
    if (!canAccessRequest) {
      throw new BadRequestException('Leave request not found');
    }

    if (
      existingRequest.status === LeaveStatus.APPROVED ||
      existingRequest.status === LeaveStatus.REJECTED ||
      existingRequest.status === LeaveStatus.CANCELLED
    ) {
      throw new BadRequestException('此假單已結案，無法再次變更狀態');
    }

    if (
      status !== LeaveStatus.APPROVED &&
      status !== LeaveStatus.REJECTED &&
      status !== LeaveStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException('審核流程僅支援處理為審核中、核准或駁回');
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
        histories: {
          create: {
            action:
              status === LeaveStatus.APPROVED
                ? 'APPROVE'
                : status === LeaveStatus.REJECTED
                  ? 'REJECT'
                  : 'MOVE_TO_REVIEW',
            fromStatus: existingRequest.status,
            toStatus: status,
            actorId: reviewerId,
            note: note?.trim() || null,
          },
        },
      },
      include: {
        employee: true,
        leaveType: true,
      },
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
        note: note?.trim() || null,
      },
    });

    if (request.employee?.userId) {
      await this.notificationService.create({
        userId: request.employee.userId,
        title: `Leave Request ${status}`,
        message:
          note && note.trim().length > 0
            ? `Your leave request has been ${status.toLowerCase()}. Note: ${note.trim()}`
            : `Your leave request has been ${status.toLowerCase()}.`,
        type: 'LEAVE_STATUS_UPDATE',
        category: 'ATTENDANCE',
        data: {
          entityId: request.entityId,
          note: note?.trim() || null,
        },
      });
    }

    return request;
  }

  async getLeaveTypes(userId: string) {
    const entityId = await this.resolveEntityId(userId);
    await this.ensureDefaultLeaveTypes(entityId, userId);
    return this.balanceService.getLeaveTypesForUser(userId);
  }

  async getLeaveBalances(userId: string, year?: number) {
    const entityId = await this.resolveEntityId(userId);
    await this.ensureDefaultLeaveTypes(entityId, userId);
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
    const access = await this.getAdminAccessContext(userId, filters.entityId);
    const entityId = access.entityId;
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
        ...(access.noAccess
          ? { employeeId: '__no_access__' }
          : access.scope === 'SELF'
            ? { employeeId: access.employeeId || '__no_access__' }
            : access.scope === 'DEPARTMENT'
              ? { employee: { departmentId: access.departmentId || '__no_access__' } }
              : {}),
      },
      include: {
        employee: {
          include: {
            department: true,
          },
        },
        leaveType: true,
        reviewer: true,
        documents: {
          orderBy: [{ uploadedAt: 'desc' }],
        },
        histories: {
          include: {
            actor: true,
          },
          orderBy: [{ createdAt: 'desc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async getAdminLeaveTypes(userId: string, entityId?: string) {
    const resolvedEntityId = await this.resolveEntityId(userId, entityId);
    await this.ensureDefaultLeaveTypes(resolvedEntityId, userId);

    return this.prisma.leaveType.findMany({
      where: resolvedEntityId ? { entityId: resolvedEntityId } : undefined,
      orderBy: [{ code: 'asc' }],
    });
  }

  async createLeaveType(userId: string, dto: UpsertLeaveTypeDto) {
    const entityId = await this.resolveEntityId(userId, dto.entityId);
    const normalizedCode = dto.code.trim().toUpperCase();
    const normalizedName = dto.name.trim();
    const isAnnualLeaveType = this.isAnnualLeaveType(
      normalizedCode,
      normalizedName,
    );
    const metadata = this.mergeLeaveTypeMetadata(undefined, dto.seniorityTiers);

    const leaveType = await this.prisma.leaveType.create({
      data: {
        entityId,
        code: normalizedCode,
        name: normalizedName,
        balanceResetPolicy: this.resolveLeaveTypeResetPolicy(
          normalizedCode,
          normalizedName,
          dto.balanceResetPolicy,
        ),
        requiresDocument: dto.requiresDocument ?? false,
        maxDaysPerYear: isAnnualLeaveType
          ? null
          : dto.maxDaysPerYear !== undefined
            ? new Prisma.Decimal(dto.maxDaysPerYear)
            : undefined,
        paidPercentage:
          dto.paidPercentage !== undefined
            ? new Prisma.Decimal(dto.paidPercentage)
            : undefined,
        minNoticeHours: dto.minNoticeHours,
        allowCarryOver: dto.allowCarryOver ?? false,
        isActive: dto.isActive ?? true,
        carryOverLimitHours: new Prisma.Decimal(dto.carryOverLimitHours || 0),
        metadata: metadata ?? undefined,
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

    const normalizedCode = dto.code
      ? dto.code.trim().toUpperCase()
      : existing.code;
    const normalizedName = dto.name ? dto.name.trim() : existing.name;
    const isAnnualLeaveType = this.isAnnualLeaveType(
      normalizedCode,
      normalizedName,
    );

    const leaveType = await this.prisma.leaveType.update({
      where: { id },
      data: {
        code: normalizedCode,
        name: normalizedName,
        balanceResetPolicy: this.resolveLeaveTypeResetPolicy(
          normalizedCode,
          normalizedName,
          dto.balanceResetPolicy || existing.balanceResetPolicy,
        ),
        requiresDocument: dto.requiresDocument ?? existing.requiresDocument,
        maxDaysPerYear: isAnnualLeaveType
          ? null
          : dto.maxDaysPerYear !== undefined
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
        isActive: dto.isActive ?? existing.isActive,
        carryOverLimitHours:
          dto.carryOverLimitHours !== undefined
            ? new Prisma.Decimal(dto.carryOverLimitHours)
            : existing.carryOverLimitHours,
        metadata:
          dto.seniorityTiers !== undefined
            ? this.mergeLeaveTypeMetadata(existing.metadata, dto.seniorityTiers)
            : existing.metadata,
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
    const access = await this.getAdminAccessContext(userId, filters.entityId);
    const entityId = access.entityId;
    await this.ensureDefaultLeaveTypes(entityId, userId);

    if (entityId) {
      const [employees, leaveTypes] = await Promise.all([
        this.prisma.employee.findMany({
          where: {
            entityId,
            ...(filters.employeeId ? { id: filters.employeeId } : {}),
            isActive: true,
            ...(access.noAccess
              ? { id: '__no_access__' }
              : access.scope === 'SELF'
                ? { id: access.employeeId || '__no_access__' }
                : access.scope === 'DEPARTMENT'
                  ? { departmentId: access.departmentId || '__no_access__' }
                  : {}),
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
        ...(access.noAccess
          ? { employeeId: '__no_access__' }
          : access.scope === 'SELF'
            ? { employeeId: access.employeeId || '__no_access__' }
            : access.scope === 'DEPARTMENT'
              ? { employee: { departmentId: access.departmentId || '__no_access__' } }
              : {}),
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
      include: {
        employee: {
          select: {
            id: true,
            departmentId: true,
          },
        },
      },
    });

    if (!existing) {
      throw new BadRequestException('Leave balance not found');
    }

    const access = await this.getAdminAccessContext(userId, existing.entityId);
    const canAccessBalance =
      !access.noAccess &&
      (access.scope === 'ENTITY' ||
        (access.scope === 'SELF' && access.employeeId === existing.employeeId) ||
        (access.scope === 'DEPARTMENT' &&
          access.departmentId === existing.employee?.departmentId));
    if (!canAccessBalance || existing.entityId !== access.entityId) {
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

  private normalizeLeaveRequestDocuments(
    documents?: LeaveRequestDocumentInput[],
  ) {
    return (documents || [])
      .map((document) => ({
        fileName: document?.fileName?.trim(),
        fileUrl: document?.fileUrl?.trim(),
        mimeType: document?.mimeType?.trim(),
        docType: document?.docType?.trim(),
        checksum: document?.checksum?.trim(),
      }))
      .filter((document) => Boolean(document.fileName));
  }

  private async validateLeaveRequestPayload(params: {
    employee: {
      id: string;
      entityId: string;
      hireDate: Date;
    };
    leaveType: LeaveType;
    startAt: Date;
    endAt: Date;
    hours: number;
    documents: Array<{
      fileName?: string;
      fileUrl?: string;
      mimeType?: string;
      docType?: string;
      checksum?: string;
    }>;
    funeralDetails?: FuneralLeaveDetails | null;
  }) {
    if (
      Number.isNaN(params.startAt.getTime()) ||
      Number.isNaN(params.endAt.getTime())
    ) {
      throw new BadRequestException('請假日期格式不正確');
    }

    if (params.endAt <= params.startAt) {
      throw new BadRequestException('請假結束時間必須晚於開始時間');
    }

    if (!Number.isFinite(params.hours) || Number(params.hours) <= 0) {
      throw new BadRequestException('請假時數必須大於 0');
    }

    if (
      params.leaveType.minNoticeHours &&
      params.leaveType.minNoticeHours > 0
    ) {
      const noticeHours =
        (params.startAt.getTime() - Date.now()) / (60 * 60 * 1000);

      if (noticeHours < params.leaveType.minNoticeHours) {
        throw new BadRequestException(
          `${params.leaveType.name} 需至少提前 ${params.leaveType.minNoticeHours} 小時申請`,
        );
      }
    }

    if (params.leaveType.requiresDocument && params.documents.length === 0) {
      throw new BadRequestException(
        params.leaveType.documentExamples
          ? `此假別需提供附件，可參考：${params.leaveType.documentExamples}`
          : '此假別需提供附件後才能送出',
      );
    }

    if (params.funeralDetails) {
      await this.validateFuneralLeaveLimit(params);
    }

    const overlappingRequest = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId: params.employee.id,
        status: {
          in: [
            LeaveStatus.SUBMITTED,
            LeaveStatus.UNDER_REVIEW,
            LeaveStatus.APPROVED,
          ],
        },
        startAt: {
          lte: params.endAt,
        },
        endAt: {
          gte: params.startAt,
        },
      },
      select: {
        id: true,
      },
    });

    if (overlappingRequest) {
      throw new BadRequestException('此時段已有請假單正在審核或已核准');
    }
  }

  private resolveFuneralLeaveDetails(
    leaveType: LeaveType,
    dto: CreateLeaveRequestDto,
  ): FuneralLeaveDetails | null {
    if (!this.isFuneralLeaveType(leaveType)) {
      return null;
    }

    const relationship = dto.funeralRelationship as
      | FuneralLeaveRelationship
      | undefined;
    const rule = relationship
      ? FUNERAL_LEAVE_RELATIONSHIP_RULES[relationship]
      : undefined;

    if (!relationship || !rule) {
      throw new BadRequestException('請選擇喪假與亡者的親屬關係');
    }

    const deceasedName = dto.deceasedName?.trim();
    if (!deceasedName) {
      throw new BadRequestException('請填寫亡者姓名');
    }

    if (
      !dto.deceasedDate ||
      Number.isNaN(new Date(dto.deceasedDate).getTime())
    ) {
      throw new BadRequestException('請填寫正確的死亡日期');
    }

    const deceasedDate = new Date(dto.deceasedDate).toISOString().slice(0, 10);
    const eventKey =
      dto.funeralEventKey?.trim() ||
      `${relationship}:${deceasedName}:${deceasedDate}`;

    return {
      relationship,
      relationshipLabel: rule.label,
      maxDays: rule.days,
      maxHours: rule.days * 8,
      deceasedName,
      deceasedDate,
      eventKey,
    };
  }

  private async validateFuneralLeaveLimit(params: {
    employee: { id: string };
    leaveType: LeaveType;
    hours: number;
    funeralDetails?: FuneralLeaveDetails | null;
  }) {
    if (!params.funeralDetails) {
      return;
    }

    const existingRequests = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: params.employee.id,
        leaveTypeId: params.leaveType.id,
        status: {
          in: [
            LeaveStatus.SUBMITTED,
            LeaveStatus.UNDER_REVIEW,
            LeaveStatus.APPROVED,
          ],
        },
      },
      select: {
        hours: true,
        metadata: true,
      },
    });
    const usedHours = existingRequests
      .filter(
        (request) =>
          this.getFuneralEventKey(request.metadata) ===
          params.funeralDetails?.eventKey,
      )
      .reduce((sum, request) => sum + Number(request.hours), 0);
    const requestedHours = Number(params.hours);

    if (usedHours + requestedHours > params.funeralDetails.maxHours) {
      const remainingHours = Math.max(
        0,
        params.funeralDetails.maxHours - usedHours,
      );
      throw new BadRequestException(
        `此喪假事件上限為 ${params.funeralDetails.maxDays} 天，已申請 ${this.formatHoursAsDays(usedHours)}，剩餘 ${this.formatHoursAsDays(remainingHours)}。`,
      );
    }
  }

  private buildLeaveRequestMetadata(
    documentCount: number,
    funeralDetails?: FuneralLeaveDetails | null,
  ): Prisma.InputJsonValue | undefined {
    const metadata: Record<string, unknown> = {};

    if (documentCount > 0) {
      metadata.documentCount = documentCount;
    }

    if (funeralDetails) {
      metadata.funeral = {
        eventKey: funeralDetails.eventKey,
        relationship: funeralDetails.relationship,
        relationshipLabel: funeralDetails.relationshipLabel,
        maxDays: funeralDetails.maxDays,
        maxHours: funeralDetails.maxHours,
        deceasedName: funeralDetails.deceasedName,
        deceasedDate: funeralDetails.deceasedDate,
      };
    }

    return Object.keys(metadata).length > 0
      ? (metadata as Prisma.InputJsonObject)
      : undefined;
  }

  private getFuneralEventKey(metadata: Prisma.JsonValue | null) {
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      return undefined;
    }

    const funeral = (metadata as { funeral?: unknown }).funeral;
    if (
      typeof funeral !== 'object' ||
      funeral === null ||
      Array.isArray(funeral)
    ) {
      return undefined;
    }

    return (funeral as { eventKey?: unknown }).eventKey;
  }

  private isFuneralLeaveType(leaveType: LeaveType) {
    return (
      leaveType.code.trim().toUpperCase() === 'FUNERAL' ||
      leaveType.name.trim() === '喪假'
    );
  }

  private formatHoursAsDays(hours: number) {
    return hours % 8 === 0 ? `${hours / 8} 天` : `${hours} 小時`;
  }

  private async notifyLeaveApprovers(params: {
    requesterUserId: string;
    entityId: string;
    employeeName: string;
    leaveTypeName: string;
    leaveRequestId: string;
    hours: number;
    startAt: Date;
    endAt: Date;
  }) {
    const approvers = await this.prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: params.requesterUserId },
        roles: {
          some: {
            role: {
              OR: [
                { code: { in: ['SUPER_ADMIN', 'ADMIN'] } },
                { name: { in: ['SUPER_ADMIN', 'ADMIN'] } },
              ],
            },
          },
        },
        OR: [
          {
            employee: {
              is: {
                entityId: params.entityId,
              },
            },
          },
          {
            employee: {
              is: null,
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    for (const approver of approvers) {
      await this.notificationService.create({
        userId: approver.id,
        title: '有新的請假單待審核',
        message: `${params.employeeName} 提交了 ${params.leaveTypeName}，共 ${params.hours} 小時，請前往考勤後台審核。`,
        type: 'LEAVE_APPROVAL_REQUIRED',
        category: 'ATTENDANCE',
        data: {
          entityId: params.entityId,
          leaveRequestId: params.leaveRequestId,
          startAt: params.startAt.toISOString(),
          endAt: params.endAt.toISOString(),
        },
      });
    }
  }

  private mergeLeaveTypeMetadata(
    existingMetadata: Prisma.JsonValue | null | undefined,
    seniorityTiers:
      | Array<{ minYears: number; maxYears?: number; days: number }>
      | undefined,
  ): Prisma.InputJsonValue | null {
    const baseMetadata =
      existingMetadata &&
      typeof existingMetadata === 'object' &&
      !Array.isArray(existingMetadata)
        ? { ...(existingMetadata as Record<string, unknown>) }
        : {};

    if (seniorityTiers === undefined) {
      return Object.keys(baseMetadata).length > 0
        ? (baseMetadata as Prisma.InputJsonValue)
        : null;
    }

    const normalizedTiers = seniorityTiers
      .map((tier) => ({
        minYears: Number(tier.minYears),
        maxYears:
          tier.maxYears === undefined || tier.maxYears === null
            ? undefined
            : Number(tier.maxYears),
        days: Number(tier.days),
      }))
      .filter(
        (tier) =>
          Number.isFinite(tier.minYears) &&
          Number.isFinite(tier.days) &&
          (tier.maxYears === undefined || Number.isFinite(tier.maxYears)),
      )
      .sort((a, b) => a.minYears - b.minYears);

    if (normalizedTiers.length === 0) {
      delete baseMetadata.seniorityTiers;
      return Object.keys(baseMetadata).length > 0
        ? (baseMetadata as Prisma.InputJsonValue)
        : null;
    }

    baseMetadata.seniorityTiers = normalizedTiers;
    return baseMetadata as Prisma.InputJsonValue;
  }

  private async ensureDefaultLeaveTypes(
    entityId: string,
    actorUserId?: string,
  ) {
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { country: true },
    });

    if (!entity) {
      throw new BadRequestException('Entity not found');
    }

    const templates = this.getDefaultLeaveTypeTemplates(entity.country);
    if (templates.length === 0) {
      return this.prisma.leaveType.findMany({
        where: { entityId },
        orderBy: [{ code: 'asc' }],
      });
    }

    for (const template of templates) {
      const existing = await this.prisma.leaveType.findUnique({
        where: {
          entityId_code: {
            entityId,
            code: template.code,
          },
        },
      });

      if (existing) {
        if (
          template.code === 'ANNUAL' &&
          existing.balanceResetPolicy === 'HIRE_ANNIVERSARY' &&
          template.balanceResetPolicy === 'CALENDAR_YEAR' &&
          this.isSystemDefaultLeaveType(existing.metadata)
        ) {
          await this.prisma.leaveType.update({
            where: { id: existing.id },
            data: { balanceResetPolicy: 'CALENDAR_YEAR' },
          });
        }
        continue;
      }

      const created = await this.prisma.leaveType.create({
        data: {
          entityId,
          code: template.code,
          name: template.name,
          balanceResetPolicy: template.balanceResetPolicy,
          requiresDocument: template.requiresDocument,
          documentExamples: template.documentExamples,
          maxDaysPerYear:
            template.maxDaysPerYear !== undefined
              ? new Prisma.Decimal(template.maxDaysPerYear)
              : undefined,
          paidPercentage:
            template.paidPercentage !== undefined
              ? new Prisma.Decimal(template.paidPercentage)
              : undefined,
          minNoticeHours: template.minNoticeHours,
          allowCarryOver: template.allowCarryOver ?? false,
          carryOverLimitHours: new Prisma.Decimal(
            template.carryOverLimitHours || 0,
          ),
          requiresChildData: template.requiresChildData ?? false,
          metadata: {
            systemDefault: true,
            locale: entity.country,
          },
        },
      });

      if (actorUserId) {
        await this.auditLogService.record({
          userId: actorUserId,
          tableName: 'leave_types',
          recordId: created.id,
          action: 'CREATE',
          newData: created,
        });
      }
    }

    return this.prisma.leaveType.findMany({
      where: { entityId },
      orderBy: [{ code: 'asc' }],
    });
  }

  private getDefaultLeaveTypeTemplates(country?: string | null) {
    const normalizedCountry = String(country || '')
      .trim()
      .toUpperCase();

    if (['TW', 'TWN', 'TAIWAN'].includes(normalizedCountry)) {
      return DEFAULT_TW_LEAVE_TYPES;
    }

    return [];
  }

  private resolveLeaveTypeResetPolicy(
    code: string,
    name: string,
    requestedPolicy?: string | null,
  ) {
    if (this.isAnnualLeaveType(code, name) && requestedPolicy === 'NONE') {
      return 'CALENDAR_YEAR';
    }

    return requestedPolicy || 'CALENDAR_YEAR';
  }

  private isAnnualLeaveType(code: string, name: string) {
    return (
      code.trim().toUpperCase() === 'ANNUAL' ||
      ['特休', '特別休假'].includes(name.trim())
    );
  }

  private isSystemDefaultLeaveType(metadata: Prisma.JsonValue | null) {
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      !Array.isArray(metadata) &&
      (metadata as { systemDefault?: unknown }).systemDefault === true
    );
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

  private resolveEmployeeReferenceDate(hireDate: Date) {
    const now = new Date();
    return hireDate > now ? hireDate : now;
  }
}
