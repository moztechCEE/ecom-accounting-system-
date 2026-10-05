import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { can, requireEntity, type SourceCase } from './mailroom.contract';
import {
  isPhysicalSourceCase,
  type SourceChangeEvent,
  validateSourceChanges,
} from './mailroom-source.contract';
import { repairWorkflow } from './repair-workflow.contract';

const DEV_SOURCE = 'https://moztech-after-sales-dev-sp5g377smq-de.a.run.app';
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
@Injectable()
export class MailroomSourceSyncService
  implements OnModuleInit, OnModuleDestroy
{
  private running = false;
  private readonly logger = new Logger(MailroomSourceSyncService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly sync: MailroomSyncService,
    private readonly mailroom: MailroomService,
    private readonly notifications: NotificationService,
  ) {}
  onModuleInit() {
    this.sync.registerSourceConsumer(() => this.poll());
  }
  onModuleDestroy() {
    this.sync.registerSourceConsumer(undefined);
  }
  async poll() {
    if (this.running || !this.sync.sourcePollingEnabled()) return;
    this.running = true;
    try {
      const scopes = this.sync
        .sourceScopes()
        .filter(
          (scope) =>
            process.env.ERP_DEV_SANDBOX !== 'true' ||
            (scope.entityId === 'doa-dev-qa-20261002' &&
              scope.sourceInstance === DEV_SOURCE),
        );
      for (const scope of scopes) {
        try {
          await this.consume(scope.entityId, scope.sourceInstance);
        } catch {
          this.logger.warn('來源變更尚未完成，保留游標等待重試');
        }
      }
    } finally {
      this.running = false;
    }
  }
  async consume(entityId: string, sourceInstance: string) {
    if (
      !this.sync.sourcePollingEnabled() ||
      !this.sync
        .sourceScopes()
        .some(
          (scope) =>
            scope.entityId === entityId &&
            scope.sourceInstance === sourceInstance,
        ) ||
      (process.env.ERP_DEV_SANDBOX === 'true' &&
        (entityId !== 'doa-dev-qa-20261002' || sourceInstance !== DEV_SOURCE))
    )
      return;
    const cursor = await this.db.mailroomSourceCursor.upsert({
      where: { entityId_sourceInstance: { entityId, sourceInstance } },
      create: { entityId, sourceInstance },
      update: {},
    });
    const leaseToken = randomUUID();
    const now = new Date();
    const acquired = await this.db.mailroomSourceCursor.updateMany({
      where: {
        id: cursor.id,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: { leaseToken, leaseUntil: new Date(now.getTime() + 300000) },
    });
    if (acquired.count !== 1) return;
    try {
      const leased = await this.db.mailroomSourceCursor.findUniqueOrThrow({
        where: { id: cursor.id },
      });
      if (leased.leaseToken !== leaseToken)
        throw new ConflictException('來源同步租約已變更');
      const page = validateSourceChanges(
        await this.sync.changes(entityId, leased.cursor.toString()),
        leased.cursor.toString(),
      );
      const latest = new Map<string, SourceChangeEvent>();
      for (const event of page.events) latest.set(event.caseId, event);
      const projections = new Map<string, SourceCase | null>();
      const reads = [...latest.values()].filter(
        (event) => isPhysicalSourceCase(event) && event.change === 'UPDATED',
      );
      // Do not hold database locks while reading the source. Bound both concurrency and response size.
      for (let offset = 0; offset < reads.length; offset += 5) {
        await Promise.all(
          reads.slice(offset, offset + 5).map(async (event) => {
            try {
              const projection = (
                await this.sync.cases(entityId, '', event.caseId)
              ).items[0];
              if (
                !projection ||
                projection.id !== event.caseId ||
                projection.type !==
                  (event.caseType === 'REPAIR' ? 'REPAIR' : 'RETURN')
              )
                throw new BadGatewayException('來源案件識別不符');
              projections.set(event.caseId, projection);
            } catch (error) {
              const status =
                error instanceof BadGatewayException
                  ? (error.getResponse() as { upstreamStatus?: number })
                      .upstreamStatus
                  : undefined;
              if (status !== 404) throw error;
              // An UPDATED event may precede a deletion beyond this page. Keep custody and continue to the deletion event.
              projections.set(event.caseId, null);
            }
          }),
        );
      }
      const result = await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM mailroom_source_cursors WHERE id=${cursor.id} FOR UPDATE`,
          );
          const current = await tx.mailroomSourceCursor.findUniqueOrThrow({
            where: { id: cursor.id },
          });
          if (
            current.leaseToken !== leaseToken ||
            !current.leaseUntil ||
            current.leaseUntil <= new Date() ||
            current.cursor !== leased.cursor
          )
            throw new ConflictException('來源同步租約或游標已變更');
          const processed = await tx.mailroomSourceChange.findMany({
            where: {
              cursorId: cursor.id,
              sourceEventId: { in: page.events.map((event) => event.id) },
            },
            select: { sourceEventId: true },
          });
          const processedIds = new Set(
            processed.map((event) => event.sourceEventId),
          );
          const unprocessed = page.events.filter(
            (event) => !processedIds.has(event.id),
          );
          const cases = new Map<string, SourceChangeEvent>();
          for (const event of unprocessed) cases.set(event.caseId, event);
          const users = cases.size
            ? await tx.user.findMany({
                where: {
                  isActive: true,
                  mustChangePassword: false,
                  OR: [
                    { employee: { entityId, isActive: true } },
                    { entityMemberships: { some: { entityId } } },
                  ],
                },
                select: { id: true, salesDataScope: true },
              })
            : [];
          const actors = new Map<
            string,
            Awaited<ReturnType<MailroomService['actor']>>
          >();
          for (const user of users) {
            try {
              const actor = await this.mailroom.actor(user.id, tx);
              requireEntity(actor, entityId);
              actors.set(user.id, actor);
            } catch {
              /* Revoked/foreign company users receive no notification. */
            }
          }
          const notices: Awaited<
            ReturnType<NotificationService['createDeferred']>
          >[] = [];
          for (const event of cases.values()) {
            const receipts = await tx.mailroomReceipt.findMany({
              where: { entityId, sourceCaseId: event.caseId },
              include: { items: true },
            });
            const items = receipts.flatMap((receipt) => receipt.items);
            if (isPhysicalSourceCase(event))
              for (const receipt of receipts) {
                const old =
                  receipt.sourceSnapshot &&
                  typeof receipt.sourceSnapshot === 'object' &&
                  !Array.isArray(receipt.sourceSnapshot)
                    ? receipt.sourceSnapshot
                    : {};
                const projection = projections.get(event.caseId);
                await tx.mailroomReceipt.update({
                  where: { id: receipt.id },
                  data: {
                    sourceSnapshot: json({
                      ...(projection || old),
                      sourceSync: {
                        sourceInstance,
                        eventId: event.id,
                        occurredAt: event.occurredAt,
                        change: event.change,
                        sourceChannel: event.sourceChannel,
                        initial: event.initial,
                        availability:
                          event.change === 'DELETED'
                            ? 'DELETED'
                            : projection
                              ? 'AVAILABLE'
                              : 'NOT_FOUND',
                      },
                    }),
                  },
                });
              }
            // Bootstrap old cases without notifying staff. The last event for a case in this page decides this.
            if (event.initial) continue;
            const related = new Set(
              items.flatMap((item) => [
                item.custodianId,
                item.nextUserId,
                item.repairOwnerId,
                repairWorkflow(item.repairWorkflow).csr?.ownerId,
              ]),
            );
            for (const receipt of receipts) {
              related.add(receipt.customerServiceUserId);
              related.add(receipt.receivedById);
            }
            const hasRepairItem = items.some(
              (item) => item.repairOwnerId != null,
            );
            const recipients = users.filter((user) => {
              const actor = actors.get(user.id);
              if (!actor) return false;
              const originalModule =
                (can(actor, '*') || user.salesDataScope === 'ENTITY') &&
                [
                  'after_sales_cases:read',
                  'after_sales_shipping:read',
                  'after_sales_accounting:read',
                  'after_sales_invoices:read',
                ].some((permission) => can(actor, permission));
              const physicalReader =
                isPhysicalSourceCase(event) &&
                (can(actor, 'mailroom:read') ||
                  can(actor, 'mailroom:review') ||
                  ((event.caseType === 'REPAIR' ||
                    hasRepairItem ||
                    related.has(user.id)) &&
                    can(actor, 'repair_workbench:read')));
              return originalModule || physicalReader;
            });
            for (const recipient of recipients) {
              const item =
                items.find(
                  (item) =>
                    item.repairOwnerId === recipient.id ||
                    item.nextUserId === recipient.id ||
                    item.custodianId === recipient.id,
                ) || items[0];
              notices.push(
                await this.notifications.createDeferred(tx, {
                  userId: recipient.id,
                  category: 'mailroom',
                  type: event.change === 'DELETED' ? 'warning' : 'info',
                  title:
                    event.change === 'DELETED'
                      ? '售後來源已刪除，請確認手上案件'
                      : '售後案件已更新，請確認最新作業',
                  message:
                    event.caseNumber +
                    ' · ' +
                    (event.change === 'DELETED'
                      ? '實物與既有紀錄保留，請由客服核對'
                      : '顧客回覆、案件資料或處理進度有更新'),
                  data: {
                    entityId,
                    sourceCaseId: event.caseId,
                    sourceEventId: event.id,
                    sourceCaseType: event.caseType,
                    targetPath: item
                      ? '/my/inbox?itemId=' +
                        item.id +
                        '&entityId=' +
                        encodeURIComponent(entityId)
                      : '/operations/after-sales/cases?entityId=' +
                        encodeURIComponent(entityId),
                  },
                }),
              );
            }
          }
          if (unprocessed.length)
            await tx.mailroomSourceChange.createMany({
              data: unprocessed.map((event) => ({
                cursorId: cursor.id,
                sourceEventId: event.id,
                caseId: event.caseId,
                change: event.change,
                sourceChannel: event.sourceChannel,
                occurredAt: new Date(event.occurredAt),
                initial: event.initial,
              })),
              skipDuplicates: true,
            });
          await tx.mailroomSourceCursor.update({
            where: { id: cursor.id },
            data: {
              cursor: BigInt(page.nextCursor),
              version: { increment: 1 },
              leaseToken: null,
              leaseUntil: null,
            },
          });
          return { notices, events: unprocessed.length, hasMore: page.hasMore };
        },
        { maxWait: 5000, timeout: 30000 },
      );
      this.notifications.publishPersisted(result.notices);
      return { processed: result.events, hasMore: result.hasMore };
    } finally {
      await this.db.mailroomSourceCursor.updateMany({
        where: { id: cursor.id, leaseToken },
        data: { leaseToken: null, leaseUntil: null },
      });
    }
  }
}
