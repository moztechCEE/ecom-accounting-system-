import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { OperationsSourceReader } from './operations-source.reader';
import {
  fieldNames,
  interactionInput,
  logRange,
} from './operations-admin.contract';
export type LogQuery = {
  entityId: string;
  source?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
  brand?: string;
  recordId?: string;
  actorId?: string;
  actionId?: string;
};
@Injectable()
export class OperationLogsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly access: EntityAccessService,
    private readonly source: OperationsSourceReader,
  ) {}
  async authority(actorId: string, entityId: string, action = 'read') {
    const access = await this.access.assertAccess(actorId, 'sales', entityId);
    const user = await this.auth.validateUser(actorId);
    if (!access.isSuperAdmin && access.scope !== 'ENTITY')
      throw new ForbiddenException('操作日誌需要公司範圍權限');
    const admin = user.roles.some(({ role }) =>
      ['SUPER_ADMIN', 'ADMIN'].includes(role.code),
    );
    const permissions = user.effectivePermissions || [];
    const all = admin || permissions.includes('operation_logs:' + action);
    const source = all || permissions.includes('after_sales_audit:read');
    const wms = admin || permissions.includes('wms_logs:read');
    if (!all && (action !== 'read' || (!source && !wms)))
      throw new ForbiddenException('沒有操作日誌權限');
    return { all, source, wms };
  }
  async recordInteractions(
    actorId: string,
    entityId: string,
    items: Record<string, unknown>[],
  ) {
    await this.access.assertAccess(actorId, 'sales', entityId);
    const user = await this.auth.validateUser(actorId);
    if (
      !Array.isArray(items) ||
      items.length > 20 ||
      JSON.stringify(items).length > 15000
    )
      throw new BadRequestException('操作批次超過限制');
    const rows = items.map((item) => ({
      ...interactionInput(item),
      entityId,
      actorId,
      actorName: user.name || actorId,
      actorRoles: user.roles.map(({ role }) => role.code),
    }));
    await this.db.$transaction(async (tx) => {
      await tx.operationInteraction.createMany({
        data: rows,
        skipDuplicates: true,
      });
      const saved = await tx.operationInteraction.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      for (const row of rows) {
        const previous = saved.find((item) => item.id === row.id);
        if (
          !previous ||
          previous.entityId !== entityId ||
          previous.actorId !== actorId ||
          previous.requestHash !== row.requestHash
        )
          throw new ConflictException('操作紀錄識別已使用');
      }
    });
    return { accepted: rows.length };
  }
  async list(actorId: string, query: LogQuery) {
    const permission = await this.authority(actorId, query.entityId);
    const source =
      query.source ||
      (permission.all ? 'ERP' : permission.source ? 'SOURCE' : 'WMS');
    if (
      ![
        'ERP',
        'INTERACTION',
        'MAILROOM',
        'OUTBOUND',
        'SYNC',
        'SOURCE',
        'WMS',
      ].includes(source)
    )
      throw new BadRequestException('日誌來源不符');
    if (
      !permission.all &&
      !(
        (source === 'SOURCE' && permission.source) ||
        (source === 'WMS' && permission.wms)
      )
    )
      throw new ForbiddenException('沒有此日誌來源權限');
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const { start, end } = logRange(query.from, query.to);
    const sources = [
      ...(permission.all
        ? ['ERP', 'INTERACTION', 'MAILROOM', 'OUTBOUND', 'SYNC']
        : []),
      ...(permission.source ? ['SOURCE'] : []),
      ...(permission.wms ? ['WMS'] : []),
    ];
    if (source === 'WMS')
      return {
        items: [],
        nextCursor: null,
        sources,
        sourceStatus: 'PORTAL_ONLY',
        portalPath:
          '/warehouse/logs?entityId=' + encodeURIComponent(query.entityId),
      };
    if (source === 'SOURCE') {
      const params = new URLSearchParams({
        limit: String(limit),
        from: start.toISOString(),
        to: end.toISOString(),
      });
      for (const key of ['cursor', 'brand', 'actorId', 'actionId'] as const)
        if (query[key]) params.set(key, query[key]!);
      if (query.recordId) params.set('caseId', query.recordId);
      try {
        const result = await this.source.read(
          actorId,
          query.entityId,
          'audit-logs',
          params,
        );
        await this.authority(actorId, query.entityId);
        return {
          items: result.items.map((row: any) => ({
            id: String(row.id),
            occurredAt: row.occurredAt,
            source: 'SOURCE',
            eventClass: 'BUSINESS',
            actorId: row.actorId || null,
            actionId: row.actionId,
            recordType: row.recordType,
            recordId: row.recordId,
            brand: row.brand || null,
            outcome: row.outcome || 'COMMITTED',
            changedFieldNames: Array.isArray(row.changedFieldNames)
              ? row.changedFieldNames.slice(0, 40)
              : [],
          })),
          nextCursor: result.nextCursor || null,
          sources,
          sourceStatus: 'AVAILABLE',
        };
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        return {
          items: [],
          nextCursor: null,
          sources,
          sourceStatus: 'UNAVAILABLE',
        };
      }
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          entityId: query.entityId,
          source,
          from: start.toISOString(),
          to: end.toISOString(),
          brand: query.brand,
          recordId: query.recordId,
          actorId: query.actorId,
          actionId: query.actionId,
        }),
      )
      .digest('hex');
    let position: { time: string; id: string } | undefined;
    if (query.cursor && (!query.from || !query.to))
      throw new BadRequestException('續頁需要固定查詢日期');
    if (query.cursor) {
      try {
        const data = JSON.parse(
          Buffer.from(query.cursor, 'base64url').toString(),
        );
        if (
          data.scope !== fingerprint ||
          !data.id ||
          !Number.isFinite(new Date(data.time).getTime())
        )
          throw Error();
        position = { time: data.time, id: data.id };
      } catch {
        throw new BadRequestException('日誌游標不符');
      }
    }
    const dateField = source === 'INTERACTION' ? 'occurredAt' : 'createdAt';
    const where: any = {
      entityId: query.entityId,
      [dateField]: { gte: start, lte: end },
    };
    if (position)
      where.AND = [
        {
          OR: [
            { [dateField]: { lt: new Date(position.time) } },
            { [dateField]: new Date(position.time), id: { lt: position.id } },
          ],
        },
      ];
    let rows: any[] = [];
    if (source === 'ERP') {
      delete where.entityId;
      where.companyId = query.entityId;
      if (query.brand) where.brand = query.brand;
      if (query.actorId) where.userId = query.actorId;
      if (query.recordId) where.recordId = query.recordId;
      if (query.actionId) where.action = query.actionId;
      rows = await this.db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          createdAt: true,
          userId: true,
          action: true,
          tableName: true,
          recordId: true,
          brand: true,
          correlationId: true,
          oldData: true,
          newData: true,
        },
      });
      rows = rows.map((row) => ({
        id: row.id,
        occurredAt: row.createdAt.toISOString(),
        source,
        eventClass: 'BUSINESS',
        actorId: row.userId,
        actionId: row.action,
        recordType: row.tableName,
        recordId: row.recordId,
        brand: row.brand,
        requestId: row.correlationId,
        outcome: 'COMMITTED',
        changedFieldNames: [
          ...new Set([...fieldNames(row.oldData), ...fieldNames(row.newData)]),
        ],
      }));
    } else if (source === 'INTERACTION') {
      if (query.brand) where.brand = query.brand;
      if (query.actorId) where.actorId = query.actorId;
      if (query.recordId) where.recordId = query.recordId;
      if (query.actionId) where.actionId = query.actionId;
      rows = await this.db.operationInteraction.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      rows = rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        source,
        eventClass: 'INTERACTION',
        actorId: row.actorId,
        actorName: row.actorName,
        actionId: row.actionId,
        recordType: row.workbench,
        recordId: row.recordId,
        requestId: row.requestId,
        brand: row.brand,
        outcome: row.outcome,
        changedFieldNames: [],
      }));
    } else if (source === 'MAILROOM') {
      if (query.brand)
        throw new BadRequestException('實物日誌尚無可驗證品牌篩選');
      if (query.actorId) where.actorId = query.actorId;
      if (query.recordId) where.itemId = query.recordId;
      if (query.actionId) where.action = query.actionId;
      rows = await this.db.mailroomAction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          createdAt: true,
          actorId: true,
          actorName: true,
          action: true,
          itemId: true,
          requestId: true,
          fromStatus: true,
          toStatus: true,
          version: true,
        },
      });
      rows = rows.map((row) => ({
        id: row.id,
        occurredAt: row.createdAt.toISOString(),
        source,
        eventClass: 'BUSINESS',
        actorId: row.actorId,
        actorName: row.actorName,
        actionId: row.action,
        recordType: 'mailroom_items',
        recordId: row.itemId,
        requestId: row.requestId,
        outcome: 'COMMITTED',
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        version: row.version,
        changedFieldNames: [],
      }));
    } else if (source === 'OUTBOUND') {
      if (query.brand)
        throw new BadRequestException('出貨日誌尚無可驗證品牌篩選');
      if (query.actorId) where.actorId = query.actorId;
      if (query.recordId) where.orderId = query.recordId;
      if (query.actionId) where.action = query.actionId;
      rows = await this.db.mailroomOutboundAction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          createdAt: true,
          actorId: true,
          action: true,
          orderId: true,
          requestId: true,
          fromStatus: true,
          toStatus: true,
          version: true,
        },
      });
      rows = rows.map((row) => ({
        id: row.id,
        occurredAt: row.createdAt.toISOString(),
        source,
        eventClass: 'BUSINESS',
        actorId: row.actorId,
        actionId: row.action,
        recordType: 'mailroom_outbound_orders',
        recordId: row.orderId,
        requestId: row.requestId,
        outcome: 'COMMITTED',
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        version: row.version,
        changedFieldNames: [],
      }));
    } else {
      if (query.brand || query.actorId)
        throw new BadRequestException('同步日誌尚无可驗證品牌或操作人篩選');
      if (query.recordId) where.itemId = query.recordId;
      if (query.actionId) where.target = query.actionId;
      rows = await this.db.mailroomDelivery.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          createdAt: true,
          eventId: true,
          itemId: true,
          target: true,
          status: true,
          attempts: true,
          deliveredAt: true,
        },
      });
      rows = rows.map((row) => ({
        id: row.id,
        occurredAt: row.createdAt.toISOString(),
        source,
        eventClass: 'SYNC',
        actorId: null,
        actionId: row.target,
        recordType: 'mailroom_deliveries',
        recordId: row.itemId,
        requestId: row.eventId,
        outcome: row.status,
        attempts: row.attempts,
        deliveredAt: row.deliveredAt,
        changedFieldNames: [],
      }));
    }
    await this.authority(actorId, query.entityId);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        more && last
          ? Buffer.from(
              JSON.stringify({
                scope: fingerprint,
                time: last.occurredAt,
                id: last.id,
              }),
            ).toString('base64url')
          : null,
      sources,
      sourceStatus: 'AVAILABLE',
      legacyUnscoped: 'EXCLUDED',
    };
  }
  async archive(actorId: string, query: LogQuery) {
    await this.authority(actorId, query.entityId, 'export');
    if (['SOURCE', 'WMS'].includes(query.source || ''))
      throw new BadRequestException('此來源請由原系統匯出');
    const range = logRange(query.from, query.to);
    const exportQuery = {
      ...query,
      from: range.start.toISOString(),
      to: range.end.toISOString(),
      limit: 100,
      cursor: undefined,
    };
    const items: any[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.list(actorId, { ...exportQuery, cursor });
      items.push(...page.items);
      cursor = page.nextCursor || undefined;
      if (items.length > 1000)
        throw new BadRequestException('封存範圍超過 1000 筆，請縮小日期');
    } while (cursor);
    const jsonl =
      items.map((row) => JSON.stringify(row)).join('\n') +
      (items.length ? '\n' : '');
    const content = gzipSync(Buffer.from(jsonl), { level: 9 });
    if (content.length > 2 * 1024 * 1024)
      throw new BadRequestException('封存內容過大');
    const checksum = createHash('sha256').update(content).digest('hex');
    const restored = gunzipSync(content).toString('utf8');
    if (restored !== jsonl) throw new Error('ARCHIVE_READBACK_FAILED');
    const manifest = {
      schemaVersion: 'corely.operation-log.archive.v1',
      source: query.source || 'ERP',
      entityId: query.entityId,
      from: range.start.toISOString(),
      to: range.end.toISOString(),
      rowCount: items.length,
      compressedBytes: content.length,
      sha256: checksum,
      readbackVerified: true,
      sourceRecordsRetained: true,
    };
    await this.authority(actorId, query.entityId, 'export');
    const row = await this.db.$transaction(async (tx) => {
      const row = await tx.operationLogArchive.create({
        data: {
          entityId: query.entityId,
          createdBy: actorId,
          manifest,
          content,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: query.entityId,
          userId: actorId,
          tableName: 'operation_log_archives',
          recordId: row.id,
          action: 'ARCHIVE_EXPORT',
          newData: { rowCount: items.length, checksum },
        },
      });
      return row;
    });
    return { id: row.id, manifest };
  }
  async download(actorId: string, entityId: string, id: string) {
    await this.authority(actorId, entityId, 'export');
    const row = await this.db.operationLogArchive.findUnique({ where: { id } });
    if (!row || row.entityId !== entityId)
      throw new NotFoundException('封存包不存在');
    const content = Buffer.from(row.content);
    if (
      createHash('sha256').update(content).digest('hex') !==
      (row.manifest as any).sha256
    )
      throw new ConflictException('封存包校驗失敗');
    gunzipSync(content);
    await this.db.auditLog.create({
      data: {
        companyId: entityId,
        userId: actorId,
        tableName: 'operation_log_archives',
        recordId: id,
        action: 'ARCHIVE_READ',
        newData: { checksum: (row.manifest as any).sha256 },
      },
    });
    return { content, manifest: row.manifest };
  }
}
