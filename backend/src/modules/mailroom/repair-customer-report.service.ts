import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import {
  fingerprint,
  requireEntity,
  requirePermission,
  type SourceCase,
} from './mailroom.contract';
import {
  currentCsrReview,
  repairWorkflow,
  requireSourceConsent,
} from './repair-workflow.contract';
import { repairSourceBindingForItem } from './repair-proposal.contract';
import {
  validateDocumentV2,
  validateInspectionSubmission,
  inspectionPlanHash,
  type RepairDocument,
  type RepairData,
} from './repair-document.contract';
import {
  type RepairEvidenceCommand,
  type RepairReportPublishDto,
} from './repair-evidence.dto';
import {
  evidenceDatabase,
  type CustomerReport,
} from './repair-evidence.persistence';
import { RepairMediaService } from './repair-media.service';
import { repairSourceCaseBrand } from './repair-source-brand.contract';

type Item = Prisma.MailroomItemGetPayload<{ include: { receipt: true } }>;
type Identity = {
  companyId: string;
  caseId: string;
  brand: string;
  verifiedCustomerId: string;
  verified: boolean;
};
type PublicContent = {
  productName: string;
  caseNumber: string;
  findings: string;
  handling: string;
  verification: string;
};
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function reportToken(
  report: Pick<CustomerReport, 'id' | 'entityId' | 'itemId' | 'publishedAt'>,
) {
  const key = process.env.REPAIR_REPORT_LINK_SECRET;
  if (!key || key.length < 32)
    throw new ConflictException('報告連結服務尚未設定');
  return createHmac('sha256', key)
    .update(
      fingerprint({
        id: report.id,
        entityId: report.entityId,
        itemId: report.itemId,
        publishedAt: report.publishedAt.toISOString(),
      }),
    )
    .digest('base64url');
}
const itemIdentityHash = (item: Item) =>
  fingerprint({
    entityId: item.entityId,
    itemId: item.id,
    productId: item.productId,
    sku: item.sku,
    serialNumber: item.serialNumber,
    label: item.label,
    productName: item.productName,
    declared: item.declared,
    sourceCaseId: item.receipt.sourceCaseId,
    sourceNumber: item.receipt.sourceNumber,
  });
