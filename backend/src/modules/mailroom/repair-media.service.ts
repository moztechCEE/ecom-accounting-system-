import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailroomService } from './mailroom.service';
import {
  fingerprint,
  requireEntity,
  requirePermission,
  type Actor,
} from './mailroom.contract';
import { requireTechnicianCustody } from './repair-workflow.contract';
import {
  type RepairDocument,
  type RepairDocumentMediaRef,
  type FinalizedRepairMedia,
} from './repair-document.contract';
import {
  type RepairEvidenceCommand,
  type RepairMediaUploadDto,
} from './repair-evidence.dto';
import {
  evidenceDatabase,
  type EvidenceDatabase,
  type MediaAsset,
} from './repair-evidence.persistence';
import {
  RepairMediaStorageService,
  REPAIR_MEDIA_TYPES,
} from './repair-media-storage.service';

type Item = Prisma.MailroomItemGetPayload<{ include: { receipt: true } }>;
type Binding = {
  kind: 'inspection' | 'repair';
  documentRevision: number;
  phase: RepairDocumentMediaRef['phase'];
  checkKey?: string;
};
const kindDocument = (item: Item, kind: 'inspection' | 'repair') =>
  (kind === 'inspection'
    ? item.repairInspection
    : item.repairReport) as RepairDocument | null;
const bindings = (asset: MediaAsset): Binding[] =>
  Array.isArray(asset.bindings) ? (asset.bindings as Binding[]) : [];
