import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Prisma,
  type MailroomPrintDevice,
  type MailroomPrintJob,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MailroomLabelExport } from '../mailroom-label.export';
import { MailroomLabelService } from '../mailroom-label.service';
import type { MailroomLabel } from '../mailroom-label.contract';
import { MailroomService } from '../mailroom.service';
import { requireEntity, requirePermission } from '../mailroom.contract';
import {
  CAPABILITY,
  capabilityHash,
  equalHash,
  hash,
  HEARTBEAT_MS,
  itemSetFingerprint,
  JOB_TTL_MS,
  MAX_PDF_BYTES,
  PAIR_TTL_MS,
  PRINT_PROFILE,
  printEnabled,
  requestFingerprint,
  requireUuid,
  TERMINAL_STATES,
  TOKEN_TTL_MS,
  type PrintIdentity,
  type RedeemIdentity,
} from './mailroom-print.contract';
import type {
  CreatePrintJobDto,
  PairPrintDeviceDto,
  PreviewPrintLabelDto,
  PrintReceiptDto,
  RedeemPrintDeviceDto,
} from './mailroom-print.dto';
import {
  editedLabel,
  labelVersionConflict,
  normalizeLabelEdit,
  normalizeLabelEdits,
} from './mailroom-print-label-edit.contract';

type Tx = Prisma.TransactionClient;
const isTerminal = (state: string) =>
  (TERMINAL_STATES as readonly string[]).includes(state);

@Injectable()
export class MailroomPrintService {
  constructor(
    private readonly db: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly labels: MailroomLabelService,
    private readonly exporter: MailroomLabelExport,
  ) {}

  @Interval('mailroom-print-expiry', 60_000)
  async clearExpiredDocuments() {
    if (
      process.env.ERP_DEV_SANDBOX !== 'true' ||
      process.env.MAILROOM_PRINT_ENABLED !== 'true'
    )
      return;
    await this.db.mailroomPrintJob.updateMany({
      where: {
        status: { in: ['QUEUED', 'CLAIMED'] },
        expiresAt: { lte: new Date() },
      },
      data: {
        status: 'FAILED',
        errorCode: 'EXPIRED',
        pdfBytes: null,
        activeKey: null,
      },
    });
  }

