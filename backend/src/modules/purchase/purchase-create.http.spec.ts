import 'reflect-metadata';
import {
  ForbiddenException,
  INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { PurchaseB2bQueueService } from './purchase-b2b-queue.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { InventoryService } from '../inventory/inventory.service';
import { CostService } from '../cost/cost.service';

// Real Nest routing, JWT verification, permission/company guards, production
// ValidationPipe and business service; repository is deliberately in-memory.
const secret = 'purchase-http-test-only-not-a-runtime-secret';
@Injectable()
class PurchaseTestStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    });
  }
  validate(payload: { sub: string }) {
    if (!['buyer', 'reader', 'outsider'].includes(payload.sub))
      throw new UnauthorizedException();
    return { id: payload.sub };
  }
}

const valid = () => ({
  vendorId: 'vendor-a',
  orderDate: '2026-09-23',
  currency: 'TWD',
  fxRate: 1,
  items: [
    { productId: 'product-a', qty: 3, unitCost: 0.1 },
    { productId: 'product-b', qty: 1, unitCost: 0.2 },
  ],
});
function fixture() {
  const vendors = [
    {
      id: 'vendor-a',
      name: 'A vendor',
      entityId: 'entity-a',
      isActive: true,
      bankAccount: 'PRIVATE',
    },
    {
      id: 'vendor-foreign',
      name: 'Foreign vendor',
      entityId: 'entity-b',
      isActive: true,
    },
    {
      id: 'vendor-disabled',
      name: 'Disabled vendor',
      entityId: 'entity-a',
      isActive: false,
    },
  ];
  const products = [
    {
      id: 'product-a',
      name: 'Product A',
      sku: 'A',
      entityId: 'entity-a',
      isActive: true,
      purchaseCost: 999,
      qtyOnHand: 999,
    },
    {
      id: 'product-b',
      name: 'Product B',
      sku: 'B',
      entityId: 'entity-a',
      isActive: true,
      purchaseCost: 888,
    },
    {
      id: 'product-foreign',
      name: 'Foreign product',
      sku: 'F',
      entityId: 'entity-b',
      isActive: true,
    },
    {
      id: 'product-disabled',
      name: 'Disabled product',
      sku: 'D',
      entityId: 'entity-a',
      isActive: false,
    },
  ];
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, value]: [string, any]) =>
      value && typeof value === 'object' && value.in
        ? value.in.includes(row[k])
        : row[k] === value,
    );
  const projection = (row: any, select: any) =>
    row &&
    Object.fromEntries(
      Object.keys(select)
        .filter((k) => select[k])
        .map((k) => [k, row[k]]),
    );
  const db: any = {
    b2bPurchaseRequest: {
      findMany: jest.fn(async ({ where }: any) => where.entityId === 'entity-a' ? [{
        id: 'b2b-a', requestNumber: 'B2B-001', createdAt: new Date('2026-09-24T00:00:00Z'),
        customerId: 'private-customer', subtotal: '999.00',
        items: [{ id: 'line-a', sku: 'A', name: 'Product A', quantity: 3, confirmedQuantity: 1, unitPrice: '999.00' }],
      }] : []),
    },
    entity: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 'entity-a' && where.isActive
          ? { baseCurrency: 'TWD' }
          : null,
      ),
    },
    vendor: {
      findFirst: jest.fn(async ({ where, select }: any) =>
        projection(
          vendors.find((v) => matches(v, where)),
          select,
        ),
      ),
      findMany: jest.fn(async ({ where, select }: any) =>
        vendors
          .filter((v) => matches(v, where))
          .map((v) => projection(v, select)),
      ),
    },
    product: {
      findMany: jest.fn(async ({ where, select }: any) =>
        products
          .filter((p) => matches(p, where))
          .map((p) => projection(p, select)),
      ),
    },
    purchaseOrder: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'po-a',
        ...data,
        items: data.items.create,
      })),
    },
    userRole: {
      findMany: jest.fn(async ({ where }: any) => [
        {
          role: {
            code: 'CUSTOM_BUYER',
            name: 'Custom buyer',
            permissions: [
              {
                permission: {
                  resource: 'purchase_orders',
                  action: where.userId === 'reader' ? 'read' : 'create',
                },
              },
            ],
          },
        },
      ]),
    },
  };
  db.$transaction = jest.fn((callback: any) => callback(db));
  return db;
}

