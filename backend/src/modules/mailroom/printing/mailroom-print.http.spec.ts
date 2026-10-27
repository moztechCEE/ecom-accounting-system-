/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- Supertest response bodies and the synthetic mutable repository intentionally have dynamic shapes; real production DTOs and guards remain active. */
import 'reflect-metadata';
import {
  Controller,
  Get,
  INestApplication,
  Post,
  SetMetadata,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EntityAccessService } from '../../../common/entity-access/entity-access.service';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { JwtStrategy } from '../../auth/strategies/jwt.strategy';
import { AuthService } from '../../auth/auth.service';
import { B2bService } from '../../b2b/b2b.service';
import { B2bAwareJwtAuthGuard } from '../../b2b/b2b-auth.guard';
import { ERP_AFTER_SALES_SERVICE_AUTH } from '../../integration/after-sales/erp-module.contract';
import { WMS_HANDOVER_AUTH } from '../../integration/wms/wms-handover.auth';
import { MAILROOM_SERVICE_AUTH } from '../mailroom.auth';
import { MailroomController } from '../mailroom.controller';
import { MailroomService } from '../mailroom.service';
import { MailroomIntakeService } from '../mailroom-intake.service';
import { MailroomOutboundController } from '../mailroom-outbound.controller';
import { MailroomOutboundService } from '../mailroom-outbound.service';
import { RepairWorkbenchController } from '../repair-workbench.controller';
import { RepairWorkbenchService } from '../repair-workbench.service';
import { RepairTodoService } from '../repair-todo.service';
import { InventoryController } from '../../inventory/inventory.controller';
import { InventoryService } from '../../inventory/inventory.service';
import { ApController } from '../../ap/ap.controller';
import { ApService } from '../../ap/ap.service';
import { MailroomPrintController } from './mailroom-print.controller';
import { MailroomPrintService } from './mailroom-print.service';
import {
  MAILROOM_PRINT_DEVICE_AUTH,
  MailroomPrintDeviceAuth,
  MailroomPrintDeviceGuard,
} from './mailroom-print.auth';
import {
  COMPANY,
  CREATOR,
  DEVICE,
  DEVICE2,
  ITEM,
  OTHER_COMPANY,
  OWNER,
  printFixture,
  TOKEN,
} from '../../../../test/helpers/mailroom-print.fixture';

// These legacy handlers must never execute in the printer-token tests. Avoid loading
// their unrelated cloud SDK; the actual controllers, JWT strategy and both guards run.
jest.mock('../repair-media-storage.service', () => ({
  RepairMediaStorageService: class RepairMediaStorageService {},
}));

const SECRET = 'synthetic-local-test-jwt-secret-no-external-credentials';
const jwt = new JwtService({ secret: SECRET });
const tokenFor = (id = CREATOR) =>
  jwt.sign({ sub: id, email: id + '@example.test' });