  private async scope(userId: string, entityId: string, tx: Tx = this.db) {
    printEnabled();
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId, tx);
    requireEntity(actor, entityId);
    requirePermission(actor, 'mailroom:read');
    requirePermission(actor, 'mailroom:update');
    if (
      !(await tx.employee.findFirst({
        where: { userId, entityId, isActive: true },
        select: { id: true },
      }))
    )
      throw new ForbiddenException('列印人員必須是此公司的在職員工');
  }
  private async serial<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(run, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000,
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2034' && attempt < 2)
          continue;
        if ((error as { code?: string }).code === 'P2034')
          throw new ConflictException('列印工作正在更新，請查詢原工作');
        throw error;
      }
    }
  }
  private view(job: MailroomPrintJob) {
    return {
      id: job.id,
      requestId: job.requestId,
      deviceId: job.deviceId,
      status: job.status,
      pages: job.pages,
      expiresAt: job.expiresAt.toISOString(),
      cupsJobId: job.cupsJobId,
      errorCode: job.errorCode,
      reprintOf: job.reprintOf,
    };
  }
  private async expire(tx: Tx, entityId: string, deviceId?: string) {
    // Only unsubmitted work expires automatically. A SUBMITTING job may have reached CUPS.
    await tx.mailroomPrintJob.updateMany({
      where: {
        entityId,
        ...(deviceId ? { deviceId } : {}),
        status: { in: ['QUEUED', 'CLAIMED'] },
        expiresAt: { lte: new Date() },
      },
      data: {
        status: 'FAILED',
        errorCode: 'EXPIRED',
        pdfBytes: null,
        activeKey: null,
      },
    });
  }
  private async currentDevice(
    identity: PrintIdentity,
    tx: Tx = this.db,
  ): Promise<MailroomPrintDevice> {
    printEnabled();
    const device = await tx.mailroomPrintDevice.findUnique({
      where: { id: identity.deviceId },
    });
    if (
      !device ||
      device.entityId !== identity.entityId ||
      device.registeredById !== identity.registeredById ||
      device.revokedAt ||
      !device.pairedAt ||
      !device.tokenExpiresAt ||
      device.tokenExpiresAt.getTime() <= Date.now() ||
      !equalHash(device.tokenHash, identity.tokenHash)
    )
      throw new UnauthorizedException('PRINT_DEVICE_CAPABILITY_INVALID');
    await this.scope(device.registeredById, device.entityId, tx);
    return device;
  }
  async authenticateDevice(id: string, token: string): Promise<PrintIdentity> {
    printEnabled();
    requireUuid(id);
    if (!CAPABILITY.test(token))
      throw new UnauthorizedException('PRINT_DEVICE_CAPABILITY_INVALID');
    const device = await this.db.mailroomPrintDevice.findUnique({
      where: { id },
    });
    const tokenHash = capabilityHash('token', token);
    if (
      !device ||
      device.revokedAt ||
      !device.pairedAt ||
      !device.tokenExpiresAt ||
      device.tokenExpiresAt.getTime() <= Date.now() ||
      !equalHash(device.tokenHash, tokenHash)
    )
      throw new UnauthorizedException('PRINT_DEVICE_CAPABILITY_INVALID');
    // No employee, label or job reads occur before the capability has been verified.
    await this.scope(device.registeredById, device.entityId);
    return {
      deviceId: id,
      entityId: device.entityId,
      registeredById: device.registeredById,
      tokenHash,
    };
  }
  async authorizeRedeem(id: string, code: string): Promise<RedeemIdentity> {
    printEnabled();
    requireUuid(id);
    if (!CAPABILITY.test(code))
      throw new UnauthorizedException('PRINT_PAIR_CODE_INVALID');
    const device = await this.db.mailroomPrintDevice.findUnique({
      where: { id },
    });
    const pairHash = capabilityHash('pair', code);
    if (
      !device ||
      device.revokedAt ||
      device.pairedAt ||
      device.tokenHash ||
      !device.pairExpiresAt ||
      device.pairExpiresAt.getTime() <= Date.now() ||
      !equalHash(device.pairHash, pairHash)
    )
      throw new UnauthorizedException('PRINT_PAIR_CODE_INVALID');
    await this.scope(device.registeredById, device.entityId);
    return { deviceId: id, pairHash };
  }
  async pair(userId: string, body: PairPrintDeviceDto) {
    await this.scope(userId, body.entityId);
    const name = body.name?.trim();
    if (
      !name ||
      name.length > 40 ||
      Array.from(name).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw new BadRequestException('裝置名稱格式不符');
    const code = randomBytes(32).toString('base64url'),
      expiresAt = new Date(Date.now() + PAIR_TTL_MS);
    const device = await this.serial(async (tx) => {
      await this.scope(userId, body.entityId, tx);
      return tx.mailroomPrintDevice.create({
        data: {
          id: randomUUID(),
          entityId: body.entityId,
          registeredById: userId,
          name,
          pairHash: capabilityHash('pair', code),
          pairExpiresAt: expiresAt,
        },
      });
    });
    return {
      deviceId: device.id,
      pairCode: code,
      expiresAt: expiresAt.toISOString(),
    };
  }
  async redeem(identity: RedeemIdentity, body: RedeemPrintDeviceDto) {
    if (
      identity.deviceId !== body.deviceId ||
      !equalHash(identity.pairHash, capabilityHash('pair', body.code))
    )
      throw new UnauthorizedException('PRINT_PAIR_CODE_INVALID');
    const token = randomBytes(32).toString('base64url');
    await this.serial(async (tx) => {
      const device = await tx.mailroomPrintDevice.findUnique({
        where: { id: identity.deviceId },
      });
      if (
        !device ||
        device.revokedAt ||
        device.pairedAt ||
        device.tokenHash ||
        !device.pairExpiresAt ||
        device.pairExpiresAt.getTime() <= Date.now() ||
        !equalHash(device.pairHash, identity.pairHash)
      )
        throw new UnauthorizedException('PRINT_PAIR_CODE_INVALID');
      await this.scope(device.registeredById, device.entityId, tx);
      const saved = await tx.mailroomPrintDevice.updateMany({
        where: {
          id: device.id,
          pairHash: identity.pairHash,
          pairExpiresAt: { gt: new Date() },
          pairedAt: null,
          tokenHash: null,
          revokedAt: null,
        },
        data: {
          pairHash: null,
          pairExpiresAt: null,
          tokenHash: capabilityHash('token', token),
          tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS),
          pairedAt: new Date(),
        },
      });
      if (saved.count !== 1)
        throw new UnauthorizedException('PRINT_PAIR_CODE_INVALID');
    });
    return { deviceId: identity.deviceId, token };
  }
  async devices(userId: string, entityId: string) {
    await this.scope(userId, entityId);
    const rows = await this.db.mailroomPrintDevice.findMany({
      where: {
        entityId,
        revokedAt: null,
        pairedAt: { not: null },
        tokenHash: { not: null },
        tokenExpiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const devices: Array<{
      id: string;
      name: string;
      online: boolean;
      owned: boolean;
    }> = [];
    for (const row of rows) {
      try {
        await this.scope(row.registeredById, entityId);
      } catch (error) {
        if (error instanceof ForbiddenException) continue;
        throw error;
      }
      devices.push({
        id: row.id,
        name: row.name,
        online:
          !!row.lastSeenAt &&
          Date.now() - row.lastSeenAt.getTime() <= HEARTBEAT_MS,
        owned: row.registeredById === userId,
      });
    }
    return { devices };
  }
  async revoke(userId: string, entityId: string, id: string) {
    requireUuid(id);
    await this.scope(userId, entityId);
    await this.serial(async (tx) => {
      await this.scope(userId, entityId, tx);
      const device = await tx.mailroomPrintDevice.findFirst({
        where: { id, entityId, registeredById: userId },
      });
      if (!device) throw new NotFoundException('找不到此裝置');
      if (device.revokedAt) return;
      await tx.mailroomPrintDevice.updateMany({
        where: { id, entityId, registeredById: userId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          tokenHash: null,
          pairHash: null,
          pairExpiresAt: null,
        },
      });
      await tx.mailroomPrintJob.updateMany({
        where: {
          deviceId: id,
          entityId,
          status: { in: ['QUEUED', 'CLAIMED'] },
        },
        data: {
          status: 'FAILED',
          errorCode: 'DEVICE_REVOKED',
          activeKey: null,
          pdfBytes: null,
        },
      });
      await tx.mailroomPrintJob.updateMany({
        where: { deviceId: id, entityId, status: 'SUBMITTING' },
        data: {
          status: 'UNKNOWN',
          errorCode: 'DEVICE_REVOKED',
          pdfBytes: null,
        },
      });
    });
    return { id, revoked: true };
  }
  private normalize(body: CreatePrintJobDto): CreatePrintJobDto {
    requireUuid(body.deviceId);
    requireUuid(body.requestId);
    if (
      !Array.isArray(body.itemIds) ||
      !body.itemIds.length ||
      body.itemIds.length > 50
    )
      throw new BadRequestException('每次須選擇 1 至 50 件');
    body.itemIds.forEach(requireUuid);
    const itemIds = body.itemIds.map((id) => id.toLowerCase());
    if (new Set(itemIds).size !== itemIds.length)
      throw new BadRequestException('物件不能重複');
    if (body.reprintOf) requireUuid(body.reprintOf);
    const labelEdits = normalizeLabelEdits(body.labelEdits, itemIds);
    return {
      entityId: body.entityId,
      deviceId: body.deviceId.toLowerCase(),
      requestId: body.requestId.toLowerCase(),
      itemIds,
      ...(labelEdits.length ? { labelEdits } : {}),
      ...(body.reprintOf ? { reprintOf: body.reprintOf.toLowerCase() } : {}),
    };
  }
  private async usableDevice(tx: Tx, entityId: string, id: string) {
    const device = await tx.mailroomPrintDevice.findFirst({
      where: {
        id,
        entityId,
        revokedAt: null,
        pairedAt: { not: null },
        tokenHash: { not: null },
        tokenExpiresAt: { gt: new Date() },
      },
    });
    if (!device) throw new NotFoundException('找不到可用的列印裝置');
    await this.scope(device.registeredById, entityId, tx);
    if (
      !device.lastSeenAt ||
      Date.now() - device.lastSeenAt.getTime() > HEARTBEAT_MS
    )
      throw new ServiceUnavailableException('列印裝置未連線');
    return device;
  }
  private async original(
    tx: Tx,
    userId: string,
    body: CreatePrintJobDto,
    requestHash: string,
  ) {
    const prior = await tx.mailroomPrintJob.findUnique({
      where: {
        entityId_createdById_requestId: {
          entityId: body.entityId,
          createdById: userId,
          requestId: body.requestId,
        },
      },
    });
    if (prior && prior.requestHash !== requestHash)
      throw new ConflictException('此列印請求已使用，內容不一致');
    return prior;
  }
  async create(userId: string, input: CreatePrintJobDto) {
    const body = this.normalize(input);
    await this.scope(userId, body.entityId);
    const requestHash = requestFingerprint(body),
      itemSetHash = itemSetFingerprint(body.itemIds);
    const prior = await this.original(this.db, userId, body, requestHash);
    if (prior) return this.view(prior);
    await this.usableDevice(this.db, body.entityId, body.deviceId);
    // Fresh company-scoped identity/QR only; the allowlisted edits affect this PDF's text.
    const labels: MailroomLabel[] = [];
    for (const id of body.itemIds)
      labels.push(
        editedLabel(
          await this.labels.read(userId, body.entityId, id),
          body.labelEdits?.find((edit) => edit.itemId === id),
        ),
      );
    const pdf = await this.exporter.pdfMany(labels);
    if (
      !Buffer.isBuffer(pdf) ||
      pdf.length < 5 ||
      pdf.length > MAX_PDF_BYTES ||
      pdf.subarray(0, 5).toString() !== '%PDF-'
    )
      throw new ServiceUnavailableException('標籤文件產生失敗');
    try {
      return await this.serial(async (tx) => {
        // Authorization, device ownership/revocation/heartbeat and item versions are checked again after all network/render awaits.
        await this.scope(userId, body.entityId, tx);
        const replay = await this.original(tx, userId, body, requestHash);
        if (replay) return this.view(replay);
        await this.usableDevice(tx, body.entityId, body.deviceId);
        const items = await tx.mailroomItem.findMany({
          where: {
            id: { in: body.itemIds },
            entityId: body.entityId,
            receipt: { entityId: body.entityId },
          },
          select: { id: true, version: true },
        });
        if (
          items.length !== labels.length ||
          labels.some(
            (label) =>
              !items.some(
                (item) =>
                  item.id === label.id && item.version === label.version,
              ),
          )
        )
          throw labelVersionConflict();
        await this.expire(tx, body.entityId);
        // Serializable predicate reads also prevent overlapping batches/rows across
        // tabs, actors and devices from both observing no active work and inserting.
        const overlapping = await tx.mailroomPrintJob.findFirst({
          where: {
            entityId: body.entityId,
            activeKey: { not: null },
            itemIds: { hasSome: body.itemIds },
            ...(body.reprintOf ? { id: { not: body.reprintOf } } : {}),
          },
        });
        if (overlapping)
          throw new ConflictException('選取物件已有列印工作，請先查詢原結果');
        const activeKey = hash(
          body.entityId + '\0' + body.deviceId + '\0' + itemSetHash,
        );
        const active = await tx.mailroomPrintJob.findUnique({
          where: { activeKey },
        });
        if (body.reprintOf) {
          const previous = await tx.mailroomPrintJob.findFirst({
            where: {
              id: body.reprintOf,
              entityId: body.entityId,
              deviceId: body.deviceId,
              itemSetHash,
              status: 'UNKNOWN',
            },
          });
          if (!previous || (active && active.id !== previous.id))
            throw new ConflictException('只能明確重印結果未確認的原工作');
          if (previous.activeKey) {
            const released = await tx.mailroomPrintJob.updateMany({
              where: { id: previous.id, status: 'UNKNOWN', activeKey },
              data: { activeKey: null },
            });
            if (released.count !== 1)
              throw new ConflictException('原工作已更新');
          } else throw new ConflictException('原工作已建立重印工作');
        } else if (active)
          throw new ConflictException('相同物件已有列印工作，請先查詢原結果');
        const job = await tx.mailroomPrintJob.create({
          data: {
            id: randomUUID(),
            entityId: body.entityId,
            createdById: userId,
            deviceId: body.deviceId,
            requestId: body.requestId,
            requestHash,
            itemIds: body.itemIds,
            itemSetHash,
            itemVersions: labels.map((label) => ({
              id: label.id,
              version: label.version,
            })),
            pdfBytes: new Uint8Array(pdf),
            pdfSha256: hash(pdf),
            pdfSize: pdf.length,
            pages: labels.length,
            profile: PRINT_PROFILE,
            status: 'QUEUED',
            expiresAt: new Date(Date.now() + JOB_TTL_MS),
            activeKey,
            reprintOf: body.reprintOf || null,
          },
        });
        return this.view(job);
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const replay = await this.original(this.db, userId, body, requestHash);
        if (replay) return this.view(replay);
        throw new ConflictException('相同物件已有列印工作，請查詢原結果');
      }
      throw error;
    }
  }
  async preview(userId: string, body: PreviewPrintLabelDto): Promise<Buffer> {
    requireUuid(body.itemId);
    const itemId = body.itemId.toLowerCase();
    const edit =
      body.labelEdit === undefined
        ? undefined
        : normalizeLabelEdit(body.labelEdit, itemId);
    await this.scope(userId, body.entityId);
    const label = editedLabel(
      await this.labels.read(userId, body.entityId, itemId),
      edit,
    );
    // Use precisely the same exporter as a real job; preview never creates or expires jobs.
    const pdf = await this.exporter.pdfMany([label]);
    if (
      !Buffer.isBuffer(pdf) ||
      pdf.length < 5 ||
      pdf.length > MAX_PDF_BYTES ||
      pdf.subarray(0, 5).toString() !== '%PDF-'
    )
      throw new ServiceUnavailableException('標籤文件產生失敗');
    await this.scope(userId, body.entityId);
    const items = await this.db.mailroomItem.findMany({
      where: {
        id: { in: [itemId] },
        entityId: body.entityId,
        receipt: { entityId: body.entityId },
      },
      select: { id: true, version: true },
    });
    if (
      items.length !== 1 ||
      items[0].id !== label.id ||
      items[0].version !== label.version
    )
      throw labelVersionConflict();
    return pdf;
  }
  async status(userId: string, entityId: string, id: string) {
    requireUuid(id);
    await this.scope(userId, entityId);
    await this.expire(this.db, entityId);
    const job = await this.db.mailroomPrintJob.findFirst({
      where: { id, entityId, createdById: userId },
    });
    if (!job) throw new NotFoundException('找不到列印工作');
    return this.view(job);
  }
  async byRequest(userId: string, entityId: string, requestId: string) {
    requireUuid(requestId);
    await this.scope(userId, entityId);
    await this.expire(this.db, entityId);
    const job = await this.db.mailroomPrintJob.findUnique({
      where: {
        entityId_createdById_requestId: {
          entityId,
          createdById: userId,
          requestId,
        },
      },
    });
    if (!job) throw new NotFoundException('找不到列印工作');
    return this.view(job);
  }
  async claim(identity: PrintIdentity) {
    return this.serial(async (tx) => {
      const device = await this.currentDevice(identity, tx);
      // This row write serializes concurrent pollers for one device across application instances.
      await tx.mailroomPrintDevice.updateMany({
        where: {
          id: device.id,
          tokenHash: identity.tokenHash,
          revokedAt: null,
        },
        data: { lastSeenAt: new Date() },
      });
      await this.expire(tx, identity.entityId, identity.deviceId);
      if (
        await tx.mailroomPrintJob.findFirst({
          where: {
            deviceId: device.id,
            entityId: device.entityId,
            status: 'SUBMITTING',
          },
        })
      )
        return { job: null };
      let job = await tx.mailroomPrintJob.findFirst({
        where: {
          deviceId: device.id,
          entityId: device.entityId,
          status: 'CLAIMED',
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!job)
        job = await tx.mailroomPrintJob.findFirst({
          where: {
            deviceId: device.id,
            entityId: device.entityId,
            status: 'QUEUED',
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'asc' },
        });
      if (!job) return { job: null };
      try {
        await this.scope(job.createdById, job.entityId, tx);
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        await tx.mailroomPrintJob.updateMany({
          where: { id: job.id, status: { in: ['QUEUED', 'CLAIMED'] } },
          data: {
            status: 'FAILED',
            errorCode: 'AUTHORIZATION_REVOKED',
            activeKey: null,
            pdfBytes: null,
          },
        });
        return { job: null };
      }
      if (job.status === 'QUEUED') {
        const claimed = await tx.mailroomPrintJob.updateMany({
          where: {
            id: job.id,
            deviceId: device.id,
            status: 'QUEUED',
            expiresAt: { gt: new Date() },
          },
          data: { status: 'CLAIMED', claimedAt: new Date() },
        });
        if (claimed.count !== 1) return { job: null };
      }
      return {
        job: {
          id: job.id,
          entityId: job.entityId,
          deviceId: job.deviceId,
          status: 'CLAIMED' as const,
          pdfSha256: job.pdfSha256,
          pdfBytes: job.pdfSize,
          pages: job.pages,
          expiresAt: job.expiresAt.toISOString(),
          profile: job.profile,
          documentPath:
            '/api/v1/mailroom/print-device/jobs/' + job.id + '/document',
        },
      };
    });
  }
  async document(identity: PrintIdentity, id: string) {
    requireUuid(id);
    await this.currentDevice(identity);
    await this.expire(this.db, identity.entityId, identity.deviceId);
    const job = await this.db.mailroomPrintJob.findFirst({
      where: {
        id,
        deviceId: identity.deviceId,
        entityId: identity.entityId,
        status: 'CLAIMED',
        expiresAt: { gt: new Date() },
      },
    });
    if (!job?.pdfBytes) throw new NotFoundException('列印文件已不可領取');
    await this.scope(job.createdById, job.entityId);
    return Buffer.from(job.pdfBytes);
  }
  async receipt(identity: PrintIdentity, id: string, body: PrintReceiptDto) {
    requireUuid(id);
    if (
      body.state === 'SUBMITTED'
        ? !body.cupsJobId || body.errorCode
        : !!body.cupsJobId
    )
      throw new BadRequestException('列印回執內容不符');
    if (
      (body.state === 'SUBMITTING' && body.errorCode) ||
      (['FAILED', 'UNKNOWN'].includes(body.state) && !body.errorCode)
    )
      throw new BadRequestException('列印回執內容不符');
    return this.serial(async (tx) => {
      await this.currentDevice(identity, tx);
      const job = await tx.mailroomPrintJob.findFirst({
        where: { id, deviceId: identity.deviceId, entityId: identity.entityId },
      });
      if (!job) throw new NotFoundException('找不到列印工作');
      const same =
        job.status === body.state &&
        job.cupsJobId === (body.cupsJobId || null) &&
        job.errorCode === (body.errorCode || null);
      if (same) return this.view(job);
      if (isTerminal(job.status))
        // Authenticated same-device terminal proof is read-only. The agent keeps
        // its local outcome separately and can reconcile an expiry/ACK race.
        throw new ConflictException({
          message: 'PRINT_RECEIPT_TERMINAL_CONFLICT',
          current: this.view(job),
        });
      if (body.state === 'SUBMITTING') {
        if (job.status !== 'CLAIMED' || job.expiresAt.getTime() <= Date.now())
          throw new ConflictException('工作已過期或不可提交');
        await this.scope(job.createdById, job.entityId, tx);
      } else if (
        job.status !== 'SUBMITTING' &&
        !(
          job.status === 'CLAIMED' && ['FAILED', 'UNKNOWN'].includes(body.state)
        )
      )
        throw new ConflictException('工作尚未進入提交階段');
      const data = {
        status: body.state,
        cupsJobId: body.cupsJobId || null,
        errorCode: body.errorCode || null,
        // Agent already owns and durably saved the PDF before SUBMITTING; it can never be downloaded again.
        ...(body.state === 'SUBMITTING'
          ? { submittingAt: new Date(), pdfBytes: null }
          : {
              finishedAt: new Date(),
              pdfBytes: null,
              ...(body.state !== 'UNKNOWN' ? { activeKey: null } : {}),
            }),
      };
      const saved = await tx.mailroomPrintJob.updateMany({
        where: { id, deviceId: identity.deviceId, status: job.status },
        data,
      });
      if (saved.count !== 1)
        throw new ConflictException('列印狀態已更新，請查詢原工作');
      return this.view({ ...job, ...data });
    });
  }
}
