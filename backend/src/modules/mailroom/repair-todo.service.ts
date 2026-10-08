import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  can,
  requireEntity,
  requirePermission,
  type SourceCase,
} from './mailroom.contract';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { repairConditions } from './repair-list.contract';
import {
  REPAIR_TODO_STATUSES,
  repairTodoDecision,
  repairTodoSourceDecision,
  type RepairTodoKind,
} from './repair-todo.contract';
import { type RepairTodoQuery } from './repair-todo.dto';

const candidateSelect = {
  id: true,
  entityId: true,
  status: true,
  version: true,
  repairOwnerId: true,
  custodianId: true,
  nextUserId: true,
  repairInspection: true,
  repairWorkflow: true,
  productName: true,
  sku: true,
  serialNumber: true,
  label: true,
  location: true,
  updatedAt: true,
  receipt: {
    select: {
      entityId: true,
      category: true,
      sourceCaseId: true,
      sourceNumber: true,
      trackingNumber: true,
      customerServiceUserId: true,
    },
  },
} satisfies Prisma.MailroomItemSelect;
type TodoRow = Prisma.MailroomItemGetPayload<{
  select: typeof candidateSelect;
}>;
export const REPAIR_TODO_SOURCE_CONCURRENCY = 5;
export const REPAIR_TODO_SOURCE_LAUNCH_MS = 16000;
export const REPAIR_TODO_SOURCE_TIMEOUT_MS = 8000;
const SCAN_SIZE = 200;
const PAGE_SIZE = 50;

