import 'reflect-metadata';
import { ForbiddenException, INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { B2bSupplierAdminController } from './b2b-supplier-admin.controller';
import { B2bSupplierAdminService } from './b2b-supplier-admin.service';
import { B2bService } from './b2b.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { EntityAccessGuard } from '../../common/guards/entity-access.guard';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';

const secret = 'supplier-admin-http-test-secret';
const accountId = '00000000-0000-4000-8000-000000000001';
@Injectable()
class StaffStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret });
  }
  validate(payload: { sub: string }) { return { id: payload.sub }; }
}

describe('purchasing-only supplier account HTTP boundary', () => {
  let app: INestApplication;
  const token = new JwtService({ secret });
  const auth = (actor: string) => `Bearer ${token.sign({ sub: actor })}`;
  const list = jest.fn(async ({ where }: any) => where.entityId === 'entity-a' ? [{
    id: accountId, vendorId: 'vendor-a', email: 'supplier@example.com', name: 'Supplier A',
    isActive: true, createdAt: new Date('2026-09-24T00:00:00Z'),
    vendor: { name: 'Vendor A' }, passwordHash: 'MUST_NOT_LEAK',
  }] : []);
  const create = jest.fn(async () => ({ id: accountId, email: 'supplier@example.com' }));
  const update = jest.fn(async () => ({ id: accountId, isActive: false }));
  const entityAccess = { assertAccess: jest.fn(async (actor: string, scope: string, entityId: string) => {
    if (actor === 'outsider' || scope !== 'purchasing' || entityId !== 'entity-a')
      throw new ForbiddenException('Company access denied');
  }) };

  beforeAll(async () => {
    const db: any = {
      b2bAccount: { findMany: list },
      vendor: { findMany: jest.fn(async () => [{ id: 'vendor-a', name: 'Vendor A' }]) },
      userRole: { findMany: jest.fn(async ({ where }: any) => [{ role: {
        code: 'PURCHASING_STAFF', name: 'Purchasing staff',
        permissions: (where.userId === 'reader' ? ['read'] : ['read', 'create']).map((action) => ({
          permission: { resource: 'purchase_orders', action },
        })),
      } }]) },
    };
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [B2bSupplierAdminController],
      providers: [
        StaffStrategy, PermissionsGuard, EntityAccessGuard, B2bSupplierAdminService,
        { provide: PrismaService, useValue: db },
        { provide: EntityAccessService, useValue: entityAccess },
        { provide: B2bService, useValue: { createSupplierAccount: create, updateAccount: update } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app?.close(); });

  const path = '/api/v1/b2b/purchasing/supplier-accounts';
  it('uses purchasing scope and returns only supplier account fields', async () => {
    const result = await request(app.getHttpServer()).get(`${path}?entityId=entity-a`).set('Authorization', auth('buyer')).expect(200);
    expect(result.body).toEqual({
      accounts: [{ id: accountId, vendorId: 'vendor-a', vendorName: 'Vendor A', email: 'supplier@example.com', name: 'Supplier A', isActive: true, createdAt: '2026-09-24T00:00:00.000Z' }],
      vendors: [{ id: 'vendor-a', name: 'Vendor A' }],
    });
    expect(JSON.stringify(result.body)).not.toContain('MUST_NOT_LEAK');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ where: { entityId: 'entity-a', accountType: 'SUPPLIER' } }));
    expect(entityAccess.assertAccess).toHaveBeenCalledWith('buyer', 'purchasing', 'entity-a');
    await request(app.getHttpServer()).get(`${path}?entityId=entity-a`).set('Authorization', auth('reader')).expect(200);
    await request(app.getHttpServer()).get(`${path}?entityId=entity-a`).set('Authorization', auth('outsider')).expect(403);
    await request(app.getHttpServer()).get(`${path}?entityId=entity-b`).set('Authorization', auth('buyer')).expect(403);
    await request(app.getHttpServer()).get(`${path}?entityId=entity-a`).expect(401);
  });

  it('requires purchase create permission for creation and reset, with entity isolation', async () => {
    const body = { entityId: 'entity-a', vendorId: 'vendor-a', email: 'supplier@example.com', name: 'Supplier A', password: 'strong-password-2026' };
    await request(app.getHttpServer()).post(path).set('Authorization', auth('buyer')).send(body).expect(201);
    expect(create).toHaveBeenCalledWith(body, 'buyer');
    await request(app.getHttpServer()).post(path).set('Authorization', auth('reader')).send(body).expect(403);
    await request(app.getHttpServer()).post(path).set('Authorization', auth('outsider')).send(body).expect(403);
    await request(app.getHttpServer()).patch(`${path}/${accountId}`).set('Authorization', auth('buyer')).send({ entityId: 'entity-a', isActive: false, password: 'new-strong-password-2026' }).expect(200);
    expect(update).toHaveBeenCalledWith(accountId, { entityId: 'entity-a', isActive: false, password: 'new-strong-password-2026' }, 'SUPPLIER');
    await request(app.getHttpServer()).patch(`${path}/${accountId}`).set('Authorization', auth('reader')).send({ entityId: 'entity-a', isActive: false }).expect(403);
  });
});
