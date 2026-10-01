import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import {
  fingerprint,
  requireEntity,
  requirePermission,
} from './mailroom.contract';
import { SaveInspectionDto, SaveRepairDto } from './repair-document.dto';
import {
  RepairDocument,
  validateInspectionData,
  validateInspectionSubmission,
  validateRepairData,
} from './repair-document.contract';

@Injectable()
export class RepairWorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
  ) {}
  async documents(userId: string, entityId: string, id: string) {
    const detail = await this.mailroom.detail(userId, entityId, id);
    const actor = await this.mailroom.actor(userId);
    if (
      !actor.permissions.has('*') &&
      !actor.permissions.has('repair_workbench:read') &&
      !actor.permissions.has('mailroom:review')
    )
      throw new ForbiddenException('無檢修文件存取權限');
    requireEntity(actor, entityId);
    const sourceId = detail.receipt.sourceCaseId;
    let release: {
      available: boolean;
      repairAllowed?: boolean;
      sourceStatus?: string;
      sourceStatusLabel?: string;
      message?: string;
    } = { available: false, message: '沒有售後來源案件' };
    if (sourceId) {
      try {
        const source = (await this.sync.cases(entityId, '', sourceId)).items[0];
        release =
          source &&
          source.id === sourceId &&
          source.type === detail.receipt.category
            ? {
                available: true,
                repairAllowed: source.repairAllowed,
                sourceStatus: source.status,
                ...(typeof source.statusLabel === 'string'
                  ? { sourceStatusLabel: source.statusLabel }
                  : {}),
              }
            : { available: false, message: '來源案件不存在或不在授權範圍' };
      } catch {
        release = {
          available: false,
          message: '目前無法取得售後同意與收款狀態',
        };
      }
    }
    return {
      ...detail,
      release,
      editable:
        (actor.permissions.has('*') ||
          actor.permissions.has('repair_workbench:update')) &&
        detail.repairOwnerId === userId &&
        detail.custodianId === userId,
    };
  }
  async save(
    userId: string,
    id: string,
    kind: 'inspection' | 'repair',
    input: SaveInspectionDto | SaveRepairDto,
  ) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, input.entityId);
    requirePermission(actor, 'repair_workbench:update');
    if (input.status === 'SUBMITTED') {
      if (kind === 'inspection')
        validateInspectionData((input as SaveInspectionDto).data);
      else validateRepairData((input as SaveRepairDto).data);
    }
    const hash = fingerprint({ kind, ...input });
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_items WHERE id=${id} FOR UPDATE`,
      );
      const fresh = await this.mailroom.actor(userId, tx);
      requireEntity(fresh, input.entityId);
      requirePermission(fresh, 'repair_workbench:update');
      const row = await tx.mailroomItem.findUnique({
        where: { id },
        include: { receipt: true },
      });
      if (!row || row.entityId !== input.entityId)
        throw new NotFoundException('找不到維修物件');
      if (
        row.repairOwnerId !== userId ||
        row.custodianId !== userId ||
        !['REPAIR', 'RETURN'].includes(row.receipt.category)
      )
        throw new ForbiddenException('只有實物已簽收的維修師能填寫工作單');
      const previous = await tx.mailroomAction.findUnique({
        where: {
          entityId_actorId_requestId: {
            entityId: input.entityId,
            actorId: userId,
            requestId: input.requestId,
          },
        },
      });
      if (previous) {
        if (previous.requestHash !== hash || previous.itemId !== id)
          throw new ConflictException('同一操作識別碼的內容不同');
        return { duplicate: true, notifications: [] };
      }
      if (row.version !== input.expectedVersion)
        throw new ConflictException('案件已更新，請重新載入後再儲存');
      const stages =
        kind === 'inspection'
          ? ['REPAIR_RECEIVED', 'INSPECTING', 'REFURBISHING']
          : ['INSPECTING', 'REPAIRING', 'REFURBISHING'];
      if (!stages.includes(row.status))
        throw new ConflictException(
          '此階段不能修改工作單，請先確認目前交辦進度',
        );
      if (kind === 'repair' && input.status === 'SUBMITTED') {
        const report = (input as SaveRepairDto).data;
        if (
          report.outcome === 'REPLACED' &&
          row.serialNumber &&
          report.replacementSerial?.trim() === row.serialNumber.trim()
        )
          throw new ConflictException(
            '替換件序號與原件相同，請核對實物；原機維修應記為維修',
          );
      }
      const inspection =
        kind === 'repair' && input.status === 'SUBMITTED'
          ? validateInspectionSubmission(row.repairInspection)
          : null;
      const key = kind === 'inspection' ? 'repairInspection' : 'repairReport';
      const old = row[key] as RepairDocument | null;
      const now = new Date().toISOString();
      const doc = {
        number: (kind === 'inspection' ? 'INS-' : 'REP-') + row.label,
        revision: (old?.revision || 0) + 1,
        status: input.status,
        authorId: userId,
        authorName: fresh.name,
        updatedAt: now,
        ...(input.status === 'SUBMITTED' ? { submittedAt: now } : {}),
        ...(kind === 'repair'
          ? {
              inspectionRevision:
                inspection?.revision ||
                (row.repairInspection as RepairDocument | null)?.revision,
            }
          : {}),
        data: input.data,
      };
      const updated = await tx.mailroomItem.update({
        where: { id },
        data: {
          [key]: JSON.parse(JSON.stringify(doc)) as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
        include: { receipt: true },
      });
      const notifications = await this.mailroom.record(
        tx,
        fresh,
        updated,
        (input.status === 'SUBMITTED' ? 'submit_' : 'save_') + 'repair_' + kind,
        input.requestId,
        hash,
        row.status,
        JSON.stringify({
          documentNumber: doc.number,
          revision: doc.revision,
          status: doc.status,
        }),
        false,
      );
      // record() retains complete documents in immutable history and queues the existing compatible event.
      return { duplicate: false, notifications };
    });
    this.mailroom.publish(result.notifications);
    return { id, duplicate: result.duplicate };
  }
}