export const mediaDescriptor = (asset: MediaAsset, binding?: Binding) => ({
  mediaId: asset.id,
  fileName: asset.contentType.startsWith('image/') ? '檢測照片' : '檢測影片',
  kind: binding?.kind || asset.kind,
  documentRevision: binding?.documentRevision || asset.documentRevision,
  phase: binding?.phase || asset.phase,
  ...(binding?.checkKey || asset.checkKey
    ? { checkKey: binding?.checkKey || asset.checkKey! }
    : {}),
  status: asset.status,
  sha256: asset.sha256,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes === null ? null : Number(asset.sizeBytes),
});
@Injectable()
export class RepairMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly storage: RepairMediaStorageService,
  ) {}
  private async actor(
    userId: string,
    entityId: string,
    write: boolean,
    tx?: Prisma.TransactionClient,
  ) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId, tx);
    requireEntity(actor, entityId);
    requirePermission(actor, 'repair_workbench:' + (write ? 'update' : 'read'));
    return actor;
  }
  private async item(
    db: Prisma.TransactionClient,
    entityId: string,
    id: string,
  ) {
    const row = await db.mailroomItem.findUnique({
      where: { id },
      include: { receipt: true },
    });
    if (
      !row ||
      row.entityId !== entityId ||
      !['REPAIR', 'RETURN'].includes(row.receipt.category)
    )
      throw new NotFoundException('找不到檢修物件');
    return row;
  }
  private async command<T extends { mediaId: string }>(
    userId: string,
    id: string,
    body: RepairEvidenceCommand,
    action: string,
    extra: unknown,
    work: (db: EvidenceDatabase, row: Item, actor: Actor) => Promise<T>,
  ) {
    await this.actor(userId, body.entityId, true);
    const hash = fingerprint({ action, id, ...body, extra });
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${body.entityId + ':repair-evidence:' + userId + ':' + body.requestId}))`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM mailroom_items WHERE id=${id} FOR UPDATE`,
        );
        const db = evidenceDatabase(tx),
          actor = await this.actor(userId, body.entityId, true, tx),
          row = await this.item(tx, body.entityId, id);
        requireTechnicianCustody(actor, row);
        if (
          ![
            'REPAIR_RECEIVED',
            'INSPECTING',
            'REPAIRING',
            'REFURBISHING',
          ].includes(row.status)
        )
          throw new ConflictException('此階段不能修改檢修影像');
        const previous = await db.repairEvidenceOperation.findFirst({
          where: {
            entityId: body.entityId,
            actorId: userId,
            requestId: body.requestId,
          },
        });
        if (previous) {
          if (previous.requestHash !== hash || previous.action !== action)
            throw new ConflictException('同一操作識別碼的內容不同');
          const result = previous.result as T;
          if (!result || typeof result.mediaId !== 'string')
            throw new ConflictException('影像操作回執不完整');
          return result;
        }
        if (row.version !== body.expectedVersion)
          throw new ConflictException('案件已更新，請重新載入');
        const result = await work(db, row, actor);
        await db.repairEvidenceOperation.create({
          data: {
            entityId: body.entityId,
            actorId: userId,
            requestId: body.requestId,
            action,
            requestHash: hash,
            result,
          },
        });
        return result;
      },
      { timeout: 15000 },
    );
  }
  async upload(userId: string, id: string, input: RepairMediaUploadDto) {
    if (
      !['inspection', 'repair'].includes(input.kind) ||
      !['BEFORE', 'AFTER', 'DIAGNOSTIC'].includes(input.phase) ||
      !REPAIR_MEDIA_TYPES.includes(
        input.contentType as (typeof REPAIR_MEDIA_TYPES)[number],
      )
    )
      throw new BadRequestException('影像欄位格式不符');
    const { bucket } = this.storage.configuration();
    const result = await this.command(
      userId,
      id,
      input,
      'MEDIA_UPLOAD',
      input,
      async (db, row) => {
        const documentRevision =
          (kindDocument(row, input.kind)?.revision || 0) + 1;
        const mediaId = randomUUID();
        const pending = await db.repairMediaAsset.findMany({
          where: {
            entityId: row.entityId,
            itemId: row.id,
            status: 'PENDING',
            expiresAt: { gt: new Date() },
          },
        });
        if (pending.length >= 12)
          throw new ConflictException('請先完成或撤回現有影像上傳');
        await db.repairMediaAsset.create({
          data: {
            id: mediaId,
            entityId: row.entityId,
            itemId: row.id,
            kind: input.kind,
            documentRevision,
            phase: input.phase,
            checkKey: input.checkKey || null,
            status: 'PENDING',
            bucket,
            objectKey: `repair-media/${encodeURIComponent(row.entityId)}/${encodeURIComponent(row.id)}/${mediaId}`,
            contentType: input.contentType,
            uploadedById: userId,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            bindings: [],
          },
        });
        return { mediaId };
      },
    );
    const db = evidenceDatabase(this.prisma);
    const asset = await db.repairMediaAsset.findFirst({
      where: { id: result.mediaId, entityId: input.entityId, itemId: id },
    });
    if (!asset || asset.status === 'REVOKED')
      throw new ConflictException('影像上傳已撤回');
    if (asset.status === 'FINALIZED')
      return { ...mediaDescriptor(asset), status: 'FINALIZED' };
    if (asset.expiresAt <= new Date())
      throw new ConflictException('影像上傳已逾期，請重新上傳');
    const uploadUrl = await this.storage.mint(
      asset.bucket,
      asset.objectKey,
      asset.contentType,
    );
    await this.actor(userId, input.entityId, true);
    const fresh = await this.item(this.prisma, input.entityId, id);
    requireTechnicianCustody(
      await this.actor(userId, input.entityId, true),
      fresh,
    );
    if (
      !['REPAIR_RECEIVED', 'INSPECTING', 'REPAIRING', 'REFURBISHING'].includes(
        fresh.status,
      ) ||
      fresh.version !== input.expectedVersion
    )
      throw new ConflictException('案件已更新或此階段不能上傳影像');
    const currentAsset = await db.repairMediaAsset.findFirst({
      where: { id: asset.id, entityId: input.entityId, itemId: id },
    });
    if (!currentAsset || currentAsset.status === 'REVOKED')
      throw new ConflictException('影像上傳已撤回');
    if (currentAsset.status === 'FINALIZED')
      return { ...mediaDescriptor(currentAsset), status: 'FINALIZED' };
    if (
      currentAsset.status !== 'PENDING' ||
      currentAsset.expiresAt <= new Date()
    )
      throw new ConflictException('影像上傳已逾期，請重新上傳');
    if (
      (kindDocument(fresh, asset.kind)?.revision || 0) + 1 !==
      asset.documentRevision
    )
      throw new ConflictException('工作單已改版，請重新上傳');
    return {
      ...mediaDescriptor(asset),
      uploadUrl,
      expiresAt: asset.expiresAt.toISOString(),
    };
  }
  async finalize(
    userId: string,
    id: string,
    mediaId: string,
    input: RepairEvidenceCommand,
  ) {
    const actor = await this.actor(userId, input.entityId, true),
      row = await this.item(this.prisma, input.entityId, id);
    requireTechnicianCustody(actor, row);
    const asset = await evidenceDatabase(
      this.prisma,
    ).repairMediaAsset.findFirst({
      where: { id: mediaId, entityId: input.entityId, itemId: id },
    });
    if (!asset || asset.status === 'REVOKED')
      throw new NotFoundException('找不到可確認的影像');
    const verified =
      asset.status === 'FINALIZED'
        ? null
        : await this.storage.verify(
            asset.bucket,
            asset.objectKey,
            asset.contentType,
          );
    await this.command(
      userId,
      id,
      input,
      'MEDIA_FINALIZE',
      { mediaId },
      async (db, current) => {
        const fresh = await db.repairMediaAsset.findFirst({
          where: { id: mediaId, entityId: input.entityId, itemId: id },
        });
        if (!fresh || fresh.status === 'REVOKED')
          throw new ConflictException('影像已撤回');
        if (fresh.status === 'FINALIZED') return { mediaId };
        if (
          !verified ||
          fresh.expiresAt <= new Date() ||
          fresh.documentRevision !==
            (kindDocument(current, fresh.kind)?.revision || 0) + 1 ||
          fresh.uploadedById !== userId
        )
          throw new ConflictException('影像上傳已逾期、改版或不屬於本人');
        await db.repairMediaAsset.update({
          where: { id: mediaId },
          data: {
            status: 'FINALIZED',
            ...verified,
            sizeBytes: BigInt(verified.sizeBytes),
            finalizedAt: new Date(),
          },
        });
        return { mediaId };
      },
    );
    const final = await evidenceDatabase(
      this.prisma,
    ).repairMediaAsset.findFirst({
      where: {
        id: mediaId,
        entityId: input.entityId,
        itemId: id,
        status: 'FINALIZED',
      },
    });
    if (!final) throw new ConflictException('影像尚未確認');
    return { asset: mediaDescriptor(final) };
  }
  async revoke(
    userId: string,
    id: string,
    mediaId: string,
    input: RepairEvidenceCommand,
  ) {
    return this.command(
      userId,
      id,
      input,
      'MEDIA_REVOKE',
      { mediaId },
      async (db) => {
        const row = await db.repairMediaAsset.findFirst({
          where: { id: mediaId, entityId: input.entityId, itemId: id },
        });
        if (!row) throw new NotFoundException('找不到影像');
        await db.repairMediaAsset.update({
          where: { id: mediaId },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedById: userId,
          },
        });
        return { mediaId };
      },
    );
  }
  async list(userId: string, entityId: string, id: string) {
    await this.actor(userId, entityId, false);
    await this.mailroom.detail(userId, entityId, id);
    const assets = await evidenceDatabase(
      this.prisma,
    ).repairMediaAsset.findMany({
      where: { entityId, itemId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      items: assets.map((a) => ({
        ...mediaDescriptor(a),
        bindings: bindings(a),
      })),
    };
  }
  /** Atomically bind verified immutable media to the next saved document revision. */
  async attach(
    tx: Prisma.TransactionClient,
    item: Item,
    kind: 'inspection' | 'repair',
    revision: number,
    refs: RepairDocumentMediaRef[] | undefined,
  ): Promise<FinalizedRepairMedia[]> {
    if (!refs?.length) return [];
    const db = evidenceDatabase(tx),
      result: FinalizedRepairMedia[] = [];
    for (const ref of refs) {
      const asset = await db.repairMediaAsset.findFirst({
        where: {
          id: ref.mediaId,
          entityId: item.entityId,
          itemId: item.id,
          status: 'FINALIZED',
        },
      });
      if (
        !asset ||
        asset.kind !== kind ||
        asset.documentRevision > revision ||
        !asset.sha256 ||
        !asset.sizeBytes ||
        asset.phase !== ref.phase ||
        (asset.checkKey || undefined) !== ref.checkKey
      )
        throw new BadRequestException('工作單影像尚未確認或不屬於本件');
      const binding: Binding = {
        kind,
        documentRevision: revision,
        phase: ref.phase,
        ...(ref.checkKey ? { checkKey: ref.checkKey } : {}),
      };
      const all = bindings(asset);
      if (!all.some((b) => fingerprint(b) === fingerprint(binding)))
        await db.repairMediaAsset.update({
          where: { id: asset.id },
          data: { bindings: [...all, binding] },
        });
      result.push({
        ...ref,
        entityId: item.entityId,
        itemId: item.id,
        kind,
        documentRevision: revision,
        status: 'FINALIZED',
        sha256: asset.sha256,
        contentType: asset.contentType,
        sizeBytes: Number(asset.sizeBytes),
      });
    }
    return result;
  }
  async privateFile(
    userId: string,
    entityId: string,
    id: string,
    mediaId: string,
  ) {
    await this.actor(userId, entityId, false);
    await this.mailroom.detail(userId, entityId, id);
    return this.scopedFile(entityId, id, mediaId);
  }
  async scopedFile(entityId: string, id: string, mediaId: string) {
    const asset = await evidenceDatabase(
      this.prisma,
    ).repairMediaAsset.findFirst({
      where: { id: mediaId, entityId, itemId: id, status: 'FINALIZED' },
    });
    if (!asset || !asset.generation || !asset.sha256 || !asset.sizeBytes)
      throw new NotFoundException('影像已撤回或無法讀取');
    return {
      asset,
      stream: this.storage.stream(
        asset.bucket,
        asset.objectKey,
        asset.generation,
      ),
    };
  }
}
