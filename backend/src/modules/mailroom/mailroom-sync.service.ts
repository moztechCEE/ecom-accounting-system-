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
type Connection = {
  entityId: string;
  target: 'AFTER_SALES' | 'AI_CUSTOMER_SERVICE';
  baseUrl: string;
  keyId: string;
  secret: string;
  eventsPath?: string;
};

@Injectable()
export class MailroomSyncService implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private devDeliveryTimer?: ReturnType<typeof setInterval>;
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
    let entries: Connection[];
    try {
      entries = JSON.parse(process.env.MAILROOM_CONNECTIONS || '[]');
    } catch {
      throw new ServiceUnavailableException('收發室串接設定格式有誤');
    }
    const entry = Array.isArray(entries)
      ? entries.find((x) => x.entityId === entityId && x.target === target)
      : undefined;
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
  ) {
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
      throw new BadGatewayException(
        '上游回應 ' + response.status + '，資料尚未同步',
      );
    const text = await response.text();
    if (text.length > 1024 * 1024)
      throw new BadGatewayException('上游回應過大');
    try {
      return JSON.parse(text);
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
    const path =
      '/api/integration/mailroom/cases' +
      (id
        ? '/' + encodeURIComponent(id)
        : '?search=' +
          encodeURIComponent(search) +
          (options.awaiting ? '&awaiting=true' : '') +
          (options.cursor
            ? '&cursor=' + encodeURIComponent(options.cursor)
            : ''));
    const result = await this.request(entry, 'GET', path);
    const items = id ? [result.item] : result.items;
    if (
      !Array.isArray(items) ||
      items.length > 50 ||
      items.some(
        (x) =>
          !x ||
          typeof x.id !== 'string' ||
          typeof x.number !== 'string' ||
          !['REPAIR', 'RETURN'].includes(x.type) ||
          typeof x.version !== 'string' ||
          !Array.isArray(x.items) ||
          x.items.some(
            (i: any) =>
              !i ||
              typeof i.id !== 'string' ||
              typeof i.name !== 'string' ||
              !Number.isInteger(i.quantity) ||
              i.quantity < 1,
          ),
      )
    )
      throw new BadGatewayException('售後案件資料格式不符');
    // The source service is authoritative; client-supplied snapshots are never used.
    if (
      result.nextCursor !== undefined &&
      result.nextCursor !== null &&
      (typeof result.nextCursor !== 'string' || result.nextCursor.length > 128)
    )
      throw new BadGatewayException('售後案件分頁格式不符');
    return { items, nextCursor: result.nextCursor ?? null };
  }
  @Interval(15000)
  async deliverPending() {
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
          const result = await this.request(
            entry,
            'POST',
            entry.eventsPath || '/api/integration/mailroom/events',
            JSON.stringify(payload),
          );
          if (result.accepted !== true || result.eventId !== payload.eventId)
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