describe('Manual purchase-order HTTP boundary', () => {
  let app: INestApplication, db: any;
  const inventory = { adjustStock: jest.fn() },
    cost = { recordPurchaseCost: jest.fn() };
  const companyAccess = {
    assertAccess: jest.fn(
      async (actor: string, module: string, entityId: string) => {
        if (
          actor === 'outsider' ||
          module !== 'purchasing' ||
          entityId !== 'entity-a'
        )
          throw new ForbiddenException('Company access denied');
      },
    ),
  };
  const jwt = new JwtService({ secret });
  const auth = (actor = 'buyer') => `Bearer ${jwt.sign({ sub: actor })}`;

  beforeAll(async () => {
    db = fixture();
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [PurchaseController],
      providers: [
        PurchaseService,
        PurchaseB2bQueueService,
        PurchaseTestStrategy,
        { provide: PrismaService, useValue: db },
        { provide: EntityAccessService, useValue: companyAccess },
        { provide: InventoryService, useValue: inventory },
        { provide: CostService, useValue: cost },
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
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app?.close();
  });
  const post = (
    body: any = valid(),
    actor = 'buyer',
    query = '?entityId=entity-a',
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/purchase-orders${query}`)
      .set('Authorization', auth(actor))
      .send(body);

  it('allows a custom purchase creator with company access and stores exact decimal totals', async () => {
    const response = await post().expect(201);
    expect(response.body).toMatchObject({
      id: 'po-a',
      entityId: 'entity-a',
      status: 'pending',
      totalAmountOriginal: '0.5',
      totalAmountBase: '0.5',
    });
    expect(companyAccess.assertAccess).toHaveBeenCalledWith(
      'buyer',
      'purchasing',
      'entity-a',
    );
    expect(db.purchaseOrder.create).toHaveBeenCalledTimes(1);
    expect(inventory.adjustStock).not.toHaveBeenCalled();
    expect(cost.recordPurchaseCost).not.toHaveBeenCalled();
  });

  it('routes scoped options before :id and returns no financial or inventory data', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/purchase-orders/options?entityId=entity-a')
      .set('Authorization', auth())
      .expect(200);
    expect(response.body).toEqual({
      vendors: [{ id: 'vendor-a', name: 'A vendor' }],
      products: [
        { id: 'product-a', name: 'Product A', sku: 'A' },
        { id: 'product-b', name: 'Product B', sku: 'B' },
      ],
    });
  });

  it('gives a purchasing-only creator a company-scoped shortage queue without sales prices', async () => {
    const path = '/api/v1/purchase-orders/b2b-requests/shortages?entityId=entity-a';
    const response = await request(app.getHttpServer())
      .get(path).set('Authorization', auth()).expect(200);
    expect(response.body).toEqual({ items: [{
      id: 'b2b-a', requestNumber: 'B2B-001', createdAt: '2026-09-24T00:00:00.000Z',
      items: [{ requestItemId: 'line-a', sku: 'A', name: 'Product A', requested: 3, confirmed: 1, shortage: 2 }],
    }] });
    expect(JSON.stringify(response.body)).not.toContain('private-customer');
    expect(JSON.stringify(response.body)).not.toContain('999.00');
    expect(db.b2bPurchaseRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entityId: 'entity-a', status: 'needs_adjustment' } }));
    expect(companyAccess.assertAccess).toHaveBeenCalledWith('buyer', 'purchasing', 'entity-a');
    await request(app.getHttpServer()).get(path).set('Authorization', auth('reader')).expect(403);
    await request(app.getHttpServer()).get(path).set('Authorization', auth('outsider')).expect(403);
    await request(app.getHttpServer()).get('/api/v1/purchase-orders/b2b-requests/shortages?entityId=entity-b').set('Authorization', auth()).expect(403);
  });

  it('requires authentication and create permission for orders and options', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/purchase-orders?entityId=entity-a')
      .send(valid())
      .expect(401);
    await post(valid(), 'reader').expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/purchase-orders/options?entityId=entity-a')
      .set('Authorization', auth('reader'))
      .expect(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('denies foreign company access before masters or write transactions', async () => {
    await post(valid(), 'outsider').expect(403);
    await post(valid(), 'buyer', '?entityId=entity-b').expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/purchase-orders/options?entityId=entity-b')
      .set('Authorization', auth())
      .expect(403);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.vendor.findMany).not.toHaveBeenCalled();
  });

  it.each(['', '?entityId=', '?entityId=entity-a&entityId=entity-b'])(
    'rejects missing or malformed company query %s',
    async (query) => {
      await post(valid(), 'buyer', query).expect(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['vendor-foreign', 'vendor-disabled', 'vendor-missing'])(
    'rejects unavailable vendor %s without writing',
    async (vendorId) => {
      await post({ ...valid(), vendorId }).expect(400);
      expect(db.purchaseOrder.create).not.toHaveBeenCalled();
    },
  );

  it.each(['product-foreign', 'product-disabled', 'product-missing'])(
    'rejects unavailable product %s without writing',
    async (productId) => {
      await post({
        ...valid(),
        items: [{ productId, qty: 1, unitCost: 10 }],
      }).expect(400);
      expect(db.purchaseOrder.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    { qty: true },
    { qty: '1' },
    { qty: 0 },
    { qty: 1.1 },
    { unitCost: true },
    { unitCost: '1' },
    { unitCost: -1 },
    { unitCost: 0 },
    { unitCost: 0.001 },
    { productId: 123 },
  ])('does not implicitly coerce unsafe line input %p', async (invalid) => {
    await post({
      ...valid(),
      items: [{ productId: 'product-a', qty: 1, unitCost: 10, ...invalid }],
    }).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { fxRate: true },
    { fxRate: '1' },
    { fxRate: 0 },
    { fxRate: 1.1234567 },
    { orderDate: '2026-02-30' },
    { currency: 'NT$' },
    { items: [] },
    { entityId: 'entity-a' },
    { status: 'received' },
  ])('rejects malformed or injected order data %p', async (invalid) => {
    await post({ ...valid(), ...invalid }).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('keeps receipt and landed-cost role gates independent from create permission', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/purchase-orders/po-a/receive?entityId=entity-a')
      .set('Authorization', auth())
      .send({ warehouseId: 'w-a' })
      .expect(403);
    await request(app.getHttpServer())
      .post(
        '/api/v1/purchase-orders/po-a/landed-cost/preview?entityId=entity-a',
      )
      .set('Authorization', auth())
      .send({})
      .expect(403);
    expect(inventory.adjustStock).not.toHaveBeenCalled();
    expect(cost.recordPurchaseCost).not.toHaveBeenCalled();
  });

  it('guards B2B procurement with purchasing company access and create permission, and routes before :id', async () => {
    const service = app.get(PurchaseService);
    const create = jest
      .spyOn(service, 'createFromB2bRequest')
      .mockResolvedValue({ id: 'po-b2b' } as any);
    const summary = jest
      .spyOn(service, 'b2bProcurement')
      .mockResolvedValue({ items: [], purchaseOrders: [] });
    const body = {
      requestId: 'ff837db5-17ce-478b-bba7-0b6c14656c8f',
      requestKey: '4cfce6a0-df94-4bda-9725-8e500e1f2777',
      vendorId: 'vendor-a',
      orderDate: '2026-09-24',
      currency: 'TWD',
      fxRate: 1,
      items: [
        {
          requestItemId: '67e95b8e-0432-4754-b3ac-5e14bcc791f2',
          qty: 1,
          unitCost: 12,
        },
      ],
    };
    const poUrl = '/api/v1/purchase-orders/from-b2b-request?entityId=entity-a';
    const summaryUrl = `/api/v1/purchase-orders/b2b-requests/${body.requestId}/procurement?entityId=entity-a`;
    try {
      await request(app.getHttpServer()).post(poUrl).send(body).expect(401);
      await request(app.getHttpServer())
        .post(poUrl)
        .set('Authorization', auth('reader'))
        .send(body)
        .expect(403);
      await request(app.getHttpServer())
        .get(summaryUrl)
        .set('Authorization', auth('reader'))
        .expect(403);
      await request(app.getHttpServer())
        .post(poUrl.replace('entity-a', 'entity-b'))
        .set('Authorization', auth())
        .send(body)
        .expect(403);
      expect(create).not.toHaveBeenCalled();
      expect(summary).not.toHaveBeenCalled();

      await request(app.getHttpServer())
        .post(poUrl)
        .set('Authorization', auth())
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .get(summaryUrl)
        .set('Authorization', auth())
        .expect(200);
      expect(create).toHaveBeenCalledWith(
        'entity-a',
        expect.objectContaining(body),
      );
      expect(summary).toHaveBeenCalledWith('entity-a', body.requestId);
      expect(companyAccess.assertAccess).toHaveBeenCalledWith(
        'buyer',
        'purchasing',
        'entity-a',
      );
    } finally {
      create.mockRestore();
      summary.mockRestore();
    }
  });
});
