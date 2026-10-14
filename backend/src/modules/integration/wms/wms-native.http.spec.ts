import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { raw } from 'express';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { WmsNativeController } from './wms-native.controller';
import {
  nativeBusinessTarget,
  nativeDisposition,
  WMS_NATIVE_BODY_LIMIT,
} from './wms-native.contract';
import {
  WmsNativeService,
  WMS_NATIVE_ENV,
  WMS_NATIVE_FETCH,
  WMS_NATIVE_PORTAL,
} from './wms-native.service';

describe('native WMS authenticated HTTP adapter', () => {
  const entity = 'warehouse-dev',
    token = 'fixture.header.signature',
    nonce = 'a'.repeat(64),
    ticket = 'b'.repeat(64);
  let app: NestExpressApplication, server: Server, base: string;
  const calls: {
    path: string;
    method: string;
    headers: Record<string, unknown>;
    body?: unknown;
    wireBody?: Buffer;
  }[] = [];
  let currentActor = 'erp-operator',
    currentEntity = entity,
    enabled = true,
    revokeAfterLink = false,
    fileTarget = '',
    transportFailure = false;
  const portal = {
    identity: jest.fn(async () => ({ entityId: entity })),
    ticket: jest.fn(async () => ({ ticket })),
  };
  const nativeUser = () => ({
    id: 41,
    username: 'test-fixture',
    role: 'picker',
    erpSubject: currentActor,
    entityId: currentEntity,
  });
  const browserOrigin = 'https://corely-erp-dev-sp5g377smq-de.a.run.app';
  beforeAll(async () => {
    const upstream = express();
    upstream.use(raw({ type: 'multipart/form-data', limit: '35mb' }));
    upstream.use(
      express.json({
        limit: '35mb',
        verify: (req, _res, bytes) => {
          (req as express.Request & { wireBody?: Buffer }).wireBody =
            Buffer.from(bytes);
        },
      }),
    );
    upstream.use((req, _res, next) => {
      calls.push({
        path: req.originalUrl,
        method: req.method,
        headers: req.headers,
        body: req.body,
        wireBody: (req as express.Request & { wireBody?: Buffer }).wireBody,
      });
      next();
    });
    upstream.get('/api/auth/me', (_req, res) =>
      enabled
        ? res.json({ user: nativeUser() })
        : res.status(401).json({ code: 'ERP_SESSION_REVOKED' }),
    );
    upstream.post('/api/auth/erp/exchange', (_req, res) =>
      res.json({
        user: nativeUser(),
        accessToken: token,
        destination: '/tasks?group=pick',
      }),
    );
    upstream.post('/api/orders/update_item', (req, res) => {
      if (transportFailure) return req.socket.destroy();
      res
        .status(409)
        .set({
          'X-Request-ID': 'fixture-request',
          'Set-Cookie': 'private=must-not-leak',
        })
        .json({
          code: 'REVISION_CHANGED',
          requestId: req.body.requestId,
          expectedActor: req.body.expectedActor,
        });
    });
    upstream.post('/api/orders/import', (_req, res) =>
      res.status(201).json({ imported: true }),
    );
    upstream.get('/api/orders/1/work-snapshot', (_req, res) =>
      res.json({ state: 'picking' }),
    );
    upstream.get('/api/users/basic', (_req, res) => res.json([]));
    upstream.post('/api/marketplace-intakes/17/download-link', (req, res) => {
      const path = `/api/marketplace-files/17/${req.body.kind}`;
      res.set(
        'Set-Cookie',
        `wms_marketplace_download=download.fixture.signature; Path=${path}; HttpOnly; SameSite=Strict`,
      );
      if (revokeAfterLink) enabled = false;
      res.json({ url: fileTarget || path, expiresIn: 120 });
    });
    upstream.get('/api/marketplace-files/17/prepick', (req, res) => {
      if (
        req.get('cookie') !==
        'wms_marketplace_download=download.fixture.signature'
      )
        return res.status(403).send('bad cookie');
      res
        .set({
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="WMS-17.xlsx"; filename*=UTF-8''${encodeURIComponent('預揀_測試.xlsx')}`,
          'Set-Cookie': 'must-not-leak=private',
        })
        .send(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    });
    server = upstream.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const module = await Test.createTestingModule({
      controllers: [WmsNativeController],
      providers: [
        WmsNativeService,
        { provide: WMS_NATIVE_PORTAL, useValue: portal },
        { provide: WMS_NATIVE_FETCH, useValue: fetch },
        {
          provide: WMS_NATIVE_ENV,
          useValue: {
            NODE_ENV: 'test',
            WMS_NATIVE_ENABLED: 'true',
            WMS_PORTAL_ENTITY_ID: entity,
            WMS_PORTAL_SERVICE_URL: base,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          if (req.get('authorization') !== 'Bearer erp-fixture') return false;
          req.user = { id: 'erp-operator' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({
        canActivate: (context: any) =>
          context.switchToHttp().getRequest().get('x-test-denied') !== 'true',
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      rawBody: true,
    });
    // Apply main.ts's existing CORS policy with the approved ERP origin fixture.
    // This does not add an origin or change runtime configuration.
    app.enableCors({
      origin: [browserOrigin],
      credentials: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      allowedHeaders: 'Content-Type, Accept, Authorization, X-DOA-Actor, X-WMS-Session, X-WMS-Entity, X-Repair-Report-Token, If-None-Match',
      exposedHeaders: 'Content-Disposition, X-Request-ID, ETag',
    });
    app.use(
      '/api/v1/wms/native/proxy',
      raw({ type: 'multipart/form-data', limit: WMS_NATIVE_BODY_LIMIT }),
    );
    app.useBodyParser('json', { limit: '50mb' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  beforeEach(() => {
    calls.length = 0;
    currentActor = 'erp-operator';
    currentEntity = entity;
    enabled = true;
    revokeAfterLink = false;
    fileTarget = '';
    transportFailure = false;
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const auth = (test: request.Test) =>
    test
      .set('Authorization', 'Bearer erp-fixture')
      .set('X-WMS-Session', token)
      .set('X-WMS-Entity', entity);
  it('keeps caller inspection behind the existing browser origin allowlist and ERP authorization', async () => {
    const path = '/api/v1/wms/native/proxy/api/auth/me';
    const preflight = (origin: string) => request(app.getHttpServer()).options(path)
      .set('Origin', origin).set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,x-wms-session,x-wms-entity');
    const allowed = await preflight(browserOrigin).expect(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(browserOrigin);
    const denied = await preflight('https://untrusted.invalid').expect(204);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    expect(calls).toHaveLength(0);
    const unauthenticated = await request(app.getHttpServer()).get(path).set('Origin', 'https://untrusted.invalid').expect(403);
    expect(unauthenticated.headers['access-control-allow-origin']).toBeUndefined();
    expect(calls).toHaveLength(0);
    const response = await auth(request(app.getHttpServer()).get(path)).set('Origin', browserOrigin).expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(browserOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
  it('rechecks only the current authenticated WMS caller for the mounted app', async () => {
    const response = await auth(
      request(app.getHttpServer()).get('/api/v1/wms/native/proxy/api/auth/me'),
    ).expect(200);
    expect(response.body).toEqual({ user: nativeUser() });
    expect(calls.map((call) => call.path)).toEqual(['/api/auth/me', '/api/auth/me']);
    expect(calls.every((call) => call.method === 'GET' && call.body === undefined)).toBe(true);
    expect(calls.every((call) => call.headers.authorization === `Bearer ${token}`)).toBe(true);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  it('denies auth mutation, alternate paths, query strings and inspection bodies before upstream reads', async () => {
    // Superagent normalizes an empty '?' before sending; cover that raw input below.
    expect(() => nativeBusinessTarget('/api/auth/me?', 'GET')).toThrow();
    for (const path of ['/api/auth/me?userId=other', '/api/auth/me/', '/api/auth/login', '/api/auth/erp/exchange', '/api/auth/erp/inspect'])
      await auth(request(app.getHttpServer()).get('/api/v1/wms/native/proxy' + path)).expect(403);
    for (const method of ['post', 'put', 'patch', 'delete', 'head'] as const)
      await auth(request(app.getHttpServer())[method]('/api/v1/wms/native/proxy/api/auth/me')).expect(403);
    await auth(request(app.getHttpServer()).get('/api/v1/wms/native/proxy/api/auth/me'))
      .send({ userId: 'other' }).expect(400);
    expect(calls).toHaveLength(0);
  });
  it('retains ERP permissions, company, current subject and revocation checks for caller inspection', async () => {
    const read = () => auth(request(app.getHttpServer()).get('/api/v1/wms/native/proxy/api/auth/me'));
    await read().set('X-Test-Denied', 'true').expect(403);
    await read().set('X-WMS-Entity', 'other').expect(403);
    expect(calls).toHaveLength(0);
    currentActor = 'different-operator';
    await read().expect(403);
    expect(calls).toHaveLength(1);
    currentActor = 'erp-operator'; currentEntity = 'other';
    await read().expect(403);
    expect(calls).toHaveLength(2);
    currentEntity = entity; enabled = false;
    await read().expect(401);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.path === '/api/auth/me')).toBe(true);
  });
  it('exchanges only a nonce-bound ERP ticket and rechecks the resulting WMS subject', async () => {
    const response = await auth(
      request(app.getHttpServer()).post('/api/v1/wms/native/session'),
    )
      .send({ entry: 'picking', nonce, entityId: entity })
      .expect(201);
    expect(response.body).toMatchObject({
      accessToken: token,
      user: { erpSubject: 'erp-operator', entityId: entity },
      destination: '/tasks?group=pick',
    });
    expect(portal.ticket).toHaveBeenCalledWith('erp-operator', {
      entry: 'picking',
      nonce,
    });
    expect(calls.map((call) => call.path)).toEqual([
      '/api/auth/erp/exchange',
      '/api/auth/me',
    ]);
    expect(calls[0].body).toEqual({ ticket, nonce });
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].headers['x-erp-service-key']).toBeUndefined();
    expect(response.headers['cache-control']).toContain('no-store');
  });
  it('rejects session DTO injection, nonce errors, company mismatch and missing ERP permission before exchange', async () => {
    for (const body of [
      { entry: 'picking', nonce, role: 'admin' },
      { entry: 'picking', nonce: 'invalid' },
      { entry: 'native-intake', nonce },
    ])
      await auth(
        request(app.getHttpServer()).post('/api/v1/wms/native/session'),
      )
        .send(body)
        .expect(400);
    await auth(request(app.getHttpServer()).post('/api/v1/wms/native/session'))
      .send({ entry: 'picking', nonce, entityId: 'other' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/wms/native/session')
      .send({ entry: 'picking', nonce })
      .expect(403);
    await auth(request(app.getHttpServer()).post('/api/v1/wms/native/session'))
      .set('X-Test-Denied', 'true')
      .send({ entry: 'picking', nonce })
      .expect(403);
    expect(calls).toHaveLength(0);
    expect(portal.ticket).not.toHaveBeenCalled();
  });
  it('requires the real wms_tasks grant on every native handler, independently of inventory or picking rights', async () => {
    const context = (handler: string) =>
      ({
        getClass: () => WmsNativeController,
        getHandler: () => WmsNativeController.prototype[handler],
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 'erp-operator' } }),
        }),
      }) as any;
    const guard = (permissions: string[]) =>
      new PermissionsGuard(new Reflector(), {
        userRole: {
          findMany: async () => [
            {
              role: {
                code: 'STAFF',
                permissions: permissions.map((value) => {
                  const [resource, action] = value.split(':');
                  return { permission: { resource, action } };
                }),
              },
            },
          ],
        },
      } as any);
    for (const handler of ['session', 'proxy', 'file']) {
      await expect(
        guard(['inventory:read', 'wms_picking:execute']).canActivate(
          context(handler),
        ),
      ).rejects.toThrow('wms_tasks:read');
      await expect(
        guard(['wms_tasks:read']).canActivate(context(handler)),
      ).resolves.toBe(true);
    }
  });
  it('does not expose an exchanged session belonging to another ERP actor', async () => {
    currentActor = 'another-operator';
    await auth(request(app.getHttpServer()).post('/api/v1/wms/native/session'))
      .send({ entry: 'picking', nonce })
      .expect(403);
    expect(calls.map((call) => call.path)).toEqual(['/api/auth/erp/exchange']);
  });
  it('preserves command UUID/state/actor and upstream error status/body without browser cookies or service headers', async () => {
    const rawJson =
      '{ "requestId": "91f8e07b-eef0-4d04-ad9a-966cdfc510b1", "expectedActor": 41, "state": "picking", "revision": 12 }';
    const response = await auth(
      request(app.getHttpServer()).post(
        '/api/v1/wms/native/proxy/api/orders/update_item?source=TEST%3A1',
      ),
    )
      .set('Content-Type', 'application/json')
      .set('Cookie', 'stolen=value')
      .set('X-ERP-Service-Key', 'must-not-forward')
      .send(rawJson)
      .expect(409);
    expect(response.body).toEqual({
      code: 'REVISION_CHANGED',
      requestId: '91f8e07b-eef0-4d04-ad9a-966cdfc510b1',
      expectedActor: 41,
    });
    expect(calls[1]).toMatchObject({
      path: '/api/orders/update_item?source=TEST%3A1',
      method: 'POST',
      body: JSON.parse(rawJson),
    });
    expect(calls[1].wireBody).toEqual(Buffer.from(rawJson));
    expect(calls[1].headers.authorization).toBe(`Bearer ${token}`);
    expect(calls[1].headers.cookie).toBeUndefined();
    expect(calls[1].headers['x-erp-service-key']).toBeUndefined();
    expect(response.headers['x-request-id']).toBe('fixture-request');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  it('denies other ERP actors, other warehouse companies, local WMS accounts and revoked sessions before business requests', async () => {
    for (const change of [
      () => {
        currentActor = 'another-operator';
      },
      () => {
        currentActor = '';
      },
      () => {
        currentEntity = 'other';
      },
      () => {
        enabled = false;
      },
    ]) {
      change();
      await auth(
        request(app.getHttpServer()).get(
          '/api/v1/wms/native/proxy/api/orders/1/work-snapshot',
        ),
      ).expect(enabled ? 403 : 401);
      currentActor = 'erp-operator';
      currentEntity = entity;
      enabled = true;
    }
    expect(calls.every((call) => call.path === '/api/auth/me')).toBe(true);
    await auth(
      request(app.getHttpServer()).get(
        '/api/v1/wms/native/proxy/api/orders/1/work-snapshot',
      ),
    )
      .set('X-WMS-Entity', 'other')
      .expect(403);
    await auth(
      request(app.getHttpServer()).get(
        '/api/v1/wms/native/proxy/api/orders/1/work-snapshot',
      ),
    )
      .set('X-WMS-Session', 'not-a-jwt')
      .expect(403);
  });
  it('denies arbitrary URLs, encoded traversal, internal routes and the generic download cookie endpoint', async () => {
    for (const target of [
      'api/auth/login',
      'api/auth/erp/bind',
      'api/integrations/erp/v1/orders',
      'api/logistics-callbacks/ecpay',
      'api/admin/bootstrap/superadmin',
      'api/admin/maintenance/retention/run',
      'api/orders/%2f..%2fauth/login',
      'api/marketplace-files/17/prepick',
      'api/marketplace-intakes/17/download-link',
      'https://other.invalid/api/orders',
    ])
      await auth(
        request(app.getHttpServer()).post('/api/v1/wms/native/proxy/' + target),
      )
        .send({})
        .expect(403);
    expect(calls).toHaveLength(0);
    await auth(
      request(app.getHttpServer()).get(
        '/api/v1/wms/native/proxy/api/users/basic',
      ),
    ).expect(200);
  });
  it('forwards multipart field identities and file bytes using the exact original boundary', async () => {
    await auth(
      request(app.getHttpServer()).post(
        '/api/v1/wms/native/proxy/api/orders/import',
      ),
    )
      .field('requestId', '91f8e07b-eef0-4d04-ad9a-966cdfc510b1')
      .attach('file', Buffer.from('TEST,SKU,3\n'), 'TEST-import.csv')
      .expect(201);
    const upload = calls[1];
    expect(Buffer.isBuffer(upload.body)).toBe(true);
    const body = (upload.body as Buffer).toString('utf8');
    expect(body).toContain('91f8e07b-eef0-4d04-ad9a-966cdfc510b1');
    expect(body).toContain('TEST,SKU,3\n');
    const boundary = String(upload.headers['content-type']).split(
      'boundary=',
    )[1];
    expect(body).toContain('--' + boundary);
  });
  it('keeps the download cookie private and preserves binary XLSX plus its Chinese filename', async () => {
    const response = await auth(
      request(app.getHttpServer()).post('/api/v1/wms/native/files/17/prepick'),
    )
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    // Explicit upstream status overrides Nest's default POST status.
    expect(response.status).toBe(200);
    expect(response.body).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['content-disposition']).toContain(
      encodeURIComponent('預揀_測試.xlsx'),
    );
    expect(calls.map((call) => call.path)).toEqual([
      '/api/auth/me',
      '/api/marketplace-intakes/17/download-link',
      '/api/auth/me',
      '/api/marketplace-files/17/prepick',
    ]);
    expect(calls[3].headers.authorization).toBeUndefined();
  });
  it('blocks a switched actor and arbitrary file target between link issue and download', async () => {
    revokeAfterLink = true;
    await auth(
      request(app.getHttpServer()).post('/api/v1/wms/native/files/17/prepick'),
    ).expect(401);
    expect(
      calls.some((call) => call.path.startsWith('/api/marketplace-files')),
    ).toBe(false);
    enabled = true;
    revokeAfterLink = false;
    calls.length = 0;
    fileTarget = 'https://other.invalid/secret';
    await auth(
      request(app.getHttpServer()).post('/api/v1/wms/native/files/17/prepick'),
    ).expect(503);
    expect(
      calls.some((call) => call.path.startsWith('/api/marketplace-files')),
    ).toBe(false);
  });
  it('does not retry a command after transport loss and reports an unknown result', async () => {
    transportFailure = true;
    const response = await auth(
      request(app.getHttpServer()).post(
        '/api/v1/wms/native/proxy/api/orders/update_item',
      ),
    )
      .send({ requestId: 'fixed-original-uuid', state: 'picking' })
      .expect(503);
    expect(response.body.code).toBe('WMS_NATIVE_RESULT_UNKNOWN');
    expect(
      calls.filter((call) => call.path === '/api/orders/update_item'),
    ).toHaveLength(1);
  });
  it('rejects oversized native JSON and multipart uploads before a business call', async () => {
    await auth(
      request(app.getHttpServer()).post(
        '/api/v1/wms/native/proxy/api/orders/update_item',
      ),
    )
      .send({ data: 'x'.repeat(WMS_NATIVE_BODY_LIMIT) })
      .expect(413);
    await auth(
      request(app.getHttpServer()).post(
        '/api/v1/wms/native/proxy/api/orders/import',
      ),
    )
      .attach('file', Buffer.alloc(WMS_NATIVE_BODY_LIMIT), 'oversized.csv')
      .expect(413);
    expect(calls).toHaveLength(0);
  });
  it('sanitizes attachment filenames and rejects path normalization tricks', () => {
    expect(
      nativeDisposition(
        "attachment; filename*=UTF-8''..%2Fsecret%0D%0Aname.xlsx",
      ),
    ).toContain('.._secret__name.xlsx');
    expect(
      nativeDisposition("attachment; filename*=UTF-8''%INVALID"),
    ).toContain('WMS-download');
    expect(
      nativeDisposition('attachment; filename="broken\uD800name.xlsx"'),
    ).toContain('broken_name.xlsx');
    for (const path of [
      '/api/orders/../auth/me',
      '/api/orders//auth/me',
      '/api/orders/%252e%252e/auth/me',
      '/api/orders/1#fragment',
    ])
      expect(() => nativeBusinessTarget(path)).toThrow();
  });
});
