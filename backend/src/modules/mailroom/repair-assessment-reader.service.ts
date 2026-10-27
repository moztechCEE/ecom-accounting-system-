import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  inspectionPlanHash,
  validateInspectionSubmission,
} from './repair-document.contract';
import { validateInspectionAssessmentShape } from './repair-assessment.contract';
import {
  localAssessmentReleaseForItem,
  verifiedAssessmentReviewActionRef,
  verifiedDeliveredRepairProposal,
} from './repair-assessment-release';
import { repairWorkflow } from './repair-workflow.contract';
import {
  ASSESSMENT_READER_BUDGET_MS,
  ASSESSMENT_READER_MAX_ITEMS,
  ASSESSMENT_READER_SCHEMA,
  readerUnavailable,
  validReaderIdentifier,
  validateAssessmentAuthorityResponse,
  type AssessmentAuthority,
  type AssessmentAuthorityItem,
  type AssessmentAuthorityResponse,
  type AssessmentInspectionRef,
} from './repair-assessment-reader.contract';

export const ASSESSMENT_READER_CLOCK = Symbol('ASSESSMENT_READER_CLOCK');
export type AssessmentReaderClock = {
  wallNow(): number;
  monotonicNow(): number;
};
const selectItem = {
  id: true,
  entityId: true,
  receiptId: true,
  version: true,
  status: true,
  label: true,
  productName: true,
  productId: true,
  sku: true,
  serialNumber: true,
  declared: true,
  repairOwnerId: true,
  custodianId: true,
  repairInspection: true,
  repairWorkflow: true,
  receipt: {
    select: {
      entityId: true,
      category: true,
      sourceCaseId: true,
      sourceNumber: true,
    },
  },
} satisfies Prisma.MailroomItemSelect;
type Item = Prisma.MailroomItemGetPayload<{ select: typeof selectItem }>;
const actionSelect = {
  id: true,
  entityId: true,
  itemId: true,
  actorId: true,
  actorName: true,
  requestId: true,
  requestHash: true,
  action: true,
  fromStatus: true,
  toStatus: true,
  version: true,
  snapshot: true,
} satisfies Prisma.MailroomActionSelect;
type Action = Prisma.MailroomActionGetPayload<{ select: typeof actionSelect }>;
const deliverySelect = {
  id: true,
  eventId: true,
  entityId: true,
  itemId: true,
  target: true,
  payload: true,
  status: true,
  deliveredAt: true,
  createdAt: true,
} satisfies Prisma.MailroomDeliverySelect;
type Delivery = Prisma.MailroomDeliveryGetPayload<{
  select: typeof deliverySelect;
}>;
type LocalDb = Parameters<typeof localAssessmentReleaseForItem>[1];
const MAX_ACTIONS = ASSESSMENT_READER_MAX_ITEMS * 3;
const MAX_DELIVERIES = ASSESSMENT_READER_MAX_ITEMS * 2;
const TX_ACQUIRE_MS = 250;
const TX_BODY_MS = ASSESSMENT_READER_BUDGET_MS - TX_ACQUIRE_MS;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v: unknown, max = 128): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= max;

function inspectionRef(item: Item): AssessmentInspectionRef | null {
  try {
    const doc = validateInspectionSubmission(item.repairInspection);
    if (
      !nonempty(doc.number, 200) ||
      !Number.isInteger(doc.revision) ||
      doc.revision < 1 ||
      doc.revision > 2147483646
    )
      return null;
    return {
      documentId: doc.number,
      inspectionRevision: doc.revision,
      planVersion: doc.revision,
      planHash: inspectionPlanHash(doc),
    };
  } catch {
    return null;
  }
}
function snapshotActionMatch(action: Action, query: unknown) {
  if (!object(query) || !object(query.where)) return false;
  const where = query.where;
  if (
    action.entityId !== where.entityId ||
    action.itemId !== where.itemId ||
    action.action !== where.action
  )
    return false;
  if (where.actorId !== undefined && action.actorId !== where.actorId)
    return false;
  if (!object(where.snapshot) || !Array.isArray(where.snapshot.path))
    return false;
  let value: unknown = action.snapshot;
  for (const key of where.snapshot.path) {
    if (!object(value) || typeof key !== 'string') return false;
    value = value[key];
  }
  return value === where.snapshot.equals;
}
/** These delegates only inspect the already bounded, same-snapshot DB reads. */
function cachedAuthorityDb(
  actions: Action[],
  deliveries: Delivery[],
  active: () => void,
): LocalDb {
  return {
    mailroomAction: {
      findMany: (query: unknown) => {
        active();
        return Promise.resolve(
          actions
            .filter((action) => snapshotActionMatch(action, query))
            .slice(0, 2),
        );
      },
      findFirst: (query: unknown) => {
        active();
        return Promise.resolve(
          actions.find((action) => snapshotActionMatch(action, query)) || null,
        );
      },
    },
    mailroomDelivery: {
      findFirst: (query: unknown) => {
        active();
        if (!object(query) || !object(query.where))
          return Promise.resolve(null);
        const where = query.where;
        return Promise.resolve(
          deliveries.find((receipt) => {
            if (
              receipt.entityId !== where.entityId ||
              receipt.itemId !== where.itemId ||
              receipt.target !== where.target ||
              receipt.status !== where.status
            )
              return false;
            if (!Array.isArray(where.AND)) return false;
            return where.AND.every((condition) => {
              if (
                !object(condition) ||
                !object(condition.payload) ||
                !Array.isArray(condition.payload.path)
              )
                return false;
              let value: unknown = receipt.payload;
              for (const key of condition.payload.path) {
                if (!object(value) || typeof key !== 'string') return false;
                value = value[key];
              }
              return value === condition.payload.equals;
            });
          }) || null,
        );
      },
    },
  } as unknown as LocalDb;
}

