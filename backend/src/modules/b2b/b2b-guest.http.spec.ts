/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- the isolated Prisma fixture and Nest HTTP server are intentionally dynamic */
import 'reflect-metadata';
import {
  ForbiddenException,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import request from 'supertest';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { EntityAccessGuard } from '../../common/guards/entity-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { B2bAwareJwtAuthGuard } from './b2b-auth.guard';
import {
  B2bGuestAdminController,
  B2bGuestPublicController,
} from './b2b-guest.controller';
import { B2bGuestService } from './b2b-guest.service';
import { B2bService } from './b2b.service';

const secret = 'guest-http-test-staff-jwt-secret';
const inquiryId = '33333333-3333-4333-8333-333333333333';
const productId = '22222222-2222-4222-8222-222222222222';
const customerId = '44444444-4444-4444-8444-444444444444';
const publicPath = '/api/v1/b2b/public/requests';
const adminPath = '/api/v1/b2b/admin/guest-requests';
const validRequest = {
  entityId: 'entity-a',
  requestId: '11111111-1111-4111-8111-111111111111',
  companyName: 'Guest Company',
  contactName: 'Buyer',
  contactEmail: 'buyer@example.com',
  items: [{ productId, quantity: 2 }],
};

@Injectable()
class StaffStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    });
  }

  validate(payload: { sub: string }) {
    return { id: payload.sub };
  }
}

