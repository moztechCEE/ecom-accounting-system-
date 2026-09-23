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
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { SalesOrderService } from './services/sales-order.service';
import { SalesQuotationService } from './services/sales-quotation.service';
import { AfterSalesCaseService } from './services/after-sales-case.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { InventoryService } from '../inventory/inventory.service';

// Real Nest route, JWT/permission/company guards and fulfillment service.
// Persistence is an in-memory test fixture, not a PostgreSQL concurrency test.
const secret = 'sales-fulfill-http-test-only';
const orderId = 'ad077743-8d7e-42a2-8c97-a6f9a02573ae';
@Injectable()
class FulfillTestStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    });
  }
  validate(payload: { sub: string }) {
    if (!['writer', 'reader'].includes(payload.sub))
      throw new UnauthorizedException();
    return { id: payload.sub };
  }
}

describe('Legacy sales fulfillment HTTP policy', () => {
  let app: INestApplication, storedOrder: any;
  const legacy = () => ({
    id: orderId,
    entityId: 'entity-a',
    channelId: 'channel-a',
    externalOrderId: 'LEGACY-1',
    sourceOrderKey: 'channel-a:LEGACY-1',
    status: 'paid',
    b2bRequest: null,
    wmsHandoverInbox: [],
    items: [
      {
        id: 'line-a',
        productId: 'product-a',
        qty: 1,
        product: { id: 'product-a', type: 'SIMPLE', hasSerialNumbers: false },
      },
    ],
  });
  const tx: any = {
    $queryRaw: jest.fn(async () => []),
    salesOrder: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === storedOrder.id && where.entityId === storedOrder.entityId
          ? storedOrder
          : null,
      ),
      updateMany: jest.fn(async ({ data }: any) => {
        storedOrder.status = data.status;
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        storedOrder.status = data.status;
        return storedOrder;
      }),
    },
    inventoryTransaction: { count: jest.fn(async () => 0) },
    warehouse: {
      findFirst: jest.fn(async () => ({ id: 'warehouse-a', code: 'MAIN' })),
    },
    shipment: { create: jest.fn(async () => ({ id: 'shipment-a' })) },
  };
  const prisma = {
    $transaction: jest.fn((callback: any) => callback(tx)),
    userRole: {
      findMany: jest.fn(async ({ where }: any) => [
        {
          role: {
            code: 'CUSTOM_SALES',
            permissions: [
              {
                permission: {
                  resource: 'sales_orders',
                  action: where.userId === 'reader' ? 'read' : 'create',
                },
              },
            ],
          },
        },
      ]),
    },
  };
  const inventory = {
    shipStock: jest.fn(),
    markSerialNumbersAsSold: jest.fn(),
  };
  const access = {
    assertAccess: jest.fn(
      async (_actor: string, module: string, entityId: string) => {
        if (module !== 'sales' || entityId !== 'entity-a')
          throw new ForbiddenException('Company access denied');
      },
    ),
  };
  const jwt = new JwtService({ secret });
  const post = (actor = 'writer', entityId = 'entity-a') =>
    request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${orderId}/fulfill?entityId=${entityId}`)
      .set('Authorization', `Bearer ${jwt.sign({ sub: actor })}`)
      .send({ warehouseId: 'warehouse-a' });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [SalesController],
      providers: [
        SalesService,
        FulfillTestStrategy,
        { provide: SalesOrderService, useValue: {} },
        { provide: SalesQuotationService, useValue: {} },
        { provide: AfterSalesCaseService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: EntityAccessService, useValue: access },
        { provide: InventoryService, useValue: inventory },
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
    storedOrder = legacy();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('returns 403 for a company-authorized sales reader before any transaction or stock mutation', async () => {
    const response = await post('reader').expect(403);
    expect(response.body.message).toContain('sales_orders:create');
    expect(access.assertAccess).toHaveBeenCalledWith(
      'reader',
      'sales',
      'entity-a',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(inventory.shipStock).not.toHaveBeenCalled();
  });

  it('requires JWT authentication before fulfillment', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/sales/orders/${orderId}/fulfill?entityId=entity-a`)
      .send({ warehouseId: 'warehouse-a' })
      .expect(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps the company guard for authorized sales writers', async () => {
    await post('writer', 'foreign-company').expect(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(inventory.shipStock).not.toHaveBeenCalled();
  });

  it('rejects a B2B order with no dispatch intent even for an authorized writer', async () => {
    storedOrder.externalOrderId = 'B2B:request-a';
    const response = await post().expect(400);
    expect(response.body.message).toContain('晚間核銷');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // source row lock only
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(inventory.shipStock).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('preserves permitted legacy fulfillment and retries without a second stock movement', async () => {
    const first = await post().expect(201);
    expect(first.body).toEqual({
      success: true,
      alreadyFulfilled: false,
      status: 'shipped',
    });
    const retry = await post().expect(201);
    expect(retry.body).toEqual({
      success: true,
      alreadyFulfilled: true,
      status: 'shipped',
    });
    expect(inventory.shipStock).toHaveBeenCalledTimes(1);
    expect(tx.shipment.create).toHaveBeenCalledTimes(1);
  });
});
