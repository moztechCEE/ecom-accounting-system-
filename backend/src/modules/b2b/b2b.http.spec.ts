import 'reflect-metadata';
import {
  Controller,
  Get,
  INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { B2bAwareJwtAuthGuard } from './b2b-auth.guard';
import { B2bAdminController, B2bPortalController } from './b2b.controller';
import { B2bService } from './b2b.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { EntityAccessGuard } from '../../common/guards/entity-access.guard';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';

// Real Nest HTTP, DTO validation, bcrypt, JWT-vs-partner-session boundaries and
// business service. The explicitly in-memory repository is NOT a Prisma/DB E2E.
const secret = 'isolated-http-test-secret-not-used-outside-this-test';
@Injectable()
class StaffStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    });
  }
  validate(payload: { sub: string }) {
    if (payload.sub !== 'staff') throw new UnauthorizedException();
    return { id: 'staff' };
  }
}
@Controller('__b2b-test/staff')
class StaffOnlyController {
  @Get() read() {
    return { ok: true };
  }
}
function fixture() {
  const entity = {
    id: 'entity-a',
    loginCode: 'CORELY',
    name: 'Corely Test',
    isActive: true,
    baseCurrency: 'TWD',
  };
  const customers = new Map(
    ['customer-a', 'customer-b'].map((id) => [
      id,
      { id, name: id, companyName: null, entityId: entity.id, isActive: true },
    ]),
  );
  const product = {
    id: 'product-a',
    sku: 'SKU-1',
    type: 'SIMPLE',
    name: 'Test product',
    description: 'Description',
    isActive: true,
    entityId: entity.id,
    purchaseCost: 'SECRET',
  };
  const accounts = new Map<string, any>(),
    sessions = new Map<string, any>(),
    catalog = new Map<string, any>(),
    prices = new Map<string, any>(),
    requests = new Map<string, any>();
  const key = (v: any) => JSON.stringify(v);
  const select = (row: any, fields?: Record<string, boolean>) =>
    !row
      ? null
      : fields
        ? Object.fromEntries(
            Object.keys(fields)
              .filter((k) => fields[k])
              .map((k) => [k, row[k]]),
          )
        : row;
  const account = (id: string, include?: any) => {
    const a = accounts.get(id);
    return a
      ? {
          ...a,
          ...(include
            ? { customer: customers.get(a.customerId) || null, entity }
            : {}),
        }
      : null;
  };
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  const db: any = {
    entity: {
      findFirst: async ({ where }: any) =>
        where.id === entity.id || where.loginCode === entity.loginCode
          ? entity
          : null,
    },
    customer: {
      findFirst: async ({ where }: any) => {
        const c = customers.get(where.id);
        return c && c.entityId === where.entityId ? c : null;
      },
    },
    product: {
      findMany: async ({ where, select: fields }: any) => where.entityId === entity.id ? [select(product, fields)] : [],
      count: async ({ where }: any) => where.entityId === entity.id ? 1 : 0,
      findFirst: async ({ where }: any) =>
        where.id === product.id && where.entityId === entity.id
          ? product
          : null,
    },
    userRole: {
      findMany: async () => [{ role: { code: 'ADMIN', permissions: [] } }],
    },
    b2bAccount: {
      create: async ({ data, select: fields }: any) => {
        const row = {
          id: randomUUID(),
          accountType: 'CUSTOMER',
          customerId: null,
          vendorId: null,
          isActive: true,
          failedLoginCount: 0,
          lockedUntil: null,
          ...data,
        };
        accounts.set(row.id, row);
        return select(row, fields);
      },
      findUnique: async ({ where, include }: any) => {
        const id =
          where.id ||
          [...accounts.values()].find(
            (a) =>
              a.entityId === where.entityId_email.entityId &&
              a.email === where.entityId_email.email,
          )?.id;
        return account(id, include);
      },
      findFirst: async ({ where }: any) =>
        [...accounts.values()].find((a) => matches(a, where)) || null,
      update: async ({ where, data, select: fields }: any) => {
        const row = { ...accounts.get(where.id), ...data };
        accounts.set(row.id, row);
        return select(row, fields);
      },
    },
    b2bSession: {
      create: async ({ data }: any) => {
        sessions.set(data.tokenHash, { revokedAt: null, ...data });
        return data;
      },
      findUnique: async ({ where }: any) => {
        const s = sessions.get(where.tokenHash);
        return s ? { ...s, account: account(s.accountId, true) } : null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [id, s] of sessions)
          if (matches(s, where)) {
            sessions.set(id, { ...s, ...data });
            count++;
          }
        return { count };
      },
    },
    b2bCatalogItem: {
      upsert: async ({ create, update }: any) => {
        const row = { ...catalog.get(create.productId), ...create, ...update };
        catalog.set(create.productId, row);
        return row;
      },
      findMany: async ({ where }: any) =>
        [...catalog.values()]
          .filter(
            (c) =>
              c.entityId === where.entityId &&
              c.isPublished &&
              (!where.productId || where.productId.in.includes(c.productId)),
          )
          .map((c) => ({ ...c, product })),
    },
    b2bCustomerPrice: {
      upsert: async ({ create, update }: any) => {
        prices.set(
          key({ customerId: create.customerId, productId: create.productId }),
          { ...create, ...update },
        );
        return create;
      },
      findMany: async ({ where }: any) =>
        [...prices.values()].filter(
          (p) =>
            p.entityId === where.entityId &&
            p.customerId === where.customerId &&
            p.isActive &&
            (!p.validUntil || p.validUntil > new Date()),
        ),
    },
    b2bPurchaseRequest: {
      findUnique: async ({ where }: any) =>
        [...requests.values()].find((r) =>
          matches(r, where.entityId_customerId_requestId),
        ) || null,
      findFirst: async ({ where }: any) =>
        [...requests.values()].find((r) => matches(r, where)) || null,
      findMany: async ({ where }: any) =>
        [...requests.values()].filter((r) => matches(r, where)),
      create: async ({ data }: any) => {
        const row = {
          status: 'pending_stock_review',
          currency: 'TWD',
          salesOrderId: null,
          createdAt: new Date(),
          reviewedAt: null,
          reviewNote: null,
          deliveryDate: null,
          ...data,
          items: data.items.create.map((i: any) => ({
            id: randomUUID(),
            confirmedQuantity: null,
            ...i,
          })),
          customer: customers.get(data.customerId),
        };
        requests.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = { ...requests.get(where.id), ...data };
        requests.set(row.id, row);
        return row;
      },
    },
    b2bStockReview: { create: async ({ data }: any) => ({ id: randomUUID(), ...data }) },
    purchaseOrder: { findMany: async () => [] },
    b2bRequestItem: {
      update: async ({ where, data }: any) => {
        for (const r of requests.values())
          for (const item of r.items)
            if (item.id === where.id) Object.assign(item, data);
      },
    },
    inventoryTransaction: { create: jest.fn() },
    inventorySnapshot: { update: jest.fn() },
    salesOrder: { create: jest.fn() },
    $queryRaw: async () => [],
  };
  db.$transaction = async (fn: any) => fn(db);
  return { db, requests, accounts };
}
describe('B2B HTTP flow with isolated repository fixture', () => {
  let app: INestApplication, staffToken: string, db: any;
  const before = process.env.B2B_PORTAL_ENABLED;
  beforeAll(async () => {
    process.env.B2B_PORTAL_ENABLED = 'true';
    db = fixture().db;
    const service = Reflect.construct(B2bService, [db, {}]) as B2bService;
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [
        B2bPortalController,
        B2bAdminController,
        StaffOnlyController,
      ],
      providers: [
        { provide: PrismaService, useValue: db },
        { provide: B2bService, useValue: service },
        StaffStrategy,
        PermissionsGuard,
        EntityAccessGuard,
        {
          provide: EntityAccessService,
          useValue: {
            assertAccess: async (
              _actor: string,
              _module: string,
              entityId: string,
            ) => {
              if (entityId !== 'entity-a') throw new UnauthorizedException();
            },
          },
        },
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
    await app.init();
    await app.listen(0, '127.0.0.1');
    staffToken = new JwtService({ secret }).sign({ sub: 'staff' });
  });
  afterAll(async () => {
    await app?.close();
    if (before === undefined) delete process.env.B2B_PORTAL_ENABLED;
    else process.env.B2B_PORTAL_ENABLED = before;
  });
  it('scopes bounded product options to authenticated staff and validates query arrays', async () => {
    const path = '/api/v1/b2b/admin/product-options';
    await request(app.getHttpServer()).get(`${path}?entityId=entity-a`).expect(401);
    const response = await request(app.getHttpServer()).get(`${path}?entityId=entity-a&limit=20&search=SKU`)
      .set('Authorization', `Bearer ${staffToken}`).expect(200);
    expect(response.body).toEqual({ rows: [{ id: 'product-a', sku: 'SKU-1', name: 'Test product' }], total: 1, limit: 20, hasMore: false });
    for (const invalid of ['limit=101', 'limit=1&limit=2', 'search=a&search=b']) {
      await request(app.getHttpServer()).get(`${path}?entityId=entity-a&${invalid}`)
        .set('Authorization', `Bearer ${staffToken}`).expect(400);
    }
    await request(app.getHttpServer()).get(`${path}?entityId=foreign`)
      .set('Authorization', `Bearer ${staffToken}`).expect(401);
  });

  it('account -> login -> customer prices -> PO -> scoped link -> staff review -> revocation', async () => {
    const http = app.getHttpServer();
    const staff = { Authorization: `Bearer ${staffToken}` };
    const created = await request(http)
      .post('/api/v1/b2b/admin/accounts')
      .set(staff)
      .send({
        entityId: 'entity-a',
        customerId: 'customer-a',
        email: 'buyer@example.com',
        name: 'Buyer A',
        password: 'customer-password-2026',
      })
      .expect(201);
    expect(created.body.passwordHash).toBeUndefined();
    await request(http)
      .put('/api/v1/b2b/admin/catalog')
      .set(staff)
      .send({
        entityId: 'entity-a',
        productId: 'product-a',
        unitPrice: 50,
        isPublished: true,
      })
      .expect(200);
    await request(http)
      .put('/api/v1/b2b/admin/prices')
      .set(staff)
      .send({
        entityId: 'entity-a',
        customerId: 'customer-a',
        productId: 'product-a',
        unitPrice: 10.01,
        isActive: true,
      })
      .expect(200);
    const logged = await request(http)
      .post('/api/v1/b2b/portal/login')
      .send({
        companyCode: 'CORELY',
        email: 'BUYER@example.com',
        password: 'customer-password-2026',
      })
      .expect(201);
    expect(logged.body.token).toMatch(/^b2b_[a-f0-9]{64}$/);
    const customer = { Authorization: `Bearer ${logged.body.token}` };
    await request(http)
      .get('/api/v1/__b2b-test/staff')
      .set(customer)
      .expect(401);
    await request(http)
      .get('/api/v1/b2b/portal/catalog')
      .set(staff)
      .expect(401);
    const catalog = await request(http)
      .get('/api/v1/b2b/portal/catalog')
      .set(customer)
      .expect(200);
    expect(catalog.body.items[0].unitPrice).toBe('10.01');
    expect(catalog.body.items[0].purchaseCost).toBeUndefined();
    const payload = {
      requestId: randomUUID(),
      customerPoNumber: 'CUSTOMER-PO-01',
      items: [{ productId: 'product-a', quantity: 3 }],
    };
    await request(http)
      .post('/api/v1/b2b/portal/requests')
      .set(customer)
      .send({ ...payload, customerId: 'customer-b' })
      .expect(400);
    const sent = await request(http)
      .post('/api/v1/b2b/portal/requests')
      .set(customer)
      .send(payload)
      .expect(201);
    expect(sent.body).toMatchObject({
      status: 'pending_stock_review',
      subtotal: '30.03',
      tax: '1.50',
      total: '31.53',
      salesOrderId: null,
    });
    const retry = await request(http)
      .post('/api/v1/b2b/portal/requests')
      .set(customer)
      .send(payload)
      .expect(201);
    expect(retry.body.id).toBe(sent.body.id);
    await request(http)
      .get(`/api/v1/b2b/portal/requests/${sent.body.id}`)
      .expect(401);
    await request(http)
      .post('/api/v1/b2b/admin/accounts')
      .set(staff)
      .send({
        entityId: 'entity-a',
        customerId: 'customer-b',
        email: 'other@example.com',
        name: 'Buyer B',
        password: 'customer-password-2026',
      })
      .expect(201);
    const other = await request(http)
      .post('/api/v1/b2b/portal/login')
      .send({
        companyCode: 'CORELY',
        email: 'other@example.com',
        password: 'customer-password-2026',
      })
      .expect(201);
    await request(http)
      .get(`/api/v1/b2b/portal/requests/${sent.body.id}`)
      .set('Authorization', `Bearer ${other.body.token}`)
      .expect(404);
    const formalPath = `/api/v1/b2b/portal/requests/${sent.body.id}/quotes/1`;
    await request(http).get(formalPath).expect(401);
    await request(http).get(formalPath).set(staff).expect(401);
    await request(http).get(formalPath)
      .set('Authorization', `Bearer ${other.body.token}`).expect(404);
    await request(http).post(`${formalPath}/accept`).expect(401);
    await request(http).post(`${formalPath}/accept`)
      .set('Authorization', `Bearer ${other.body.token}`).expect(404);
    const reviewed = await request(http)
      .post(`/api/v1/b2b/admin/requests/${sent.body.id}/review`)
      .set(staff)
      .send({
        entityId: 'entity-a',
        items: sent.body.items.map((i: any) => ({
          id: i.id,
          confirmedQuantity: i.quantity,
        })),
        deliveryDate: '2026-10-01',
      })
      .expect(201);
    expect(reviewed.body.status).toBe('stock_confirmed');
    expect(reviewed.body.total).toBe('31.53');
    const quote = await request(http)
      .get(`/api/v1/b2b/portal/requests/${sent.body.id}`)
      .set(customer)
      .expect(200);
    expect(quote.body.status).toBe('stock_confirmed');
    expect(quote.body.reviewedBy).toBeUndefined();
    expect(db.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(db.inventorySnapshot.update).not.toHaveBeenCalled();
    expect(db.salesOrder.create).not.toHaveBeenCalled();
    await request(http)
      .patch(`/api/v1/b2b/admin/accounts/${created.body.id}`)
      .set(staff)
      .send({ entityId: 'entity-a', isActive: false })
      .expect(200);
    await request(http)
      .get('/api/v1/b2b/portal/catalog')
      .set(customer)
      .expect(401);
  });
});