@Injectable()
export class RepairTodoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
  ) {}

  private async freshSources(
    entityId: string,
    sourceIds: string[],
    deadline: number,
  ) {
    const sources = new Map<string, SourceCase | undefined>();
    let index = 0;
    const worker = async () => {
      while (index < sourceIds.length && Date.now() < deadline) {
        const id = sourceIds[index++];
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            this.sync.cases(entityId, '', id),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error('repair todo source read timed out')),
                REPAIR_TODO_SOURCE_TIMEOUT_MS,
              );
            }),
          ]);
          sources.set(
            id,
            result.items.length === 1 ? result.items[0] : undefined,
          );
        } catch {
          sources.set(id, undefined);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(REPAIR_TODO_SOURCE_CONCURRENCY, sourceIds.length) },
        worker,
      ),
    );
    return sources;
  }

  async list(userId: string, query: RepairTodoQuery) {
    const deadline = Date.now() + REPAIR_TODO_SOURCE_LAUNCH_MS;
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, query.entityId);
    requirePermission(actor, 'repair_workbench:read');
    const acceptance = await this.prisma.mailroomItem.count({
      where: {
        entityId: query.entityId,
        AND: repairConditions('acceptance', userId),
      },
    });
    const rows: TodoRow[] = [];
    const where: Prisma.MailroomItemWhereInput = {
      entityId: query.entityId,
      receipt: { entityId: query.entityId },
      repairOwnerId: userId,
      custodianId: userId,
      status: { in: [...REPAIR_TODO_STATUSES] },
      AND: [
        ...repairConditions('all', userId),
        { OR: [{ nextUserId: null }, { nextUserId: userId }] },
      ],
    };
    if (can(actor, 'repair_workbench:update')) {
      let cursor: string | undefined;
      for (;;) {
        const batch = await this.prisma.mailroomItem.findMany({
          where,
          select: candidateSelect,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: SCAN_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        rows.push(...batch);
        if (batch.length < SCAN_SIZE) break;
        cursor = batch[batch.length - 1].id;
      }
    }
    const sourceIds = [
      ...new Set(
        rows.flatMap((row) => {
          const decision = repairTodoDecision(actor, query.entityId, row);
          return decision.state === 'source' ? [decision.sourceId] : [];
        }),
      ),
    ];
    const sources = await this.freshSources(
      query.entityId,
      sourceIds,
      deadline,
    );
    // A source wait must not preserve a revoked account/company/read grant.
    const freshActor = await this.mailroom.actor(userId);
    requireEntity(freshActor, query.entityId);
    requirePermission(freshActor, 'repair_workbench:read');
    const currentRows = new Map<string, TodoRow>();
    if (sourceIds.length && can(freshActor, 'repair_workbench:update')) {
      // Re-read native versions/custody after the bounded upstream wait. New
      // candidates are seen on reload; removed or revised candidates cannot use
      // the old row to resurrect an already handed-off technician todo.
      for (let offset = 0; offset < rows.length; offset += SCAN_SIZE) {
        const batch = await this.prisma.mailroomItem.findMany({
          where: {
            ...where,
            id: {
              in: rows.slice(offset, offset + SCAN_SIZE).map((row) => row.id),
            },
          },
          select: candidateSelect,
        });
        for (const row of batch) currentRows.set(row.id, row);
      }
    } else {
      for (const row of rows) currentRows.set(row.id, row);
    }
    const ready: { row: TodoRow; kind: RepairTodoKind }[] = [];
    let unknownCount = 0;
    for (const previous of rows) {
      const row = currentRows.get(previous.id);
      if (!row) continue;
      const candidate = repairTodoDecision(freshActor, query.entityId, row);
      const decision =
        candidate.state === 'source'
          ? repairTodoSourceDecision(
              freshActor,
              query.entityId,
              row,
              sources.get(candidate.sourceId),
            )
          : candidate;
      if (decision.state === 'ready') ready.push({ row, kind: decision.kind });
      else if (decision.state === 'unknown') unknownCount++;
    }
    const search = query.search?.trim().toLocaleLowerCase();
    const filtered = search
      ? ready.filter(({ row }) =>
          [
            row.productName,
            row.sku,
            row.serialNumber,
            row.label,
            row.location,
            row.receipt.sourceNumber,
            row.receipt.trackingNumber,
          ].some((value) => value?.toLocaleLowerCase().includes(search)),
        )
      : ready;
    const page = query.page || 1;
    const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const items: (Awaited<ReturnType<MailroomService['views']>>[number] & {
      todoKind: RepairTodoKind;
    })[] = [];
    let changedCount = 0;
    if (query.summary !== 'true' && pageRows.length) {
      const hydrated = await this.prisma.mailroomItem.findMany({
        where: {
          ...where,
          OR: pageRows.map(({ row }) => ({ id: row.id, version: row.version })),
        },
        include: { receipt: true },
      });
      const native = new Map(hydrated.map((row) => [row.id, row]));
      const displayRows: typeof hydrated = [];
      const kinds = new Map<string, RepairTodoKind>();
      for (const { row, kind } of pageRows) {
        const full = native.get(row.id);
        const candidate = full
          ? repairTodoDecision(freshActor, query.entityId, full)
          : undefined;
        const decision =
          candidate?.state === 'source' && full
            ? repairTodoSourceDecision(
                freshActor,
                query.entityId,
                full,
                sources.get(candidate.sourceId),
              )
            : candidate;
        if (
          !full ||
          full.version !== row.version ||
          decision?.state !== 'ready' ||
          decision.kind !== kind
        ) {
          changedCount++;
          continue;
        }
        displayRows.push(full);
        kinds.set(full.id, kind);
      }
      const views = await this.mailroom.views(displayRows, userId, freshActor, {
        repairOverview: true,
      });
      for (const view of views) {
        const kind = kinds.get(view.id);
        if (kind) items.push({ ...view, todoKind: kind });
      }
    }
    unknownCount += changedCount;
    const countExact = unknownCount === 0;
    return {
      items,
      total: filtered.length - changedCount,
      page,
      queueCounts: {
        ...(countExact ? { todo: ready.length } : {}),
        acceptance,
      },
      countExact,
      unknownCount,
    };
  }
}