@Injectable()
export class RepairAssessmentReaderService {
  private readonly clock: AssessmentReaderClock;
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(ASSESSMENT_READER_CLOCK) clock?: AssessmentReaderClock,
  ) {
    this.clock = clock || {
      wallNow: () => Date.now(),
      monotonicNow: () => performance.now(),
    };
  }
  async read(
    entityId: string,
    sourceCaseId: string,
  ): Promise<AssessmentAuthorityResponse> {
    if (!nonempty(entityId) || !validReaderIdentifier(sourceCaseId))
      readerUnavailable();
    const started = this.clock.monotonicNow(),
      deadline = started + ASSESSMENT_READER_BUDGET_MS;
    if (!Number.isFinite(started)) readerUnavailable();
    const abort = new AbortController();
    const active = () => {
      if (
        abort.signal.aborted ||
        !Number.isFinite(this.clock.monotonicNow()) ||
        this.clock.monotonicNow() >= deadline
      )
        readerUnavailable();
    };
    let rejectDeadline: (reason: unknown) => void = () => {};
    const exceeded = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => {
      abort.abort();
      rejectDeadline(new Error('local authority deadline'));
    }, ASSESSMENT_READER_BUDGET_MS);
    try {
      const work = this.prisma.$transaction(
        async (tx) => {
          active();
          await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
          active();
          const observedAt = new Date(this.clock.wallNow()).toISOString();
          const read = async <T>(operation: () => Promise<T>): Promise<T> => {
            active();
            const remaining = Math.max(
              1,
              Math.floor(
                Math.min(TX_BODY_MS, deadline - this.clock.monotonicNow()),
              ),
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT set_config('statement_timeout', ${String(remaining)}, true)`,
            );
            active();
            const value = await operation();
            active();
            return value;
          };
          const items = await read(() =>
            tx.mailroomItem.findMany({
              where: {
                entityId,
                receipt: { entityId, category: 'REPAIR', sourceCaseId },
              },
              select: selectItem,
              orderBy: { id: 'asc' },
              take: ASSESSMENT_READER_MAX_ITEMS + 1,
            }),
          );
          if (
            !items.length ||
            items.length > ASSESSMENT_READER_MAX_ITEMS ||
            new Set(items.map((item) => item.id)).size !== items.length
          )
            readerUnavailable();
          const sourceNumber = items[0].receipt.sourceNumber;
          if (
            !nonempty(sourceNumber) ||
            items.some(
              (item) =>
                item.entityId !== entityId ||
                item.receipt.entityId !== entityId ||
                item.receipt.category !== 'REPAIR' ||
                item.receipt.sourceCaseId !== sourceCaseId ||
                item.receipt.sourceNumber !== sourceNumber,
            )
          )
            readerUnavailable();
          const references = new Map(
            items.map((item) => [item.id, inspectionRef(item)]),
          );
          const actionConditions: Prisma.MailroomActionWhereInput[] = [];
          const deliveryConditions: Prisma.MailroomDeliveryWhereInput[] = [];
          for (const item of items) {
            const ref = references.get(item.id);
            if (ref) {
              actionConditions.push({
                itemId: item.id,
                action: 'submit_repair_inspection',
                snapshot: {
                  path: ['repairInspection', 'revision'],
                  equals: ref.inspectionRevision,
                },
              });
              deliveryConditions.push({
                itemId: item.id,
                payload: {
                  path: ['proposal', 'planHash'],
                  equals: ref.planHash,
                },
              });
            }
            const proof = repairWorkflow(item.repairWorkflow).assessmentReview;
            if (
              proof &&
              nonempty(proof.reviewerId) &&
              nonempty(proof.reviewedAt, 64)
            )
              actionConditions.push({
                itemId: item.id,
                action: 'review_assessment',
                actorId: proof.reviewerId,
                snapshot: {
                  path: ['repairWorkflow', 'assessmentReview', 'reviewedAt'],
                  equals: proof.reviewedAt,
                },
              });
          }
          const actions = actionConditions.length
            ? await read(() =>
                tx.mailroomAction.findMany({
                  where: {
                    entityId,
                    itemId: { in: items.map((item) => item.id) },
                    OR: actionConditions,
                  },
                  select: actionSelect,
                  orderBy: { version: 'desc' },
                  take: MAX_ACTIONS + 1,
                }),
              )
            : [];
          const deliveries = deliveryConditions.length
            ? await read(() =>
                tx.mailroomDelivery.findMany({
                  where: {
                    entityId,
                    itemId: { in: items.map((item) => item.id) },
                    target: 'AFTER_SALES',
                    status: 'DELIVERED',
                    AND: [
                      {
                        payload: { path: ['kind'], equals: 'REPAIR_PROPOSAL' },
                      },
                      { OR: deliveryConditions },
                    ],
                  },
                  select: deliverySelect,
                  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  take: MAX_DELIVERIES + 1,
                }),
              )
            : [];
          if (
            actions.length > MAX_ACTIONS ||
            deliveries.length > MAX_DELIVERIES
          )
            readerUnavailable();
          const cache = cachedAuthorityDb(actions, deliveries, active),
            output: AssessmentAuthorityItem[] = [];
          for (const item of items) {
            active();
            const ref = references.get(item.id) || null;
            const local = await localAssessmentReleaseForItem(item, cache);
            const delivered = await verifiedDeliveredRepairProposal(
              item,
              cache,
            );
            let authority: AssessmentAuthority = {
              state: local.state === 'BLOCKED' ? 'BLOCKED' : 'UNKNOWN',
              policy: null,
              conclusion: null,
              review: null,
            };
            if (ref && delivered && local.state === 'READY') {
              if (local.reason === 'PROVEN_LEGACY_SUBMISSION')
                authority = {
                  state: 'READY',
                  policy: 'PROVEN_LEGACY_SUBMISSION',
                  conclusion: null,
                  review: null,
                };
              else {
                const doc = validateInspectionSubmission(item.repairInspection),
                  assessment = validateInspectionAssessmentShape(
                    doc.data.assessment,
                  );
                if (assessment.conclusion === 'USER_CAUSED') {
                  const review = await verifiedAssessmentReviewActionRef(
                    item,
                    cache,
                  );
                  if (review)
                    authority = {
                      state: 'READY',
                      policy: 'FAIR_V1',
                      conclusion: 'USER_CAUSED',
                      review,
                    };
                } else
                  authority = {
                    state: 'READY',
                    policy: 'FAIR_V1',
                    conclusion: assessment.conclusion,
                    review: null,
                  };
              }
            }
            if (!delivered)
              authority = {
                state: 'UNKNOWN',
                policy: null,
                conclusion: null,
                review: null,
              };
            output.push({
              itemId: item.id,
              receiptId: item.receiptId,
              nativeVersion: item.version,
              inspectionRef: ref,
              proposalBinding: delivered
                ? {
                    eventId: delivered.eventId,
                    receiptId: delivered.receiptId,
                    itemId: delivered.binding.itemId,
                    sourceVersion: delivered.sourceVersion,
                    planVersion: delivered.binding.planVersion,
                    planHash: delivered.binding.planHash,
                    proposalHash: delivered.binding.proposalHash,
                  }
                : null,
              authority,
            });
          }
          active();
          const response = validateAssessmentAuthorityResponse({
            schema: ASSESSMENT_READER_SCHEMA,
            entityId,
            sourceCaseId,
            sourceNumber,
            observedAt,
            complete: true,
            itemCount: output.length,
            items: output,
          });
          active();
          return response;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: TX_ACQUIRE_MS,
          timeout: TX_BODY_MS,
        },
      );
      return await Promise.race([work, exceeded]);
    } catch {
      readerUnavailable();
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }
}
