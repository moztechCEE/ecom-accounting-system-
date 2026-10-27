import { assessmentReleaseForItem } from './repair-assessment-release';
import { Injectable, Optional } from '@nestjs/common';
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
  type RepairTodoDecision,
  type RepairTodoKind,
} from './repair-todo.contract';
import { type RepairTodoQuery } from './repair-todo.dto';
import { RepairPrerequisitesService } from './repair-prerequisites.service';

const candidateSelect = {
  id: true,
  entityId: true,
  receiptId: true,
  productId: true,
  declared: true,
  status: true,
  version: true,
  repairOwnerId: true,
  custodianId: true,
  nextUserId: true,
  repairInspection: true,
  repairReport: true,
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
const START_KINDS = new Set<RepairTodoKind>([
  'START_REPAIR',
  'START_REPLACEMENT',
  'SEND_FACTORY',
  'START_REFURBISHMENT',
]);
const ASSESSMENT_KINDS = new Set<RepairTodoKind>([
  ...START_KINDS,
  'REPAIR_WORK',
]);
type StartGate = 'READY' | 'BLOCKED' | 'UNKNOWN';

@Injectable()
export class RepairTodoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
    @Optional() private readonly prerequisites?: RepairPrerequisitesService,
  ) {}

  private async positiveGates(
    rows: TodoRow[],
    where: Prisma.MailroomItemWhereInput,
    deadline: number,
    sources: Map<string, SourceCase | undefined>,
    startIds: Set<string>,
  ) {
    const gates = new Map<string, StartGate>();
    const reader = this.prerequisites;
    if (!rows.length) return gates;
    let index = 0;
    const worker = async () => {
      while (index < rows.length && Date.now() < deadline) {
        const row = rows[index++];
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const current: StartGate = await Promise.race([
            (async (): Promise<StartGate> => {
              const assessment = await assessmentReleaseForItem(
                row,
                this.prisma,
                { source: sources.get(row.receipt.sourceCaseId || '') },
              );
              if (assessment.state !== 'READY') return assessment.state;
              if (!startIds.has(row.id)) return 'READY';
              if (!reader) return 'UNKNOWN';
              const current = await reader.forItem(row);
              const material = current?.materials?.start?.state;
              const inspection = current?.templateChecks?.inspection;
              return material === 'READY' && inspection === 'READY'
                ? 'READY'
                : material === 'BLOCKED' || inspection === 'BLOCKED'
                  ? 'BLOCKED'
                  : 'UNKNOWN';
            })(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () =>
                  reject(new Error('repair todo prerequisite read timed out')),
                Math.min(
                  REPAIR_TODO_SOURCE_TIMEOUT_MS,
                  Math.max(1, deadline - Date.now()),
                ),
              );
            }),
          ]);
          gates.set(row.id, current);
        } catch {
          gates.set(row.id, 'UNKNOWN');
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(REPAIR_TODO_SOURCE_CONCURRENCY, rows.length) },
        worker,
      ),
    );
    // A prerequisite wait must not resurrect a changed native version or custody.
    const positive = rows.filter((row) => gates.get(row.id) === 'READY');
    for (let offset = 0; offset < positive.length; offset += SCAN_SIZE) {
      const batch = positive.slice(offset, offset + SCAN_SIZE);
      try {
        const current = await this.prisma.mailroomItem.findMany({
          where: {
            ...where,
            OR: batch.map((row) => ({
              id: row.id,
              version: row.version,
              status: row.status,
              receipt: {
                category: row.receipt.category,
                sourceCaseId: row.receipt.sourceCaseId,
              },
            })),
          },
          select: { id: true, version: true },
        });
        const verified = new Set(current.map((row) => row.id));
        for (const row of batch)
          if (!verified.has(row.id)) gates.set(row.id, 'UNKNOWN');
      } catch {
        for (const row of batch) gates.set(row.id, 'UNKNOWN');
      }
    }
    return gates;
  }

  private withPositiveGate(
    row: TodoRow,
    decision: RepairTodoDecision,
    gates: Map<string, StartGate>,
  ): RepairTodoDecision {
    if (decision.state !== 'ready' || !ASSESSMENT_KINDS.has(decision.kind))
      return decision;
    const gate = gates.get(row.id);
    return gate === 'READY'
      ? decision
      : { state: gate === 'BLOCKED' ? 'blocked' : 'unknown' };
  }

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
    let freshActor = await this.mailroom.actor(userId);
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
    const decisionFor = (row: TodoRow) => {
      const candidate = repairTodoDecision(freshActor, query.entityId, row);
      return candidate.state === 'source'
        ? repairTodoSourceDecision(
            freshActor,
            query.entityId,
            row,
            sources.get(candidate.sourceId),
          )
        : candidate;
    };
    const positiveRows = [...currentRows.values()].filter((row) => {
      const decision = decisionFor(row);
      return decision.state === 'ready' && ASSESSMENT_KINDS.has(decision.kind);
    });
    const initialGates = await this.positiveGates(
      positiveRows,
      where,
      deadline,
      sources,
      new Set(
        positiveRows
          .filter((row) => {
            const d = decisionFor(row);
            return d.state === 'ready' && START_KINDS.has(d.kind);
          })
          .map((row) => row.id),
      ),
    );
    if (positiveRows.length) {
      freshActor = await this.mailroom.actor(userId);
      requireEntity(freshActor, query.entityId);
      requirePermission(freshActor, 'repair_workbench:read');
    }
    const ready: { row: TodoRow; kind: RepairTodoKind }[] = [];
    let unknownCount = 0;
    for (const previous of rows) {
      const row = currentRows.get(previous.id);
      if (!row) continue;
      const decision = this.withPositiveGate(
        row,
        decisionFor(row),
        initialGates,
      );
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
      const displayPositiveRows = hydrated.filter((row) => {
        const decision = decisionFor(row);
        return (
          decision.state === 'ready' && ASSESSMENT_KINDS.has(decision.kind)
        );
      });
      const displayGates = await this.positiveGates(
        displayPositiveRows,
        where,
        deadline,
        sources,
        new Set(
          displayPositiveRows
            .filter((row) => {
              const d = decisionFor(row);
              return d.state === 'ready' && START_KINDS.has(d.kind);
            })
            .map((row) => row.id),
        ),
      );
      if (displayPositiveRows.length) {
        freshActor = await this.mailroom.actor(userId);
        requireEntity(freshActor, query.entityId);
        requirePermission(freshActor, 'repair_workbench:read');
      }
      for (const { row, kind } of pageRows) {
        const full = native.get(row.id);
        const candidate = full
          ? repairTodoDecision(freshActor, query.entityId, full)
          : undefined;
        const rawDecision =
          candidate?.state === 'source' && full
            ? repairTodoSourceDecision(
                freshActor,
                query.entityId,
                full,
                sources.get(candidate.sourceId),
              )
            : candidate;
        const decision =
          full && rawDecision
            ? this.withPositiveGate(full, rawDecision, displayGates)
            : rawDecision;
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
