import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import request from 'supertest';
import { B2bAwareJwtAuthGuard } from '../../b2b/b2b-auth.guard';
import { B2bService } from '../../b2b/b2b.service';
import {
  WmsHandoverController,
  WmsReconciliationController,
} from './wms-handover.module';
import { WmsHandoverService } from './wms-handover.service';
import { HANDOVER_PATH } from './wms-handover.auth';
import { PERMISSIONS_KEY } from '../../../common/decorators/permissions.decorator';
import { ENTITY_ACCESS_MODULE_KEY } from '../../../common/decorators/entity-access.decorator';

describe('WMS handover HTTP boundary in closed DEV sandbox', () => {
  let app: INestApplication;
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const previous = { ...process.env };
  const service = {
    receive: jest.fn(async (body: any) => ({
      accepted: true,
      eventId: body.eventId,
      inboxId: 'inbox',
      duplicate: false,
    })),
  };
  const event = {
    contractVersion: 'corely.wms.handover.v1',
    eventId: randomUUID(),
    entityId: 'e',
    warehouseId: 'w',
    salesOrderId: 'order',
    nativeIntakeId: 1,
    wmsOrderId: 2,
    shipmentId: randomUUID(),
    sourceHash: 'a'.repeat(64),
    occurredAt: new Date().toISOString(),
    handover: { method: 'customer_pickup', operatorId: '5' },
    lines: [
      {
        shipmentLineId: randomUUID(),
        salesOrderLineId: 'source1',
        productId: 'p',
        sku: 'SKU',
        quantity: 1,
        packages: [{ packageId: 'B1', quantity: 1 }],
      },
    ],
  };
  beforeAll(async () => {
    Object.assign(process.env, {
      ERP_DEV_SANDBOX: 'true',
      WMS_HANDOVER_ENABLED: 'true',
      WMS_HANDOVER_PUBLIC_KEY: keys.publicKey,
      WMS_HANDOVER_JWT_ISSUER: 'wms-qa',
      WMS_HANDOVER_JWT_AUDIENCE: 'erp-qa',
    });
    const mod = await Test.createTestingModule({
      controllers: [WmsHandoverController],
      providers: [
        { provide: WmsHandoverService, useValue: service },
        { provide: B2bService, useValue: {} },
        { provide: APP_GUARD, useClass: B2bAwareJwtAuthGuard },
      ],
    }).compile();
    const expressApp = mod.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app = expressApp;
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    for (const key of Object.keys(process.env))
      if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  async function send(body: object, overrides = {}) {
    const wire = JSON.stringify(body),
      bodyHash = createHash('sha256').update(wire).digest('hex');
    const token = await new JwtService().signAsync(
      {
        entityId: 'e',
        scope: 'wms.shipment.handover',
        method: 'POST',
        path: HANDOVER_PATH,
        bodyHash,
        ...overrides,
      },
      {
        privateKey: keys.privateKey,
        algorithm: 'RS256',
        issuer: 'wms-qa',
        audience: 'erp-qa',
        expiresIn: 45,
      },
    );
    return request(app.getHttpServer())
      .post(HANDOVER_PATH)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(wire);
  }
  it('passes only signed service requests to pending receipt without creating an employee identity', async () => {
    const response = await send(event);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accepted: true,
      eventId: event.eventId,
    });
    expect(service.receive).toHaveBeenCalledWith(
      expect.objectContaining(event),
      createHash('sha256').update(JSON.stringify(event)).digest('hex'),
    );
  });
  it('accepts the same 200-character handover evidence limit as WMS', async () => {
    expect(
      (
        await send({
          ...event,
          handover: {
            ...event.handover,
            method: 'carrier_collection',
            carrier: 'C'.repeat(200),
            trackingNo: 'T'.repeat(200),
            manifestId: 'M'.repeat(200),
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send({
          ...event,
          handover: { ...event.handover, carrier: 'C'.repeat(201) },
        })
      ).status,
    ).toBe(400);
  });
  it('rejects an unsigned callback and a tenant-mismatched signed request', async () => {
    expect(
      (await request(app.getHttpServer()).post(HANDOVER_PATH).send(event))
        .status,
    ).toBe(401);
    expect((await send(event, { entityId: 'other' })).status).toBe(401);
  });
  it.each([
    { ...event, unauthorized: true },
    { ...event, handover: undefined },
    { ...event, nativeIntakeId: 0 },
    { ...event, lines: [{ ...event.lines[0], quantity: 0 }] },
    { ...event, lines: [{ ...event.lines[0], packages: [] }] },
  ])(
    'rejects malformed signed payloads before application writes',
    async (body) => {
      const before = service.receive.mock.calls.length;
      expect((await send(body)).status).toBe(400);
      expect(service.receive.mock.calls.length).toBe(before);
    },
  );
  it('requires company-scoped inventory update permission for human posting', () => {
    const reflector = new Reflector(),
      cls = WmsReconciliationController;
    expect(
      reflector.getAllAndOverride(ENTITY_ACCESS_MODULE_KEY, [
        cls.prototype.post,
        cls,
      ]),
    ).toBe('inventory');
    expect(
      reflector.getAllAndOverride(PERMISSIONS_KEY, [cls.prototype.post, cls]),
    ).toEqual(['inventory:read', 'inventory:update']);
  });
});