describe('actual Nest global device verifier and existing JWT pipeline over loopback HTTP', () => {
  let env: NodeJS.ProcessEnv,
    f: ReturnType<typeof printFixture>,
    app: INestApplication,
    url: string;
  let validateUser: jest.Mock, guard: MailroomPrintDeviceGuard;
  const extraApps: INestApplication[] = [];
  async function makeApp(controllers: any[], missingVerifier = false) {
    const b2b = { authenticate: f.oldBusiness, ensureEnabled: f.oldBusiness };
    validateUser = jest.fn((id: string) =>
      Promise.resolve(f.users.has(id) ? { id } : null),
    );
    const module = await Test.createTestingModule({
      controllers,
      providers: [
        Reflector,
        JwtStrategy,
        MailroomPrintDeviceGuard,
        { provide: ConfigService, useValue: { get: () => SECRET } },
        { provide: AuthService, useValue: { validateUser } },
        { provide: PrismaService, useValue: f.db },
        { provide: MailroomPrintService, useValue: f.service },
        { provide: MailroomService, useValue: f.mailroom },
        { provide: B2bService, useValue: b2b },
        {
          provide: MailroomIntakeService,
          useValue: { queue: f.oldBusiness, command: f.oldBusiness },
        },
        {
          provide: MailroomOutboundService,
          useValue: {
            sources: f.oldBusiness,
            warehouses: f.oldBusiness,
            list: f.oldBusiness,
            detail: f.oldBusiness,
            create: f.oldBusiness,
            command: f.oldBusiness,
          },
        },
        {
          provide: RepairWorkbenchService,
          useValue: {
            workflow: f.oldBusiness,
            documents: f.oldBusiness,
            save: f.oldBusiness,
            customerQueue: f.oldBusiness,
          },
        },
        { provide: RepairTodoService, useValue: { list: f.oldBusiness } },
        {
          provide: InventoryService,
          useValue: {
            getWarehouses: f.oldBusiness,
            createWarehouse: f.oldBusiness,
            getSnapshotsForProduct: f.oldBusiness,
            importLegacyErpInventory: f.oldBusiness,
          },
        },
        {
          provide: EntityAccessService,
          useValue: { assertAccess: f.oldBusiness },
        },
        { provide: ApService, useValue: { recordPayment: f.oldBusiness } },
        {
          provide: APP_GUARD,
          useFactory: (
            reflector: Reflector,
            deviceGuard: MailroomPrintDeviceGuard,
          ) =>
            new B2bAwareJwtAuthGuard(
              reflector,
              b2b as any,
              missingVerifier ? undefined : deviceGuard,
            ),
          inject: [Reflector, MailroomPrintDeviceGuard],
        },
      ],
    }).compile();
    const created = module.createNestApplication({ logger: false });
    created.setGlobalPrefix('api/v1');
    created.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await created.listen(0, '127.0.0.1');
    return {
      app: created,
      url: await created.getUrl(),
      guard: module.get(MailroomPrintDeviceGuard),
    };
  }
  beforeEach(async () => {
    env = { ...process.env };
    Object.assign(process.env, {
      MAILROOM_ENABLED: 'true',
      MAILROOM_PRINT_ENABLED: 'true',
      ERP_DEV_SANDBOX: 'true',
      ERP_PUBLIC_FRONTEND_URL: 'https://erp.example.test',
    });
    f = printFixture();
    f.seedDevice();
    const created = await makeApp([
      MailroomPrintController,
      MailroomController,
      MailroomOutboundController,
      RepairWorkbenchController,
      InventoryController,
      ApController,
    ]);
    ({ app, url, guard } = created);
  });
  afterEach(async () => {
    await app.close();
    for (const extra of extraApps.splice(0)) await extra.close();
    process.env = env;
  });
  const devicePost = (path: string, id = DEVICE, token = TOKEN) =>
    request(url)
      .post('/api/v1/mailroom/print-device/' + path)
      .set('x-corely-print-device', id)
      .set('Authorization', 'Bearer ' + token);
  const browserPost = (path: string, actor = CREATOR) =>
    request(url)
      .post('/api/v1/mailroom/' + path)
      .set('Authorization', 'Bearer ' + tokenFor(actor))
      .set('Origin', 'https://erp.example.test');

  it('awaits real device authentication before claim and never creates req.user from a device token', async () => {
    const authenticate = jest.spyOn(f.service, 'authenticateDevice');
    const claim = jest.spyOn(f.service, 'claim');
    let release!: () => void;
    authenticate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(f.identity());
        }),
    );
    let settled = false;
    const pending = devicePost('claim')
      .send({})
      .then((response) => {
        settled = true;
        return response;
      });
    for (let i = 0; i < 20 && !authenticate.mock.calls.length; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(claim).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    release();
    expect((await pending).status).toBe(201);
    expect(validateUser).not.toHaveBeenCalled();
    expect(claim.mock.calls[0][0]).toEqual(f.identity());
  });
  it('rejects missing, malformed, wrong, revoked and expired tokens before any employee/job/business reads', async () => {
    const attempts = [
      () => request(url).post('/api/v1/mailroom/print-device/claim').send({}),
      () => devicePost('claim', DEVICE, 'bad').send({}),
      () =>
        devicePost(
          'claim',
          DEVICE,
          Buffer.alloc(32, 8).toString('base64url'),
        ).send({}),
    ];
    for (const attempt of attempts) await attempt().expect(401);
    f.devices.get(DEVICE)!.revokedAt = new Date();
    await devicePost('claim').send({}).expect(401);
    f.devices.get(DEVICE)!.revokedAt = null;
    f.devices.get(DEVICE)!.tokenExpiresAt = new Date(Date.now() - 1);
    await devicePost('claim').send({}).expect(401);
    expect(f.db.user.findUnique).not.toHaveBeenCalled();
    expect(f.db.employee.findFirst).not.toHaveBeenCalled();
    expect(f.db.mailroomPrintJob.findFirst).not.toHaveBeenCalled();
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });
  it.each(['active', 'employee', 'permission', 'company'])(
    'checks current owner %s inside the real verifier before claim',
    async (mode) => {
      const owner = f.users.get(OWNER)!;
      if (mode === 'active') owner.active = false;
      if (mode === 'employee') owner.employeeActive = false;
      if (mode === 'permission') owner.permissions = ['mailroom:read'];
      if (mode === 'company') owner.entities = [OTHER_COMPANY];
      await devicePost('claim').send({}).expect(403);
      expect(f.db.mailroomPrintJob.findFirst).not.toHaveBeenCalled();
      expect(f.oldBusiness).not.toHaveBeenCalled();
    },
  );
  it('creates trusted server PDF, resolves retry by request, and enforces device-bound document/receipt HTTP access', async () => {
    const body = f.body();
    const made = await browserPost('print-jobs').send(body).expect(201);
    const id = made.body.id;
    await request(url)
      .get(
        '/api/v1/mailroom/print-jobs/by-request/' +
          body.requestId +
          '?entityId=' +
          COMPANY,
      )
      .set('Authorization', 'Bearer ' + tokenFor())
      .expect(200)
      .expect((response) => expect(response.body.id).toBe(id));
    const claim = await devicePost('claim').send({}).expect(201);
    expect(claim.body.job.id).toBe(id);
    expect(claim.body.job.pdfBytes).toBe(18);
    f.seedDevice(DEVICE2);
    await request(url)
      .get(claim.body.job.documentPath)
      .set('x-corely-print-device', DEVICE2)
      .set('Authorization', 'Bearer ' + TOKEN)
      .expect(404);
    await devicePost('jobs/' + id + '/receipt', DEVICE2)
      .send({ state: 'SUBMITTING' })
      .expect(404);
    await request(url)
      .get(claim.body.job.documentPath)
      .set('x-corely-print-device', DEVICE)
      .set('Authorization', 'Bearer ' + TOKEN)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    await devicePost('jobs/' + id + '/receipt')
      .send({ state: 'SUBMITTING' })
      .expect(201);
    await devicePost('claim').send({}).expect(201).expect({ job: null });
    await devicePost('jobs/' + id + '/receipt')
      .send({ state: 'SUBMITTED', cupsJobId: 'Xprinter_XP-235B-5' })
      .expect(201);
    expect(f.jobs.get(id)!.pdfBytes).toBeNull();
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });
  it('rejects arbitrary document/URL/options and unauthorized origin without constructing or inserting a job', async () => {
    await browserPost('print-jobs')
      .send({
        ...f.body(),
        pdf: '%PDF-malicious',
        url: 'http://metadata.google.internal/',
        printer: 'Other',
        command: 'lp',
      })
      .expect(400);
    await request(url)
      .post('/api/v1/mailroom/print-jobs')
      .set('Authorization', 'Bearer ' + tokenFor())
      .set('Origin', 'https://evil.example.test')
      .send(f.body())
      .expect(403);
    await browserPost('print-jobs')
      .send(f.body({ entityId: OTHER_COMPANY }))
      .expect(403);
    expect(f.labels.read).not.toHaveBeenCalled();
    expect(f.jobs.size).toBe(0);
  });
  it('previews display-only edits through normal staff/company/Origin authorization without creating a job', async () => {
    const response = await browserPost('print-label-preview')
      .send({
        entityId: COMPANY,
        itemId: ITEM,
        labelEdit: {
          expectedVersion: 3,
          customerName: '王小明',
          customerIssue: '無法充電',
        },
      })
      .expect(201)
      .expect('Content-Type', /application\/pdf/)
      .expect('Cache-Control', 'private, no-store');
    expect(Buffer.from(response.body).toString()).toBe('%PDF-SYNTHETIC-PDF');
    expect(f.jobs.size).toBe(0);
    expect(f.db.mailroomPrintJob.create).not.toHaveBeenCalled();
    expect(f.db.mailroomPrintJob.updateMany).not.toHaveBeenCalled();
    expect(f.db.mailroomPrintDevice.findFirst).not.toHaveBeenCalled();
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });
  it('rejects nested display injection, nulls, duplicate identities and mismatched preview identities before rendering', async () => {
    const attacks = [
      { itemId: ITEM, qrLink: 'https://evil.example.test' },
      { itemId: ITEM, customerName: null },
      { itemId: ITEM, customerIssue: 'A\nB' },
      { itemId: ITEM, productName: '字'.repeat(121) },
      { itemId: DEVICE, customerName: 'Other item' },
    ];
    for (const labelEdit of attacks)
      await browserPost('print-label-preview')
        .send({ entityId: COMPANY, itemId: ITEM, labelEdit })
        .expect(400);
    await browserPost('print-label-preview')
      .send({ entityId: COMPANY, itemId: ITEM, labelEdit: null })
      .expect(400);
    await browserPost('print-jobs')
      .send({ ...f.body(), labelEdits: [{ customerName: 'No identity' }] })
      .expect(400);
    await browserPost('print-jobs')
      .send({ ...f.body(), labelEdits: [{ itemId: ITEM }, { itemId: ITEM }] })
      .expect(400);
    await browserPost('print-jobs')
      .send({ ...f.body(), labelEdits: [{ itemId: ITEM, pdf: '%PDF-forged' }] })
      .expect(400);
    expect(f.labels.read).not.toHaveBeenCalled();
    expect(f.exporter.pdfMany).not.toHaveBeenCalled();
    expect(f.jobs.size).toBe(0);
  });
  it('denies preview to cross-company staff, foreign origins and printer capabilities', async () => {
    const body = { entityId: COMPANY, itemId: ITEM };
    await browserPost('print-label-preview')
      .send({ ...body, entityId: OTHER_COMPANY })
      .expect(403);
    await request(url)
      .post('/api/v1/mailroom/print-label-preview')
      .set('Authorization', 'Bearer ' + tokenFor())
      .set('Origin', 'https://evil.example.test')
      .send(body)
      .expect(403);
    await request(url)
      .post('/api/v1/mailroom/print-label-preview')
      .set('x-corely-print-device', DEVICE)
      .set('Authorization', 'Bearer ' + TOKEN)
      .set('Origin', 'https://erp.example.test')
      .send(body)
      .expect(401);
    expect(f.labels.read).not.toHaveBeenCalled();
    expect(f.jobs.size).toBe(0);
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });
  it('returns an actionable version conflict for stale display-only preview and print, without a job or PDF', async () => {
    const labelEdit = {
      itemId: ITEM,
      expectedVersion: 2,
      customerIssue: '舊版文字',
    };
    for (const response of [
      await browserPost('print-label-preview')
        .send({ entityId: COMPANY, itemId: ITEM, labelEdit })
        .expect(409),
      await browserPost('print-jobs')
        .send({ ...f.body(), labelEdits: [labelEdit] })
        .expect(409),
    ]) {
      expect(response.body).toEqual({
        code: 'LABEL_VERSION_CHANGED',
        message: '物件已更新，請重新載入標籤',
      });
    }
    expect(f.exporter.pdfMany).not.toHaveBeenCalled();
    expect(f.jobs.size).toBe(0);
    expect(f.db.mailroomPrintJob.create).not.toHaveBeenCalled();
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });
  it('returns same-device terminal 409 proof for expiry ACK races while cross-device 404 has no proof', async () => {
    const body = f.body();
    const made = await browserPost('print-jobs').send(body).expect(201);
    const id = made.body.id;
    await devicePost('claim').send({}).expect(201);
    f.jobs.get(id)!.expiresAt = new Date(Date.now() - 1);
    await request(url)
      .get('/api/v1/mailroom/print-jobs/' + id + '?entityId=' + COMPANY)
      .set('Authorization', 'Bearer ' + tokenFor())
      .expect(200);
    const saved = structuredClone(f.jobs.get(id)!);
    for (const state of ['FAILED', 'UNKNOWN']) {
      const response = await devicePost('jobs/' + id + '/receipt')
        .send({
          state,
          errorCode:
            state === 'FAILED' ? 'PRINTER_UNAVAILABLE' : 'SUBMISSION_UNCERTAIN',
        })
        .expect(409);
      expect(response.body).toMatchObject({
        message: 'PRINT_RECEIPT_TERMINAL_CONFLICT',
        current: {
          id,
          deviceId: DEVICE,
          requestId: body.requestId,
          status: 'FAILED',
          pages: 1,
          cupsJobId: null,
          errorCode: 'EXPIRED',
        },
      });
      expect(response.body.current).not.toHaveProperty('pdfBytes');
      expect(response.body.current).not.toHaveProperty('itemIds');
    }
    expect(f.jobs.get(id)).toEqual(saved);
    f.seedDevice(DEVICE2);
    const denied = await devicePost('jobs/' + id + '/receipt', DEVICE2)
      .send({ state: 'UNKNOWN', errorCode: 'SUBMISSION_UNCERTAIN' })
      .expect(404);
    expect(denied.body).not.toHaveProperty('current');
  });
  it('blocks one-use redeem races, wrong/expired codes and rate-limits before additional device reads', async () => {
    const pair = await browserPost('print-devices/pair', OWNER)
      .send({ entityId: COMPANY, name: 'Synthetic' })
      .expect(201);
    const redeem = () =>
      request(url)
        .post('/api/v1/mailroom/print-device/redeem')
        .send({ deviceId: pair.body.deviceId, code: pair.body.pairCode });
    const responses = await Promise.all([redeem(), redeem()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 401,
    ]);
    const id = randomUUID();
    for (let i = 0; i < 8; i++)
      await request(url)
        .post('/api/v1/mailroom/print-device/redeem')
        .send({ deviceId: id, code: TOKEN })
        .expect(401);
    const reads = f.db.mailroomPrintDevice.findUnique.mock.calls.length;
    await request(url)
      .post('/api/v1/mailroom/print-device/redeem')
      .send({ deviceId: id, code: TOKEN })
      .expect(429);
    expect(f.db.mailroomPrintDevice.findUnique.mock.calls.length).toBe(reads);
    expect((guard as any).attempts.size).toBeLessThanOrEqual(2048);
  });
  it.each([
    ['get', '/mailroom/items/' + ITEM + '?entityId=' + COMPANY],
    ['post', '/mailroom/items/' + ITEM + '/actions'],
    ['post', '/mailroom/outbound/orders'],
    ['post', '/repair-workbench/items/' + ITEM + '/workflow'],
    ['post', '/inventory/warehouses'],
    ['post', '/ap/invoices/' + ITEM + '/pay'],
  ])(
    'printer bearer cannot enter existing %s %s, with zero business reads/writes',
    async (method, path) => {
      const call = (request(url) as any)
        [method]('/api/v1' + path)
        .set('x-corely-print-device', DEVICE)
        .set('Authorization', 'Bearer ' + TOKEN);
      await (
        method === 'post' ? call.send({ entityId: COMPANY }) : call
      ).expect(401);
      expect(validateUser).not.toHaveBeenCalled();
      expect(f.db.user.findUnique).not.toHaveBeenCalled();
      expect(f.db.mailroomItem.findMany).not.toHaveBeenCalled();
      expect(f.oldBusiness).not.toHaveBeenCalled();
    },
  );
  it('denies exact handler path/query mismatches before device verification', async () => {
    await devicePost('claim?extra=1').send({}).expect(401);
    expect(f.db.mailroomPrintDevice.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    IS_PUBLIC_KEY,
    ERP_AFTER_SALES_SERVICE_AUTH,
    WMS_HANDOVER_AUTH,
    MAILROOM_SERVICE_AUTH,
    'b2bAuthMode',
  ])(
    'rejects mixed metadata %s before every legacy bypass and device read',
    async (marker) => {
      @Controller('mailroom/print-device')
      class Mixed {
        @Post('claim')
        @MailroomPrintDeviceAuth()
        @SetMetadata(marker, marker === 'b2bAuthMode' ? 'login' : true)
        claim() {
          return f.oldBusiness();
        }
      }
      const created = await makeApp([Mixed]);
      extraApps.push(created.app);
      await request(created.url)
        .post('/api/v1/mailroom/print-device/claim')
        .set('x-corely-print-device', DEVICE)
        .set('Authorization', 'Bearer ' + TOKEN)
        .send({})
        .expect(401);
      expect(f.db.mailroomPrintDevice.findUnique).not.toHaveBeenCalled();
      expect(f.oldBusiness).not.toHaveBeenCalled();
    },
  );
  it('rejects class-only, inherited and wrong-method markers and absent verifier without a fallback', async () => {
    @Controller('mailroom/print-device')
    @MailroomPrintDeviceAuth()
    class ClassOnly {
      @Post('claim') claim() {
        return f.oldBusiness();
      }
    }
    @Controller('mailroom/print-device')
    class WrongMethod {
      @Get('claim') @MailroomPrintDeviceAuth() claim() {
        return f.oldBusiness();
      }
    }
    @Controller('mailroom/print-device')
    class Inherited {
      @Post('claim') claim() {
        return f.oldBusiness();
      }
    }
    const ancestor = () => {};
    Reflect.defineMetadata(MAILROOM_PRINT_DEVICE_AUTH, 'device', ancestor);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Intentionally mutate this handler function's metadata inheritance; it is not invoked unbound.
    Object.setPrototypeOf(Inherited.prototype.claim, ancestor);
    for (const controller of [ClassOnly, WrongMethod, Inherited]) {
      const created = await makeApp([controller]);
      extraApps.push(created.app);
      const call =
        controller === WrongMethod
          ? request(created.url).get('/api/v1/mailroom/print-device/claim')
          : request(created.url).post('/api/v1/mailroom/print-device/claim');
      await call
        .set('x-corely-print-device', DEVICE)
        .set('Authorization', 'Bearer ' + TOKEN)
        .expect(401);
    }
    const missing = await makeApp([MailroomPrintController], true);
    extraApps.push(missing.app);
    await request(missing.url)
      .post('/api/v1/mailroom/print-device/claim')
      .set('x-corely-print-device', DEVICE)
      .set('Authorization', 'Bearer ' + TOKEN)
      .send({})
      .expect(401);
    expect(f.db.mailroomPrintDevice.findUnique).not.toHaveBeenCalled();
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });
  it('rejects class-level legacy/public markers combined with an exact owned device handler', async () => {
    for (const marker of [
      IS_PUBLIC_KEY,
      ERP_AFTER_SALES_SERVICE_AUTH,
      WMS_HANDOVER_AUTH,
      MAILROOM_SERVICE_AUTH,
      'b2bAuthMode',
    ]) {
      @Controller('mailroom/print-device')
      @SetMetadata(marker, true)
      class MixedClass {
        @Post('claim') @MailroomPrintDeviceAuth() claim() {
          return f.oldBusiness();
        }
      }
      const created = await makeApp([MixedClass]);
      extraApps.push(created.app);
      await request(created.url)
        .post('/api/v1/mailroom/print-device/claim')
        .set('x-corely-print-device', DEVICE)
        .set('Authorization', 'Bearer ' + TOKEN)
        .send({})
        .expect(401);
    }
    expect(f.db.mailroomPrintDevice.findUnique).not.toHaveBeenCalled();
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });
});
