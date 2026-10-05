import {
  BadRequestException,
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
  type Actor,
  type SourceCase,
} from './mailroom.contract';
import { MailroomCommandDto, MailroomQuery } from './mailroom.dto';
import {
  intakeTransition,
  type IntakeCommand,
} from './mailroom-intake.contract';
import { repairWorkflow } from './repair-workflow.contract';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class MailroomIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
  ) {}

  async queue(userId: string, query: MailroomQuery) {
    this.mailroom.enabled();
    const actor = await this.mailroom.intakeCustomerService(
      userId,
      query.entityId,
    );
    const page = query.page || 1;
    const limit = 30;
    const where: Prisma.MailroomItemWhereInput = {
      entityId: query.entityId,
      status: 'RECEIVED',
      receipt: {
        entityId: query.entityId,
        category: 'UNMATCHED',
        sourceCaseId: null,
      },
      AND: [
        {
          OR: [
            {
              repairWorkflow: { path: ['intake', 'status'], equals: 'SENT' },
              AND: [
                {
                  repairWorkflow: {
                    path: ['intake', 'sentToUserId'],
                    equals: userId,
                  },
                },
              ],
            },
            {
              repairWorkflow: {
                path: ['intake', 'status'],
                equals: 'ACCEPTED',
              },
              AND: [
                {
                  repairWorkflow: {
                    path: ['intake', 'ownerId'],
                    equals: userId,
                  },
                },
              ],
            },
          ],
        },
      ],
      ...(query.search?.trim()
        ? {
            OR: ['label', 'productName', 'sku', 'serialNumber'].map((key) => ({
              [key]: { contains: query.search!.trim(), mode: 'insensitive' },
            })),
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.mailroomItem.findMany({
        where,
        include: { receipt: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.mailroomItem.count({ where }),
    ]);
    return {
      items: await this.mailroom.views(items, userId, actor),
      total,
      page,
      limit,
    };
  }

  async command(userId: string, id: string, input: MailroomCommandDto) {
    this.mailroom.enabled();
    const sending = input.action === 'send_intake';
    const actor = sending
      ? await this.mailroom.actor(userId)
      : await this.mailroom.intakeCustomerService(userId, input.entityId);
    requireEntity(actor, input.entityId);
    if (sending) requirePermission(actor, 'mailroom:update');
    const current = await this.prisma.mailroomItem.findUnique({
      where: { id },
      include: { receipt: true },
    });
    if (
      !current ||
      current.entityId !== input.entityId ||
      current.receipt.entityId !== input.entityId
    )
      throw new NotFoundException('找不到物件');
    const hash = fingerprint({ id, ...input });
    const key = {
      entityId: input.entityId,
      actorId: userId,
      requestId: input.requestId,
    };
    const committed = await this.prisma.mailroomAction.findUnique({
      where: { entityId_actorId_requestId: key },
    });
    if (
      committed &&
      (committed.requestHash !== hash || committed.itemId !== id)
    )
      throw new ConflictException('同一操作識別碼的內容不同');
    let target: Actor | undefined;
    let source: SourceCase | undefined;
    if (!committed && sending) {
      if (!input.csrUserId) throw new BadRequestException('請指定接手客服');
      target = await this.mailroom.intakeCustomerService(
        input.csrUserId,
        input.entityId,
      );
    }
    if (!committed && input.action === 'bind_intake') {
      // Validate local owner/stage before any source lookup; an unauthorized reader cannot use this as a lookup endpoint.
      intakeTransition(current, input as IntakeCommand, actor);
      source = (await this.sync.cases(input.entityId, '', input.sourceCaseId))
        .items[0];
      if (
        !source ||
        source.id !== input.sourceCaseId ||
        source.type !== input.targetCategory ||
        ['CANCELLED', 'CLOSED', 'COMPLETED'].includes(source.status) ||
        !source.items.some((line) => line.id === input.sourceItemId)
      )
        throw new BadRequestException('來源案件或申報品項不符');
      if (source.version !== input.sourceVersion)
        throw new ConflictException('來源案件版次已更新，請重新選取');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      // The operation key is shared across native items. Serialize it before the item lock
      // so a concurrent different-body request becomes a deterministic 409, not a unique-index race.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':mailroom-intake-action:' + userId + ':' + input.requestId}))`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_items WHERE id=${id} AND entity_id=${input.entityId} FOR UPDATE`,
      );
      const freshActor = sending
        ? await this.mailroom.actor(userId, tx)
        : await this.mailroom.intakeCustomerService(userId, input.entityId, tx);
      requireEntity(freshActor, input.entityId);
      if (sending) requirePermission(freshActor, 'mailroom:update');
      const previous = await tx.mailroomAction.findUnique({
        where: { entityId_actorId_requestId: key },
      });
      if (previous) {
        if (previous.requestHash !== hash || previous.itemId !== id)
          throw new ConflictException('同一操作識別碼的內容不同');
        return { duplicate: true, notifications: [] };
      }
      const item = await tx.mailroomItem.findUniqueOrThrow({
        where: { id },
        include: { receipt: true },
      });
      if (
        item.entityId !== input.entityId ||
        item.receipt.entityId !== input.entityId
      )
        throw new ForbiddenException('公司不符');
      if (sending)
        target = await this.mailroom.intakeCustomerService(
          input.csrUserId!,
          input.entityId,
          tx,
        );
      const state = intakeTransition(
        item,
        input as IntakeCommand,
        freshActor,
        target,
      );
      const changes: Prisma.MailroomItemUpdateInput = {};
      if (input.action === 'bind_intake') {
        if (
          !source ||
          (await tx.mailroomItem.count({
            where: { receiptId: item.receiptId },
          })) !== 1
        )
          throw new BadRequestException(
            '此舊收件包含多個品項，需由主管核對歸屬後再處理',
          );
        const snapshot = await this.mailroom.reserveSourceCapacity(
          tx,
          item.entityId,
          source,
          [input.sourceItemId],
          item.id,
          source,
        );
        state.sourceNumber = snapshot.number;
        await tx.mailroomReceipt.update({
          where: { id: item.receiptId },
          data: {
            category: input.targetCategory!,
            sourceCaseId: snapshot.id,
            sourceNumber: snapshot.number,
            sourceSnapshot: json(snapshot),
            customerServiceUserId: await this.mailroom.customerService(
              snapshot,
              item.entityId,
              tx,
            ),
          },
        });
        changes.declared = json(
          snapshot.items.find((line) => line.id === input.sourceItemId),
        );
      }
      changes.repairWorkflow = json({
        ...repairWorkflow(item.repairWorkflow),
        intake: state,
      });
      const updated = await tx.mailroomItem.update({
        where: { id },
        data: { ...changes, version: { increment: 1 } },
        include: { receipt: true },
      });
      // The immutable intake branch retains the CSR closure. Source understands identify as first association;
      // it must not receive an invented financial/physical action enum.
      const action = input.action === 'bind_intake' ? 'identify' : input.action;
      const notifications = await this.mailroom.record(
        tx,
        freshActor,
        updated,
        action,
        input.requestId,
        hash,
        item.status,
        input.note?.trim(),
        true,
      );
      if (!sending && updated.custodianId !== freshActor.id) {
        const holder = await this.mailroom
          .actor(updated.custodianId, tx)
          .catch(() => null);
        if (
          holder &&
          (holder.entityIds === null ||
            holder.entityIds.includes(updated.entityId)) &&
          (holder.permissions.has('mailroom:read') ||
            holder.permissions.has('*'))
        ) {
          notifications.push(
            await tx.notification.create({
              data: {
                userId: holder.id,
                title:
                  input.action === 'claim_intake'
                    ? '客服已接手補建案件'
                    : '客服已完成售後案件綁定',
                message: updated.label + ' · ' + updated.productName,
                type: 'info',
                category: 'mailroom',
                data: {
                  itemId: id,
                  entityId: updated.entityId,
                  targetPath:
                    '/my/inbox?itemId=' +
                    encodeURIComponent(id) +
                    '&entityId=' +
                    encodeURIComponent(updated.entityId),
                },
              },
            }),
          );
        }
      }
      return { duplicate: false, notifications };
    });
    this.mailroom.publish(result.notifications);
    return { id, duplicate: result.duplicate };
  }
}
