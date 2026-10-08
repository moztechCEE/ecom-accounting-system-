import {
  Injectable,
  ServiceUnavailableException,
  BadGatewayException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { signRequest, type SourceCase } from './mailroom.contract';
import {
  validateSourceChanges,
  validSourceCursor,
} from './mailroom-source.contract';
type Connection = {
  entityId: string;
  target: 'AFTER_SALES' | 'AI_CUSTOMER_SERVICE';
  baseUrl: string;
  keyId: string;
  secret: string;
  eventsPath?: string;
};
const connections = (): Connection[] => {
  let value: unknown;
  try {
    value = JSON.parse(process.env.MAILROOM_CONNECTIONS || '[]') as unknown;
  } catch {
    throw new ServiceUnavailableException('收發室串接設定格式有誤');
  }
  if (
    !Array.isArray(value) ||
    value.some((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        return true;
      const item = entry as Record<string, unknown>;
      return (
        typeof item.entityId !== 'string' ||
        !item.entityId ||
        item.entityId.length > 128 ||
        !['AFTER_SALES', 'AI_CUSTOMER_SERVICE'].includes(String(item.target)) ||
        typeof item.baseUrl !== 'string' ||
        typeof item.keyId !== 'string' ||
        typeof item.secret !== 'string' ||
        (item.eventsPath !== undefined && typeof item.eventsPath !== 'string')
      );
    })
  )
    throw new ServiceUnavailableException('收發室串接設定格式有誤');
  return value as Connection[];
};

@Injectable()
export class MailroomSyncService implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private devDeliveryTimer?: ReturnType<typeof setInterval>;
  private sourceConsumer?: () => Promise<unknown>;
  registerSourceConsumer(consumer?: () => Promise<unknown>) {
    this.sourceConsumer = consumer;
  }
  sourceScopes() {
    const entries = connections();
    const entities = [
      ...new Set(
        entries
          .filter((x) => x?.target === 'AFTER_SALES')
          .map((x) => x.entityId),
      ),
    ];
    return entities.map((entityId) => {
      const connection = this.connection(entityId, 'AFTER_SALES');
      const origin = new URL(connection.baseUrl).origin;
      return { entityId, sourceInstance: origin };
    });
  }
  sourcePollingEnabled() {
    return (
      process.env.MAILROOM_SOURCE_SYNC_ENABLED === 'true' &&
      process.env.MAILROOM_ENABLED === 'true' &&
      process.env.MAILROOM_SYNC_ENABLED === 'true' &&
      (process.env.ERP_DEV_SANDBOX !== 'true' || this.devDeliveryEnabled())
    );
  }
  private devDeliveryEnabled() {
    return (
      process.env.ERP_DEV_SANDBOX === 'true' &&
      process.env.RUNTIME_SCHEDULES_ENABLED === 'false' &&
      process.env.ERP_DEV_MAILROOM_EVENTS_ENABLED === 'true' &&
      process.env.ERP_DEV_MAILROOM_SOURCE_ENABLED === 'true' &&
      process.env.ERP_DEV_MAILROOM_SOURCE_URL ===
        'https://moztech-after-sales-dev-sp5g377smq-de.a.run.app' &&
      process.env.MAILROOM_ENABLED === 'true' &&
      process.env.MAILROOM_SYNC_ENABLED === 'true'
    );
  }
  onModuleInit() {
    if (!this.devDeliveryEnabled() || this.devDeliveryTimer) return;
    this.devDeliveryTimer = setInterval(() => {
      void this.deliverPending().catch(() => undefined);
    }, 15000);
    this.devDeliveryTimer.unref();
  }
  onModuleDestroy() {
    if (this.devDeliveryTimer) clearInterval(this.devDeliveryTimer);
    this.devDeliveryTimer = undefined;
  }
  constructor(private readonly prisma: PrismaService) {}
  private connection(entityId: string, target: string): Connection {
    const entry = connections().find(
      (x) => x.entityId === entityId && x.target === target,
    );
    if (!entry || !entry.secret || entry.secret.length < 32 || !entry.keyId)
      throw new ServiceUnavailableException('此公司的串接尚未設定');
    let url: URL;
    try {
      url = new URL(entry.baseUrl);
    } catch {
      throw new ServiceUnavailableException('串接網址設定有誤');
    }
    const local =
      process.env.MAILROOM_ALLOW_LOCAL === 'true' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new ServiceUnavailableException(
        '串接必須使用已設定的 HTTPS origin',
      );
    return entry;
  }
  private async request(
    entry: Connection,
    method: string,
    path: string,
    body = '',
  ): Promise<unknown> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('#'))
      throw new ServiceUnavailableException('串接路徑不正確');
    if (new URL(path, entry.baseUrl).origin !== new URL(entry.baseUrl).origin)
      throw new ServiceUnavailableException('串接路徑不可改變目的站台');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const response = await fetch(new URL(path, entry.baseUrl), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        'content-type': 'application/json',
        'x-mailroom-key': entry.keyId,
        'x-mailroom-entity': entry.entityId,
        'x-mailroom-time': timestamp,
        'x-mailroom-signature': signRequest(
          entry.secret,
          method,
          path,
          timestamp,
          body,
          entry.entityId,
        ),
      },
      ...(method === 'POST' ? { body } : {}),
    });
    if (!response.ok)
      throw new BadGatewayException({
        message: '上游回應 ' + response.status + '，資料尚未同步',
        upstreamStatus: response.status,
      });
    const text = await response.text();
    if (text.length > 1024 * 1024)
      throw new BadGatewayException('上游回應過大');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BadGatewayException('上游回應格式不符');
    }
  }
  async cases(
    entityId: string,
    search = '',
    id?: string,
    options: { awaiting?: boolean; cursor?: string } = {},
  ): Promise<{ items: SourceCase[]; nextCursor?: string | null }> {
    const entry = this.connection(entityId, 'AFTER_SALES');
    // Next.js normalizes query strings using form encoding before verification.
    // Use the same encoding for the transmitted URL and its HMAC, including spaces.
    const query = new URLSearchParams({ search });
    if (options.awaiting) query.set('awaiting', 'true');
    if (options.cursor) query.set('cursor', options.cursor);
    const path =
      '/api/integration/mailroom/cases' +
      (id ? '/' + encodeURIComponent(id) : '?' + query.toString());
    const value = await this.request(entry, 'GET', path);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadGatewayException('售後案件資料格式不符');
    const result = value as Record<string, unknown>;
    const items = id ? [result.item] : result.items;
    if (
      !Array.isArray(items) ||
      items.length > 50 ||
      items.some((value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return true;
        const x = value as Record<string, unknown>;
        return (
          typeof x.id !== 'string' ||
          typeof x.number !== 'string' ||
          typeof x.type !== 'string' ||
          !['REPAIR', 'RETURN'].includes(x.type) ||
          typeof x.version !== 'string' ||
          (x.customerPhone !== undefined &&
            x.customerPhone !== null &&
            (typeof x.customerPhone !== 'string' ||
              x.customerPhone.length > 100)) ||
          (x.inTransit !== undefined && typeof x.inTransit !== 'boolean') ||
          (x.reverseShipments !== undefined &&
            (!Array.isArray(x.reverseShipments) ||
              x.reverseShipments.length > 100 ||
              x.reverseShipments.some((shipment: unknown) => {
                if (
                  !shipment ||
                  typeof shipment !== 'object' ||
                  Array.isArray(shipment)
                )
                  return true;
                const s = shipment as Record<string, unknown>;
                return (
                  typeof s.id !== 'string' ||
                  !/^[A-Za-z0-9_-]{1,128}$/.test(s.id) ||
                  typeof s.carrier !== 'string' ||
                  s.carrier.length > 200 ||
                  (s.trackingNumber !== null &&
                    (typeof s.trackingNumber !== 'string' ||
                      s.trackingNumber.length > 200)) ||
                  typeof s.status !== 'string' ||
                  ![
                    'PENDING',
                    'PICKUP_SCHEDULED',
                    'IN_TRANSIT',
                    'RECEIVED',
                    'CANCELLED',
                  ].includes(s.status) ||
                  (s.receivedAt !== null &&
                    (typeof s.receivedAt !== 'string' ||
                      !Number.isFinite(Date.parse(s.receivedAt)))) ||
                  s.shippedAt !== null
                );
              }))) ||
          !Array.isArray(x.items) ||
          x.items.some((value: unknown) => {
            if (!value || typeof value !== 'object' || Array.isArray(value))
              return true;
            const i = value as Record<string, unknown>;
            return (
              typeof i.id !== 'string' ||
              typeof i.name !== 'string' ||
              !Number.isInteger(i.quantity) ||
              typeof i.quantity !== 'number' ||
              i.quantity < 1
            );
          })
        );
      })
    )
      throw new BadGatewayException('售後案件資料格式不符');
    // The source service is authoritative; client-supplied snapshots are never used.
    if (
      result.nextCursor !== undefined &&
      result.nextCursor !== null &&
      (typeof result.nextCursor !== 'string' || result.nextCursor.length > 128)
    )
      throw new BadGatewayException('售後案件分頁格式不符');
    return {
      items: items as SourceCase[],
      nextCursor:
        typeof result.nextCursor === 'string' ? result.nextCursor : null,
    };
  }
  async changes(entityId: string, cursor: string) {
    if (!validSourceCursor(cursor))
      throw new ServiceUnavailableException('來源游標格式不符');
    const entry = this.connection(entityId, 'AFTER_SALES');
    const path =
      '/api/integration/mailroom/changes?' +
      new URLSearchParams({ cursor, limit: '100' }).toString();
    return validateSourceChanges(
      await this.request(entry, 'GET', path),
      cursor,
    );
  }
  async sourceSummary(entityId: string) {
    const value = await this.request(
      this.connection(entityId, 'AFTER_SALES'),
      'GET',
      '/api/integration/mailroom/summary',
    );
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadGatewayException('售後數量資料格式不符');
    const result = value as Record<string, unknown>;
    if (result.complete === false && result.counts === null)
      return { complete: false as const, counts: null };
    const counts = result.counts as Record<string, unknown> | null;
    if (
      result.complete !== true ||
      !counts ||
      ['awaitingCases', 'awaitingItems', 'inTransitCases'].some(
        (key) =>
          !Number.isSafeInteger(counts[key]) || (counts[key] as number) < 0,
      ) ||
      (counts.inTransitCases as number) > (counts.awaitingCases as number)
    )
      throw new BadGatewayException('售後數量資料格式不符');
    return {
      complete: true as const,
      counts: {
        awaitingCases: counts.awaitingCases as number,
        awaitingItems: counts.awaitingItems as number,
        inTransitCases: counts.inTransitCases as number,
      },
    };
  }
  async caseAttachments(entityId: string, caseId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(caseId))
      throw new BadGatewayException('案件識別碼格式不符');
    const value = await this.request(
      this.connection(entityId, 'AFTER_SALES'),
      'GET',
      '/api/integration/mailroom/cases/' +
        encodeURIComponent(caseId) +
        '/attachments',
    );
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadGatewayException('案件照片資料格式不符');
    const result = value as Record<string, unknown>;
    if (
      result.caseId !== caseId ||
      result.scope !== 'CASE' ||
      !Array.isArray(result.items) ||
      result.items.length > 12 ||
      result.items.some((value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return true;
        const image = value as Record<string, unknown>;
        return (
          typeof image.id !== 'string' ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(image.id) ||
          typeof image.fileName !== 'string' ||
          image.fileName.length > 200 ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(
            String(image.contentType),
          ) ||
          !Number.isInteger(image.sizeBytes) ||
          (image.sizeBytes as number) <= 0 ||
          (image.sizeBytes as number) > 30 * 1024 * 1024 ||
          typeof image.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(image.createdAt)) ||
          image.scope !== 'CASE'
        );
      })
    )
      throw new BadGatewayException('案件照片資料格式不符');
    return {
      caseId,
      scope: 'CASE' as const,
      items: result.items.map((value: unknown) => {
        const image = value as Record<string, unknown>;
        return {
          id: image.id as string,
          fileName: image.fileName as string,
          contentType: image.contentType as string,
          sizeBytes: image.sizeBytes as number,
          createdAt: image.createdAt as string,
          scope: 'CASE' as const,
        };
      }),
      hasMore: result.hasMore === true,
    };
  }
  async caseAttachmentMedia(
    entityId: string,
    caseId: string,
    attachmentId: string,
  ) {
    if (
      ![caseId, attachmentId].every((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id))
    )
      throw new BadGatewayException('案件照片識別碼格式不符');
    const entry = this.connection(entityId, 'AFTER_SALES');
    const path =
      '/api/integration/mailroom/cases/' +
      encodeURIComponent(caseId) +
      '/attachments/' +
      encodeURIComponent(attachmentId) +
      '/media';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const response = await fetch(new URL(path, entry.baseUrl), {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        'x-mailroom-key': entry.keyId,
        'x-mailroom-entity': entry.entityId,
        'x-mailroom-time': timestamp,
        'x-mailroom-signature': signRequest(
          entry.secret,
          'GET',
          path,
          timestamp,
          '',
          entry.entityId,
        ),
      },
    });
    if (!response.ok)
      throw new BadGatewayException({
        message: '案件照片暫時無法讀取',
        upstreamStatus: response.status,
      });
    const contentType =
      response.headers.get('content-type')?.split(';')[0].trim() || '';
    const max = 1024 * 1024;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(contentType) ||
      Number(response.headers.get('content-length') || 0) > max ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new BadGatewayException('案件照片格式或大小不符');
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > max) throw new BadGatewayException('案件照片過大');
        chunks.push(Buffer.from(part.value));
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    } finally {
      reader.releaseLock();
    }
    const contents = Buffer.concat(chunks, length);
    const valid =
      contentType === 'image/jpeg'
        ? contents.length >= 3 &&
          contents[0] === 0xff &&
          contents[1] === 0xd8 &&
          contents[2] === 0xff
        : contentType === 'image/png'
          ? contents.length >= 8 &&
            contents
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : contents.length >= 12 &&
            contents.subarray(0, 4).toString('ascii') === 'RIFF' &&
            contents.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!valid) throw new BadGatewayException('案件照片格式不符');
    return { contents, contentType };
  }
  @Interval(15000)
  async deliverPending() {
    if (this.sourcePollingEnabled())
      void this.sourceConsumer?.().catch(() => undefined);
    if (
      this.running ||
      process.env.MAILROOM_ENABLED !== 'true' ||
      process.env.MAILROOM_SYNC_ENABLED !== 'true' ||
      (process.env.ERP_DEV_SANDBOX === 'true' && !this.devDeliveryEnabled())
    )
      return;
    this.running = true;
    const scope =
      process.env.ERP_DEV_SANDBOX === 'true'
        ? Prisma.sql`AND entity_id=${'doa-dev-qa-20261002'} AND target=${'AFTER_SALES'}`
        : Prisma.empty;
    try {
      for (let n = 0; n < 20; n++) {
        const token = randomUUID();
        const rows = await this.prisma.$queryRaw<
          Array<{
            id: string;
            entity_id: string;
            target: string;
            payload: unknown;
            attempts: number;
          }>
        >(Prisma.sql`
          UPDATE mailroom_deliveries SET status='SENDING', lease_token=${token}, lease_until=NOW()+INTERVAL '30 seconds', attempts=attempts+1
          WHERE id=(SELECT id FROM mailroom_deliveries WHERE ((status='PENDING' AND next_attempt_at<=NOW()) OR
            (status='SENDING' AND lease_until<NOW())) ${scope} ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
          RETURNING id, entity_id, target, payload, attempts`);
        const row = rows[0];
        if (!row) break;
        try {
          const entry = this.connection(row.entity_id, row.target);
          const payload = row.payload as { eventId: string };
          const value = await this.request(
            entry,
            'POST',
            entry.eventsPath || '/api/integration/mailroom/events',
            JSON.stringify(payload),
          );
          const result = value as {
            accepted?: unknown;
            eventId?: unknown;
          } | null;
          if (
            !result ||
            result.accepted !== true ||
            result.eventId !== payload.eventId
          )
            throw new Error('ack_invalid');
          await this.prisma.mailroomDelivery.updateMany({
            where: { id: row.id, leaseToken: token },
            data: {
              status: 'DELIVERED',
              deliveredAt: new Date(),
              lastError: null,
              leaseUntil: null,
              leaseToken: null,
            },
          });
        } catch (error) {
          const message =
            error instanceof ServiceUnavailableException
              ? '串接尚未設定，等待設定後重試'
              : '傳送或回執失敗，等待重試';
          await this.prisma.mailroomDelivery.updateMany({
            where: { id: row.id, leaseToken: token },
            data: {
              status: 'PENDING',
              lastError: message,
              nextAttemptAt: new Date(
                Date.now() +
                  Math.min(3600000, 15000 * 2 ** Math.min(row.attempts, 8)),
              ),
              leaseUntil: null,
              leaseToken: null,
            },
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