describe('B2B guest inquiry HTTP boundary', () => {
  let app: INestApplication;
  let match: jest.SpyInstance;
  const token = new JwtService({ secret });
  const auth = (actor: string) => `Bearer ${token.sign({ sub: actor })}`;
  const previousEnv = {
    sandbox: process.env.ERP_DEV_SANDBOX,
    order: process.env.B2B_PUBLIC_ORDER_ENABLED,
    catalog: process.env.B2B_PUBLIC_CATALOG_ENABLED,
    rateSecret: process.env.B2B_PUBLIC_ORDER_RATE_SECRET,
  };
  const createInquiry = jest.fn(async () => ({ reference: 'G-TEST-RECEIPT' }));
  const listInquiries = jest.fn(async () => []);
  const entityAccess = {
    assertAccess: jest.fn(
      async (actor: string, scope: string, entityId: string) => {
        if (
          actor === 'outsider' ||
          scope !== 'sales' ||
          entityId !== 'entity-a'
        ) {
          throw new ForbiddenException('Company access denied');
        }
      },
    ),
  };

  beforeAll(async () => {
    // Exercise the same public-route allowlist used by the DEV sandbox.
    process.env.ERP_DEV_SANDBOX = 'true';
    process.env.B2B_PUBLIC_ORDER_ENABLED = 'true';
    process.env.B2B_PUBLIC_CATALOG_ENABLED = 'true';
    process.env.B2B_PUBLIC_ORDER_RATE_SECRET =
      'isolated-guest-http-test-rate-secret-at-least-32-chars';

    const db: any = {
      entity: {
        findFirst: jest.fn(async () => ({
          id: 'entity-a',
          baseCurrency: 'TWD',
        })),
      },
      userRole: {
        findMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
          const actions =
            where.userId === 'reader'
              ? ['read']
              : where.userId === 'creator'
                ? ['create']
                : ['read', 'create'];
          return where.userId === 'no-role'
            ? []
            : [
                {
                  role: {
                    code: 'SALES_STAFF',
                    permissions: actions.map((action) => ({
                      permission: { resource: 'sales_orders', action },
                    })),
                  },
                },
              ];
        }),
      },
      b2bGuestRateBucket: {
        upsert: jest.fn(async () => ({ attempts: 1 })),
      },
      b2bGuestInquiry: {
        findUnique: jest.fn(async () => null),
        create: createInquiry,
        findMany: listInquiries,
        count: jest.fn(async () => 0),
      },
      b2bProductPriceBook: {
        findMany: jest.fn(async () => [
          {
            productId,
            msrp: new Prisma.Decimal('100.00'),
            currency: 'TWD',
            taxBasis: 'TAX_INCLUDED',
            product: { sku: 'SKU-1', name: 'Published item' },
          },
        ]),
      },
      $executeRaw: jest.fn(async () => 0),
    };
    db.$transaction = async (callback: (tx: typeof db) => unknown) =>
      callback(db);

    const service = new B2bGuestService(db as PrismaService);
    // Service-level matching and audit behavior has separate tests; here the
    // handler is isolated so a blocked HTTP request cannot mutate anything.
    match = jest.spyOn(service, 'match').mockResolvedValue({
      id: inquiryId,
      status: 'MATCHED',
    } as Awaited<ReturnType<B2bGuestService['match']>>);
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [B2bGuestPublicController, B2bGuestAdminController],
      providers: [
        StaffStrategy,
        PermissionsGuard,
        EntityAccessGuard,
        { provide: PrismaService, useValue: db },
        { provide: B2bGuestService, useValue: service },
        { provide: B2bService, useValue: {} },
        { provide: EntityAccessService, useValue: entityAccess },
        { provide: APP_GUARD, useClass: B2bAwareJwtAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
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

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app?.close();
    for (const [name, value] of Object.entries({
      ERP_DEV_SANDBOX: previousEnv.sandbox,
      B2B_PUBLIC_ORDER_ENABLED: previousEnv.order,
      B2B_PUBLIC_CATALOG_ENABLED: previousEnv.catalog,
      B2B_PUBLIC_ORDER_RATE_SECRET: previousEnv.rateSecret,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('accepts an anonymous public request with exactly a 202 receipt', async () => {
    const response = await request(app.getHttpServer())
      .post(publicPath)
      .send(validRequest)
      .expect(202);

    expect(response.body).toEqual({
      accepted: true,
      reference: 'G-TEST-RECEIPT',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(createInquiry).toHaveBeenCalledTimes(1);
  });

  it('rejects unexpected private-price fields at the request and item levels', async () => {
    await request(app.getHttpServer())
      .post(publicPath)
      .send({ ...validRequest, customerId, unitPrice: 1 })
      .expect(400);
    await request(app.getHttpServer())
      .post(publicPath)
      .send({
        ...validRequest,
        items: [{ productId, quantity: 2, unitPrice: 1, purchaseCost: 1 }],
      })
      .expect(400);

    expect(createInquiry).not.toHaveBeenCalled();
  });

  it('requires a staff JWT, sales read permission, and sales entity access for list', async () => {
    await request(app.getHttpServer())
      .get(`${adminPath}?entityId=entity-a`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`${adminPath}?entityId=entity-a`)
      .set('Authorization', auth('no-role'))
      .expect(403);
    const response = await request(app.getHttpServer())
      .get(`${adminPath}?entityId=entity-a`)
      .set('Authorization', auth('reader'))
      .expect(200);
    expect(response.body).toEqual({
      rows: [],
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    });
    expect(listInquiries).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityId: 'entity-a' },
      }),
    );
    expect(entityAccess.assertAccess).toHaveBeenCalledWith(
      'reader',
      'sales',
      'entity-a',
    );
    await request(app.getHttpServer())
      .get(`${adminPath}?entityId=entity-b`)
      .set('Authorization', auth('reader'))
      .expect(403);
    await request(app.getHttpServer())
      .get(`${adminPath}?entityId=entity-a`)
      .set('Authorization', auth('outsider'))
      .expect(403);
    expect(listInquiries).toHaveBeenCalledTimes(1);
  });

  it('requires both sales read and create plus entity access before matching', async () => {
    const path = `${adminPath}/${inquiryId}/match`;
    const body = {
      entityId: 'entity-a',
      customerId,
      reason: 'Verified account owner by staff',
    };
    await request(app.getHttpServer()).post(path).send(body).expect(401);
    for (const actor of ['reader', 'creator', 'no-role']) {
      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', auth(actor))
        .send(body)
        .expect(403);
    }
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth('matcher'))
      .send({ ...body, entityId: 'entity-b' })
      .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth('outsider'))
      .send(body)
      .expect(403);
    expect(match).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth('matcher'))
      .send({ ...body, reason: 'short' })
      .expect(400);
    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth('matcher'))
      .send(body)
      .expect(201);
    expect(response.body).toEqual({ id: inquiryId, status: 'MATCHED' });
    expect(match).toHaveBeenCalledTimes(1);
    expect(match).toHaveBeenCalledWith(inquiryId, body, 'matcher');
    expect(entityAccess.assertAccess).toHaveBeenCalledWith(
      'matcher',
      'sales',
      'entity-a',
    );
  });
});
