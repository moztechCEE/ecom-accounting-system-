import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { WmsPortalService } from './wms-portal.module';
import {
  nativeBody,
  nativeBusinessTarget,
  nativeDisposition,
  nativeEntity,
  nativeSessionToken,
  WMS_NATIVE_RESPONSE_LIMIT,
} from './wms-native.contract';

export const WMS_NATIVE_PORTAL = 'WMS_NATIVE_PORTAL';
export const WMS_NATIVE_FETCH = 'WMS_NATIVE_FETCH';
export const WMS_NATIVE_ENV = 'WMS_NATIVE_ENV';
export type NativeReply = {
  status: number;
  body: Buffer;
  headers: Record<string, string>;
};
type NativeUser = {
  id: number;
  erpSubject: string;
  entityId: string;
  [key: string]: unknown;
};
type ProxyRequest = {
  target: string;
  method: string;
  body?: Buffer;
  contentType?: string;
  accept?: string;
  etag?: string;
  signal?: AbortSignal;
};

@Injectable()
export class WmsNativeService {
  constructor(
    @Inject(WMS_NATIVE_PORTAL) private readonly portal: WmsPortalService,
    @Optional()
    @Inject(WMS_NATIVE_FETCH)
    private readonly fetcher: typeof fetch = fetch,
    @Optional()
    @Inject(WMS_NATIVE_ENV)
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  private configuration(entity: string) {
    if (this.env.WMS_NATIVE_ENABLED !== 'true')
      throw new ServiceUnavailableException('WMS_NATIVE_DISABLED');
    const selected = nativeEntity(entity);
    if (selected !== this.env.WMS_PORTAL_ENTITY_ID)
      throw new ForbiddenException('WMS_NATIVE_ENTITY_MISMATCH');
    let url: URL;
    try {
      url = new URL(this.env.WMS_PORTAL_SERVICE_URL || '');
      const test =
        this.env.NODE_ENV === 'test' &&
        url.protocol === 'http:' &&
        url.hostname === '127.0.0.1';
      if (
        (!test && url.protocol !== 'https:') ||
        url.username ||
        url.password ||
        (url.port && !test) ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw Error();
      // DEV can only use the canonical isolated WMS or its tagged candidate.
      if (
        this.env.ERP_DEV_SANDBOX === 'true' &&
        !/^https:\/\/(?:[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?---)?corely-wms-dev-sp5g377smq-de\.a\.run\.app$/.test(
          url.origin,
        )
      )
        throw Error();
    } catch {
      throw new ServiceUnavailableException('WMS_NATIVE_SOURCE_INVALID');
    }
    return url.origin;
  }
  private async request(
    base: string,
    target: string,
    init: RequestInit,
    command = false,
  ) {
    try {
      return await this.fetcher(base + target, {
        ...init,
        redirect: 'error',
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000),
      });
    } catch {
      // A transport error is an unknown command result, never permission to retry.
      throw new ServiceUnavailableException({
        code: command ? 'WMS_NATIVE_RESULT_UNKNOWN' : 'WMS_NATIVE_UNAVAILABLE',
        message: command
          ? '作業結果尚未確認，請重新查詢原作業紀錄'
          : '無法連線至儲運工作台',
      });
    }
  }
  private async bytes(response: Response) {
    if (
      Number(response.headers.get('content-length') || 0) >
      WMS_NATIVE_RESPONSE_LIMIT
    )
      throw new ServiceUnavailableException('WMS_NATIVE_RESPONSE_TOO_LARGE');
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > WMS_NATIVE_RESPONSE_LIMIT)
          throw new ServiceUnavailableException(
            'WMS_NATIVE_RESPONSE_TOO_LARGE',
          );
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('WMS_NATIVE_RESPONSE_INTERRUPTED');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  private async json(response: Response) {
    const bytes = await this.bytes(response);
    if (!response.ok) {
      let error: object = { message: 'WMS_NATIVE_SESSION_INVALID' };
      try {
        const value = JSON.parse(bytes.toString('utf8'));
        if (value && typeof value === 'object') error = value;
      } catch {
        /* Keep the upstream status without exposing a non-JSON authentication page. */
      }
      throw new HttpException(error, response.status);
    }
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new ServiceUnavailableException('WMS_NATIVE_RESPONSE_INVALID');
    try {
      const value = JSON.parse(bytes.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error();
      return value;
    } catch {
      throw new ServiceUnavailableException('WMS_NATIVE_RESPONSE_INVALID');
    }
  }
  private user(value: unknown, actorId: string, entity: string): NativeUser {
    const user = value as NativeUser;
    if (
      !user ||
      !Number.isSafeInteger(user.id) ||
      user.id < 1 ||
      user.erpSubject !== actorId ||
      user.entityId !== entity
    )
      throw new ForbiddenException('WMS_NATIVE_ACTOR_MISMATCH');
    return user;
  }
  private async authorize(
    base: string,
    actorId: string,
    entity: string,
    token: string,
    signal?: AbortSignal,
  ) {
    nativeSessionToken(token);
    const response = await this.request(base, '/api/auth/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal,
    });
    const data = await this.json(response);
    return this.user(data.user, actorId, entity);
  }
  async session(
    actorId: string,
    entity: string,
    input: { entry: string; nonce: string; entityId?: string },
  ) {
    const base = this.configuration(entity);
    if (input.entityId !== undefined && input.entityId !== entity)
      throw new ForbiddenException('WMS_NATIVE_ENTITY_MISMATCH');
    const identity = await this.portal.identity(actorId);
    if (identity.entityId !== entity)
      throw new ForbiddenException('WMS_NATIVE_ENTITY_MISMATCH');
    const issued = await this.portal.ticket(actorId, {
      entry: input.entry as never,
      nonce: input.nonce,
    });
    const response = await this.request(base, '/api/auth/erp/exchange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ticket: issued.ticket, nonce: input.nonce }),
    });
    const data = await this.json(response);
    const accessToken = nativeSessionToken(data.accessToken);
    this.user(data.user, actorId, entity);
    const user = await this.authorize(base, actorId, entity, accessToken);
    if (
      typeof data.destination !== 'string' ||
      !/^\/[A-Za-z0-9_/?=&.,:@-]*$/.test(data.destination) ||
      data.destination.startsWith('//')
    )
      throw new ServiceUnavailableException('WMS_NATIVE_DESTINATION_INVALID');
    return { accessToken, user, destination: data.destination };
  }
  async proxy(
    actorId: string,
    entity: string,
    token: string,
    input: ProxyRequest,
  ): Promise<NativeReply> {
    const base = this.configuration(entity),
      method = input.method.toUpperCase(),
      target = nativeBusinessTarget(input.target, method);
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
      throw new BadRequestException('WMS_NATIVE_METHOD_INVALID');
    const body = nativeBody(input.body);
    if (['GET', 'HEAD'].includes(method) && body?.length)
      throw new BadRequestException('WMS_NATIVE_BODY_INVALID');
    if (
      input.contentType &&
      (!/^(application\/json(?:\s*;[^\r\n]*)?|application\/x-www-form-urlencoded(?:\s*;[^\r\n]*)?|multipart\/form-data\s*;[^\r\n]+)$/i.test(
        input.contentType,
      ) ||
        input.contentType.length > 256)
    )
      throw new BadRequestException('WMS_NATIVE_CONTENT_TYPE_INVALID');
    await this.authorize(base, actorId, entity, token, input.signal);
    const transmittedBody = ['GET', 'HEAD'].includes(method) ? undefined : body;
    const response = await this.request(
      base,
      target,
      {
        method,
        signal: input.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: input.accept || 'application/json',
          ...(input.contentType && transmittedBody
            ? { 'Content-Type': input.contentType }
            : {}),
          ...(input.etag ? { 'If-None-Match': input.etag } : {}),
        },
        ...(transmittedBody
          ? { body: transmittedBody as unknown as BodyInit }
          : {}),
      },
      !['GET', 'HEAD'].includes(method),
    );
    return this.reply(response);
  }
  private async reply(
    response: Response,
    fallback?: string,
  ): Promise<NativeReply> {
    const headers: Record<string, string> = {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    for (const name of ['Content-Type', 'ETag', 'X-Request-ID']) {
      const value = response.headers.get(name);
      if (value) headers[name] = value;
    }
    const disposition = response.headers.get('content-disposition');
    if (disposition || fallback)
      headers['Content-Disposition'] = nativeDisposition(disposition, fallback);
    return {
      status: response.status,
      headers,
      body: await this.bytes(response),
    };
  }
  async file(
    actorId: string,
    entity: string,
    token: string,
    id: string,
    kind: string,
    signal?: AbortSignal,
  ): Promise<NativeReply> {
    const base = this.configuration(entity);
    if (
      !/^[1-9]\d{0,9}$/.test(id) ||
      !['ecount', 'ecount-grouped', 'prepick'].includes(kind)
    )
      throw new BadRequestException('WMS_NATIVE_FILE_INVALID');
    await this.authorize(base, actorId, entity, token, signal);
    const response = await this.request(
      base,
      `/api/marketplace-intakes/${id}/download-link`,
      {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ kind }),
      },
    );
    if (!response.ok) return this.reply(response);
    const data = await this.json(response),
      target = `/api/marketplace-files/${id}/${kind}`;
    if (data.url !== target)
      throw new ServiceUnavailableException('WMS_NATIVE_FILE_PATH_INVALID');
    const cookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie') || ''];
    const cookie = cookies
      .map(
        (value) =>
          /(?:^|,\s*)wms_marketplace_download=([A-Za-z0-9_.-]{1,8192})(?:;|$)/.exec(
            value,
          )?.[1],
      )
      .find(Boolean);
    if (!cookie)
      throw new ServiceUnavailableException('WMS_NATIVE_FILE_COOKIE_MISSING');
    await this.authorize(base, actorId, entity, token, signal);
    const file = await this.request(base, target, {
      method: 'GET',
      signal,
      headers: {
        Cookie: `wms_marketplace_download=${cookie}`,
        Accept:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
    return this.reply(file, file.ok ? `WMS-${id}-${kind}.xlsx` : undefined);
  }
}
