import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';

type Action = 'read' | 'write' | 'manage';
type Actor = {
  employeeId: string | null;
  entityId: string | null;
  allowedEntityIds: string[] | null;
  permissions: Set<string>;
};

const employeeIdentitySelect = {
  id: true,
  employeeNo: true,
  name: true,
  department: { select: { id: true, name: true } },
} as const;

const reviewSelect = {
  id: true,
  cycleId: true,
  subjectEmployeeId: true,
  reviewerEmployeeId: true,
  status: true,
  score: true,
  goals: true,
  comment: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
  cycle: {
    select: {
      id: true,
      entityId: true,
      title: true,
      periodStart: true,
      periodEnd: true,
    },
  },
  subject: { select: employeeIdentitySelect },
  reviewer: { select: employeeIdentitySelect },
} as const satisfies Prisma.PerformanceReviewSelect;

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  private async actor(userId: string): Promise<Actor> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isActive: true,
        employee: { select: { id: true, entityId: true, isActive: true } },
        entityMemberships: { select: { entityId: true } },
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: {
                  select: {
                    permission: { select: { resource: true, action: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!user?.isActive) throw new ForbiddenException('帳號未啟用');
    const codes = user.roles.map(({ role }) => role.code);
    const privileged = codes.includes('SUPER_ADMIN') || codes.includes('ADMIN');
    const permissions = new Set(
      user.roles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) =>
          `${permission.resource}:${permission.action}`,
        ),
      ),
    );
    if (privileged) {
      for (const action of ['read', 'write', 'manage'] as const)
        permissions.add(`performance_reviews:${action}`);
    }
    const employee = user.employee?.isActive ? user.employee : null;
    return {
      employeeId: employee?.id || null,
      entityId: employee?.entityId || null,
      allowedEntityIds: codes.includes('SUPER_ADMIN')
        ? null
        : [
            ...new Set([
              ...(employee?.entityId ? [employee.entityId] : []),
              ...user.entityMemberships.map(({ entityId }) => entityId),
            ]),
          ],
      permissions,
    };
  }

  private require(actor: Actor, action: Action) {
    if (!actor.permissions.has(`performance_reviews:${action}`)) {
      throw new ForbiddenException('沒有考核操作權限');
    }
  }

  private canManage(actor: Actor) {
    return actor.permissions.has('performance_reviews:manage');
  }

  private assertEntity(actor: Actor, entityId: string) {
    if (!entityId || (actor.allowedEntityIds && !actor.allowedEntityIds.includes(entityId))) {
      throw new ForbiddenException('沒有此公司的考核資料權限');
    }
    if (!this.canManage(actor) && (!actor.employeeId || actor.entityId !== entityId)) {
      throw new ForbiddenException('沒有此公司的考核資料權限');
    }
  }

  private entityWhere(actor: Actor, requestedEntityId?: string) {
    const entityId = requestedEntityId?.trim();
    if (entityId) {
      this.assertEntity(actor, entityId);
      return entityId;
    }
    if (this.canManage(actor)) {
      return actor.allowedEntityIds ? { in: actor.allowedEntityIds } : undefined;
    }
    if (!actor.entityId || !actor.employeeId) {
      throw new ForbiddenException('必須連結在職員工資料才能查看考核');
    }
    return actor.entityId;
  }

  private parseDate(value: string, label: string): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${label} 格式須為 YYYY-MM-DD`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${label} 不是有效日期`);
    }
    return date;
  }

  async listCycles(userId: string, entityId?: string) {
    const actor = await this.actor(userId);
    this.require(actor, 'read');
    return this.prisma.performanceCycle.findMany({
      where: {
        entityId: this.entityWhere(actor, entityId),
        ...(!this.canManage(actor)
          ? { reviews: { some: { reviewerEmployeeId: actor.employeeId! } } }
          : {}),
      },
      select: {
        id: true,
        entityId: true,
        title: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        _count: { select: { reviews: true } },
      },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createCycle(
    userId: string,
    data: { entityId: string; title: string; periodStart: string; periodEnd: string },
  ) {
    const actor = await this.actor(userId);
    this.require(actor, 'manage');
    const entityId = data?.entityId?.trim();
    this.assertEntity(actor, entityId);
    const title = data?.title?.trim();
    if (!title || title.length > 120) throw new BadRequestException('請輸入 1 到 120 字的考核週期名稱');
    const periodStart = this.parseDate(data.periodStart, '開始日期');
    const periodEnd = this.parseDate(data.periodEnd, '結束日期');
    if (periodEnd < periodStart) throw new BadRequestException('結束日期不可早於開始日期');
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId }, select: { id: true } });
    if (!entity) throw new NotFoundException('公司不存在');
    try {
      const cycle = await this.prisma.performanceCycle.create({
        data: { entityId, title, periodStart, periodEnd },
        select: { id: true, entityId: true, title: true, periodStart: true, periodEnd: true, createdAt: true },
      });
      await this.audit.record({ userId, tableName: 'performance_cycles', recordId: cycle.id, action: 'CREATE', newData: cycle });
      return cycle;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('此公司與期間的考核週期已存在');
      }
      throw error;
    }
  }

  async getRoster(userId: string, entityId: string) {
    const actor = await this.actor(userId);
    this.require(actor, 'read');
    if (!entityId?.trim()) throw new BadRequestException('請指定公司');
    this.assertEntity(actor, entityId);
    return this.prisma.employee.findMany({
      where: {
        entityId,
        isActive: true,
        ...(!this.canManage(actor)
          ? { supervisorEmployeeId: actor.employeeId! }
          : {}),
      },
      select: {
        ...employeeIdentitySelect,
        supervisorEmployeeId: true,
      },
      orderBy: [{ employeeNo: 'asc' }],
    });
  }

  async assignReview(
    userId: string,
    cycleId: string,
    data: { subjectEmployeeId: string; reviewerEmployeeId?: string },
  ) {
    const actor = await this.actor(userId);
    this.require(actor, 'manage');
    const cycle = await this.prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, entityId: true },
    });
    if (!cycle) throw new NotFoundException('考核週期不存在');
    this.assertEntity(actor, cycle.entityId);
    const subject = await this.prisma.employee.findFirst({
      where: { id: data?.subjectEmployeeId, entityId: cycle.entityId, isActive: true },
      select: { id: true, supervisorEmployeeId: true },
    });
    if (!subject) throw new NotFoundException('受評員工不存在或不在此公司');
    const reviewerId = data?.reviewerEmployeeId?.trim() || subject.supervisorEmployeeId;
    if (!reviewerId || reviewerId === subject.id) {
      throw new BadRequestException('請指定不同於受評員工的評核人');
    }
    const reviewer = await this.prisma.employee.findFirst({
      where: { id: reviewerId, entityId: cycle.entityId, isActive: true, user: { isActive: true } },
      select: { id: true, userId: true },
    });
    if (!reviewer?.userId) throw new BadRequestException('評核人須為同公司在職且有啟用帳號的員工');
    const reviewerAccess = await this.actor(reviewer.userId);
    if (reviewerAccess.employeeId !== reviewer.id ||
        !reviewerAccess.permissions.has('performance_reviews:read') ||
        !reviewerAccess.permissions.has('performance_reviews:write')) {
      throw new BadRequestException('請先為評核人指派主管考核職務範本');
    }
    try {
      const review = await this.prisma.performanceReview.create({
        data: {
          cycleId: cycle.id,
          subjectEmployeeId: subject.id,
          reviewerEmployeeId: reviewer.id,
        },
        select: reviewSelect,
      });
      await this.audit.record({ userId, tableName: 'performance_reviews', recordId: review.id, action: 'CREATE', newData: review });
      return review;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('此員工已在此週期建立考核');
      }
      throw error;
    }
  }

  async listReviews(userId: string, cycleId?: string, entityId?: string) {
    const actor = await this.actor(userId);
    this.require(actor, 'read');
    const where: Prisma.PerformanceReviewWhereInput = {
      ...(cycleId ? { cycleId } : {}),
      cycle: { entityId: this.entityWhere(actor, entityId) },
      ...(!this.canManage(actor)
        ? { reviewerEmployeeId: actor.employeeId! }
        : {}),
    };
    return this.prisma.performanceReview.findMany({
      where,
      select: reviewSelect,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async getReview(userId: string, id: string) {
    const actor = await this.actor(userId);
    this.require(actor, 'read');
    const review = await this.prisma.performanceReview.findUnique({
      where: { id },
      select: reviewSelect,
    });
    if (!review) throw new NotFoundException('考核不存在');
    this.assertEntity(actor, review.cycle.entityId);
    if (!this.canManage(actor) && review.reviewerEmployeeId !== actor.employeeId) {
      throw new NotFoundException('考核不存在');
    }
    return review;
  }

  private async assignedDraft(userId: string, id: string) {
    const actor = await this.actor(userId);
    this.require(actor, 'write');
    if (!actor.employeeId || !actor.entityId) {
      throw new ForbiddenException('必須連結在職員工資料才能填寫考核');
    }
    const review = await this.prisma.performanceReview.findUnique({
      where: { id },
      select: reviewSelect,
    });
    if (!review || review.reviewerEmployeeId !== actor.employeeId) {
      throw new NotFoundException('考核不存在');
    }
    this.assertEntity(actor, review.cycle.entityId);
    if (review.status !== 'DRAFT') throw new ConflictException('已送出的考核不可修改');
    return review;
  }

  async updateReview(
    userId: string,
    id: string,
    data: { score?: number | null; goals?: string | null; comment?: string | null },
  ) {
    const current = await this.assignedDraft(userId, id);
    const update: Prisma.PerformanceReviewUpdateManyMutationInput = {};
    if (data?.score !== undefined) {
      if (data.score !== null && (!Number.isInteger(data.score) || data.score < 1 || data.score > 5)) {
        throw new BadRequestException('考核分數須為 1 到 5 的整數');
      }
      update.score = data.score;
    }
    for (const key of ['goals', 'comment'] as const) {
      if (data?.[key] !== undefined) {
        if (data[key] !== null && typeof data[key] !== 'string') {
          throw new BadRequestException(`${key} 必須是文字`);
        }
        const value = data[key]?.trim() || null;
        if (value && value.length > 5000) throw new BadRequestException(`${key} 不可超過 5000 字`);
        update[key] = value;
      }
    }
    if (Object.keys(update).length === 0) throw new BadRequestException('沒有要更新的考核內容');
    const result = await this.prisma.performanceReview.updateMany({
      where: { id, status: 'DRAFT', reviewerEmployeeId: current.reviewerEmployeeId },
      data: update,
    });
    if (result.count !== 1) throw new ConflictException('考核狀態已改變，請重新整理');
    const updated = await this.prisma.performanceReview.findUniqueOrThrow({ where: { id }, select: reviewSelect });
    await this.audit.record({ userId, tableName: 'performance_reviews', recordId: id, action: 'UPDATE', oldData: current, newData: updated });
    return updated;
  }

  async submitReview(userId: string, id: string) {
    const current = await this.assignedDraft(userId, id);
    if (current.score === null || !current.comment?.trim()) {
      throw new BadRequestException('送出前請填寫評分與評語');
    }
    const submittedAt = new Date();
    const result = await this.prisma.performanceReview.updateMany({
      where: { id, status: 'DRAFT', reviewerEmployeeId: current.reviewerEmployeeId },
      data: { status: 'SUBMITTED', submittedAt },
    });
    if (result.count !== 1) throw new ConflictException('考核狀態已改變，請重新整理');
    const submitted = await this.prisma.performanceReview.findUniqueOrThrow({ where: { id }, select: reviewSelect });
    await this.audit.record({ userId, tableName: 'performance_reviews', recordId: id, action: 'SUBMIT', oldData: current, newData: submitted });
    return submitted;
  }
}