function currentIdentity(source: SourceCase): Identity {
  const identity = (
    source.releaseInfo as SourceCase['releaseInfo'] & {
      customerIdentity?: Identity;
    }
  )?.customerIdentity;
  if (
    !identity ||
    identity.verified !== true ||
    identity.caseId !== source.id ||
    identity.brand !== repairSourceCaseBrand(source) ||
    typeof identity.companyId !== 'string' ||
    !identity.companyId.trim() ||
    typeof identity.verifiedCustomerId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(identity.verifiedCustomerId)
  )
    throw new ConflictException('顧客身分尚未確認');
  return identity;
}
@Injectable()
export class RepairCustomerReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
    private readonly media: RepairMediaService,
  ) {}
  private async source(item: Item) {
    if (item.receipt.category !== 'REPAIR' || !item.receipt.sourceCaseId)
      throw new ConflictException('此案件沒有顧客報告來源');
    const rows = (
      await this.sync.cases(item.entityId, '', item.receipt.sourceCaseId)
    ).items;
    if (
      rows.length !== 1 ||
      rows[0].id !== item.receipt.sourceCaseId ||
      rows[0].number !== item.receipt.sourceNumber ||
      rows[0].type !== 'REPAIR'
    )
      throw new ConflictException('目前無法確認顧客案件');
    return rows[0];
  }
  private async actor(
    userId: string,
    entityId: string,
    tx?: Prisma.TransactionClient,
  ) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId, tx);
    requireEntity(actor, entityId);
    requirePermission(actor, 'mailroom:review');
    const db = tx || this.prisma;
    if (
      !(await db.employee.findFirst({
        where: { userId, entityId, isActive: true },
        select: { id: true },
      }))
    )
      throw new ConflictException('請由此公司的在職客服覆核');
    return actor;
  }
  async publish(userId: string, itemId: string, input: RepairReportPublishDto) {
    if (
      !['inspection', 'repair'].includes(input.kind) ||
      !Number.isInteger(input.expiresInDays) ||
      input.expiresInDays < 1 ||
      input.expiresInDays > 30
    )
      throw new BadRequestException('報告發布格式不符');
    await this.actor(userId, input.entityId);
    const origin = process.env.REPAIR_REPORT_PUBLIC_ORIGIN;
    try {
      if (
        !origin ||
        new URL(origin).origin !== origin ||
        !origin.startsWith('https://')
      )
        throw new Error();
    } catch {
      throw new ConflictException('報告網址尚未設定');
    }
    reportToken({
      id: 'configuration-check',
      entityId: input.entityId,
      itemId,
      publishedAt: new Date(0),
    });
    const hash = fingerprint({ action: 'REPORT_PUBLISH', itemId, ...input });
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':repair-evidence:' + userId + ':' + input.requestId}))`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM mailroom_items WHERE id=${itemId} FOR UPDATE`,
        );
        const db = evidenceDatabase(tx);
        await this.actor(userId, input.entityId, tx);
        const item = await tx.mailroomItem.findUnique({
          where: { id: itemId },
          include: { receipt: true },
        });
        if (!item || item.entityId !== input.entityId)
          throw new NotFoundException('找不到檢修案件');
        const old = await db.repairEvidenceOperation.findFirst({
          where: {
            entityId: input.entityId,
            actorId: userId,
            requestId: input.requestId,
          },
        });
        if (old) {
          if (old.action !== 'REPORT_PUBLISH' || old.requestHash !== hash)
            throw new ConflictException('同一操作識別碼的內容不同');
          // Token rotation/replay never issues a new capability implicitly.
          return { ...(old.result as { reportId: string }), duplicate: true };
        }
        if (item.version !== input.expectedVersion)
          throw new ConflictException('案件已更新，請重新載入');
        const inspection = validateInspectionSubmission(
            item.repairInspection,
            true,
          ),
          workflow = repairWorkflow(item.repairWorkflow);
        if (
          workflow.csr?.ownerId !== userId ||
          !['ACCEPTED', 'RESOLVED'].includes(workflow.csr.status) ||
          workflow.csr.inspectionRevision !== inspection.revision ||
          workflow.csr.estimateRevision !== inspection.revision ||
          workflow.csr.planHash !== inspectionPlanHash(inspection)
        )
          throw new ConflictException('請由本案已接手客服覆核目前報告');
        if (input.kind === 'repair') {
          currentCsrReview(item);
          if (workflow.csr.decision !== 'APPROVE')
            throw new ConflictException('目前維修方案尚未同意');
        }
        const source = await this.source(item);
        if (['CANCELLED', 'CLOSED', 'COMPLETED'].includes(source.status))
          throw new ConflictException('案件已結束，不能發布新報告');
        const identity = currentIdentity(source),
          binding = repairSourceBindingForItem(item, source);
        const quoteRevision = source.releaseInfo?.quoteRevision;
        const quoteBindings = (
          source.releaseInfo as SourceCase['releaseInfo'] & {
            quoteBindings?: {
              itemId: string;
              planVersion: number;
              planHash: string;
              proposalHash: string;
              quoteRevision: number;
            }[];
          }
        )?.quoteBindings;
        const currentBindings = Array.isArray(quoteBindings)
          ? quoteBindings.filter((row) => row?.itemId === item.id)
          : [];
        if (
          !Number.isInteger(quoteRevision) ||
          Number(quoteRevision) < 1 ||
          currentBindings.length !== 1 ||
          currentBindings[0].quoteRevision !== quoteRevision ||
          currentBindings[0].planVersion !== binding.planVersion ||
          currentBindings[0].planHash !== binding.planHash ||
          currentBindings[0].proposalHash !== binding.proposalHash
        )
          throw new ConflictException('報告與目前檢修報價版本不符');
        if (input.kind === 'repair')
          requireSourceConsent(
            source,
            workflow.csr.quoteRevision,
            true,
            binding,
          );
        const document = (
          input.kind === 'inspection'
            ? item.repairInspection
            : item.repairReport
        ) as RepairDocument | null;
        if (
          document?.status !== 'SUBMITTED' ||
          (input.kind === 'repair' &&
            document.inspectionRevision !== inspection.revision)
        )
          throw new ConflictException('請先提交目前工作單');
        validateDocumentV2(document.data, input.kind);
        if (input.kind === 'repair') {
          const data = document.data as RepairData;
          const expected =
            data.outcome === 'REPLACED'
              ? 'REPLACED'
              : data.outcome === 'FACTORY_REPAIRED'
                ? 'FACTORY_REPAIRED'
                : 'REPAIRED';
          if (
            data.qcResult !== 'PASS' ||
            data.checks.some((check) => check.result !== 'PASS') ||
            workflow.release?.purpose !== expected ||
            workflow.release.inspectionRevision !== inspection.revision ||
            !document.submittedAt ||
            Date.parse(workflow.release.releasedAt) <
              Date.parse(document.submittedAt)
          )
            throw new ConflictException('目前維修與複驗尚未完成');
          if (expected === 'REPLACED' && !workflow.release.stock?.postingId)
            throw new ConflictException('換機尚未完成正式出庫');
        }
        const draft = document.data.customerReportDraft;
        if (
          !draft ||
          ![draft.findings, draft.handling, draft.verification].every(
            (text) => typeof text === 'string' && !!text.trim(),
          )
        )
          throw new BadRequestException('請完成顧客版報告');
        for (const mediaId of draft.mediaIds) {
          const asset = await db.repairMediaAsset.findFirst({
            where: {
              id: mediaId,
              entityId: input.entityId,
              itemId,
              status: 'FINALIZED',
            },
          });
          const attached =
            Array.isArray(asset?.bindings) &&
            asset.bindings.some(
              (value: { kind?: string; documentRevision?: number }) =>
                value?.kind === input.kind &&
                value.documentRevision === document.revision,
            );
          if (!asset || !attached)
            throw new ConflictException('報告影像尚未附到目前工作單');
        }
        const content: PublicContent = {
          productName: item.productName,
          caseNumber: item.receipt.sourceNumber || item.label,
          findings: draft.findings.trim(),
          handling: draft.handling.trim(),
          verification: draft.verification.trim(),
        };
        const id = randomUUID();
        const publishedAt = new Date();
        const token = reportToken({
          id,
          entityId: input.entityId,
          itemId,
          publishedAt,
        });
        // Supersession is atomic; old links cannot keep displaying an earlier publication.
        await db.repairCustomerReport.updateMany({
          where: { entityId: input.entityId, itemId, status: 'PUBLISHED' },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedById: userId,
          },
        });
        await db.repairCustomerReport.create({
          data: {
            id,
            entityId: input.entityId,
            itemId,
            sourceCaseId: source.id,
            sourceBrand: repairSourceCaseBrand(source),
            verifiedCustomerId: identity.verifiedCustomerId,
            inspectionRevision: inspection.revision,
            reportRevision: input.kind === 'repair' ? document.revision : null,
            planHash: binding.planHash,
            proposalHash: binding.proposalHash,
            itemIdentityHash: itemIdentityHash(item),
            currency: source.releaseInfo!.currency,
            quoteRevision,
            content,
            contentHash: fingerprint(content),
            mediaIds: draft.mediaIds,
            status: 'PUBLISHED',
            tokenHash: digest(token),
            expiresAt: new Date(Date.now() + input.expiresInDays * 86400000),
            publishedById: userId,
            publishedAt,
          },
        });
        await db.repairEvidenceOperation.create({
          data: {
            entityId: input.entityId,
            actorId: userId,
            requestId: input.requestId,
            action: 'REPORT_PUBLISH',
            requestHash: hash,
            result: { reportId: id },
          },
        });
        return { reportId: id, duplicate: false };
      },
      { timeout: 15000 },
    );
    const report = await evidenceDatabase(
      this.prisma,
    ).repairCustomerReport.findFirst({
      where: {
        id: result.reportId,
        entityId: input.entityId,
        itemId,
        status: 'PUBLISHED',
      },
    });
    if (!report || report.expiresAt <= new Date())
      throw new ConflictException('報告已撤回或逾期');
    const token = reportToken(report);
    if (digest(token) !== report.tokenHash)
      throw new ConflictException('報告連結已更新，請重新發布');
    return {
      ...result,
      shareLink: `${origin}/repair-report/${result.reportId}#token=${token}`,
    };
  }
  async list(userId: string, entityId: string, itemId: string) {
    await this.actor(userId, entityId);
    await this.mailroom.detail(userId, entityId, itemId);
    const rows = await evidenceDatabase(
      this.prisma,
    ).repairCustomerReport.findMany({
      where: { entityId, itemId },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
    return {
      items: rows.map((row) => ({
        reportId: row.id,
        status: row.status,
        publishedAt: row.publishedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        inspectionRevision: row.inspectionRevision,
        reportRevision: row.reportRevision,
      })),
    };
  }
  async revoke(
    userId: string,
    itemId: string,
    reportId: string,
    input: RepairEvidenceCommand,
  ) {
    await this.actor(userId, input.entityId);
    const hash = fingerprint({
      action: 'REPORT_REVOKE',
      itemId,
      reportId,
      ...input,
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':repair-evidence:' + userId + ':' + input.requestId}))`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_items WHERE id=${itemId} FOR UPDATE`,
      );
      await this.actor(userId, input.entityId, tx);
      const db = evidenceDatabase(tx);
      const old = await db.repairEvidenceOperation.findFirst({
        where: {
          entityId: input.entityId,
          actorId: userId,
          requestId: input.requestId,
        },
      });
      if (old) {
        if (old.requestHash !== hash || old.action !== 'REPORT_REVOKE')
          throw new ConflictException('同一操作識別碼的內容不同');
        return { reportId, duplicate: true };
      }
      const item = await tx.mailroomItem.findUnique({
        where: { id: itemId },
        include: { receipt: true },
      });
      if (!item || item.entityId !== input.entityId)
        throw new NotFoundException('找不到檢修案件');
      if (item.version !== input.expectedVersion)
        throw new ConflictException('案件已更新，請重新載入');
      const report = await db.repairCustomerReport.findFirst({
        where: { id: reportId, entityId: input.entityId, itemId },
      });
      if (!report) throw new NotFoundException('找不到顧客報告');
      await db.repairCustomerReport.update({
        where: { id: reportId },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: userId },
      });
      await db.repairEvidenceOperation.create({
        data: {
          entityId: input.entityId,
          actorId: userId,
          requestId: input.requestId,
          action: 'REPORT_REVOKE',
          requestHash: hash,
          result: { reportId },
        },
      });
      return { reportId, duplicate: false };
    });
  }
  private async access(reportId: string, token: string | undefined) {
    if (
      process.env.REPAIR_PUBLIC_REPORT_ENABLED !== 'true' ||
      !token ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    )
      throw new NotFoundException('報告已撤回或無法讀取');
    const db = evidenceDatabase(this.prisma),
      report = await db.repairCustomerReport.findFirst({
        where: { id: reportId, status: 'PUBLISHED' },
      });
    if (
      !report ||
      report.expiresAt <= new Date() ||
      !/^[a-f0-9]{64}$/.test(report.tokenHash) ||
      !timingSafeEqual(
        Buffer.from(report.tokenHash, 'hex'),
        Buffer.from(digest(token), 'hex'),
      )
    )
      throw new NotFoundException('報告已撤回或無法讀取');
    if (digest(reportToken(report)) !== report.tokenHash)
      throw new NotFoundException('報告連結已更新');
    const item = await this.prisma.mailroomItem.findUnique({
      where: { id: report.itemId },
      include: { receipt: true },
    });
    if (
      !item ||
      item.entityId !== report.entityId ||
      item.receipt.sourceCaseId !== report.sourceCaseId ||
      itemIdentityHash(item) !== report.itemIdentityHash
    )
      throw new NotFoundException('報告已更新或無法讀取');
    const inspection = item.repairInspection as RepairDocument | null,
      repair = item.repairReport as RepairDocument | null;
    if (
      !inspection ||
      inspection.revision !== report.inspectionRevision ||
      fingerprint({ revision: inspection.revision, data: inspection.data }) !==
        report.planHash ||
      (report.reportRevision !== null &&
        repair?.revision !== report.reportRevision) ||
      fingerprint(report.content) !== report.contentHash
    )
      throw new NotFoundException('報告已更新或無法讀取');
    const source = await this.source(item);
    if (source.status === 'CANCELLED')
      throw new NotFoundException('報告已撤回或無法讀取');
    const identity = currentIdentity(source);
    if (
      repairSourceCaseBrand(source) !== report.sourceBrand ||
      identity.verifiedCustomerId !== report.verifiedCustomerId ||
      source.releaseInfo?.quoteRevision !== report.quoteRevision ||
      source.releaseInfo.currency !== report.currency
    )
      throw new NotFoundException('報告已更新或無法讀取');
    const release = source.releaseInfo as SourceCase['releaseInfo'] & {
      quoteBindings?: {
        itemId: string;
        planVersion: number;
        planHash: string;
        proposalHash: string;
        quoteRevision: number;
      }[];
    };
    const matching = release?.quoteBindings?.filter(
      (binding) => binding?.itemId === item.id,
    );
    if (
      !matching ||
      matching.length !== 1 ||
      matching[0].planVersion !== report.inspectionRevision ||
      matching[0].planHash !== report.planHash ||
      matching[0].proposalHash !== report.proposalHash ||
      matching[0].quoteRevision !== report.quoteRevision
    )
      throw new NotFoundException('報告已更新或無法讀取');
    for (const id of report.mediaIds)
      if (
        !(await db.repairMediaAsset.findFirst({
          where: {
            id,
            entityId: report.entityId,
            itemId: report.itemId,
            status: 'FINALIZED',
          },
        }))
      )
        throw new NotFoundException('報告影像已撤回');
    return report;
  }
  async publicView(reportId: string, token: string | undefined) {
    const report = await this.access(reportId, token),
      db = evidenceDatabase(this.prisma);
    const media = [];
    for (const mediaId of report.mediaIds) {
      const row = await db.repairMediaAsset.findFirst({
        where: {
          id: mediaId,
          entityId: report.entityId,
          itemId: report.itemId,
          status: 'FINALIZED',
        },
      });
      if (row) media.push({ mediaId, contentType: row.contentType });
    }
    const content = report.content as PublicContent;
    return {
      reportId: report.id,
      productName: content.productName,
      caseNumber: content.caseNumber,
      findings: content.findings,
      handling: content.handling,
      verification: content.verification,
      media,
    };
  }
  async publicMedia(
    reportId: string,
    mediaId: string,
    token: string | undefined,
  ) {
    const report = await this.access(reportId, token);
    if (!report.mediaIds.includes(mediaId))
      throw new NotFoundException('此影像不屬於報告');
    return this.media.scopedFile(report.entityId, report.itemId, mediaId);
  }
}
