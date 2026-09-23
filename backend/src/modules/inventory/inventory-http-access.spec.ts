import 'reflect-metadata';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryModule } from './inventory.module';
import { InventoryService } from './inventory.service';

describe('Inventory HTTP authorization boundary', () => {
  let app: INestApplication;
  let url: string;
  const userRoles = jest.fn();
  const assertAccess = jest.fn();
  const inventory = {
    getWarehouses: jest.fn(),
    createWarehouse: jest.fn(),
    getSnapshotsForProduct: jest.fn(),
    importLegacyErpInventory: jest.fn(),
    adjustStock: jest.fn(),
    reserveStock: jest.fn(),
    releaseReservedStock: jest.fn(),
  };
  const company = 'company-a';
  const warehouse = { entityId: company, code: 'MAIN', name: 'Main warehouse' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [InventoryModule] })
      .overrideProvider(InventoryService).useValue(inventory)
      .overrideProvider(PrismaService).useValue({ userRole: { findMany: userRoles } })
      .overrideProvider(EntityAccessService).useValue({ assertAccess })
      .overrideGuard(JwtAuthGuard).useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          const id = req.headers['x-test-actor'];
          if (!id) throw new UnauthorizedException();
          // No client-supplied company or permissions are trusted.
          req.user = { id };
          return true;
        },
      }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }));
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    userRoles.mockImplementation(async ({ where: { userId } }) => [{
      role: {
        code: userId === 'admin' ? 'ADMIN' : 'STAFF',
        permissions: (userId === 'operator' ? ['read', 'update'] : userId === 'reader' ? ['read'] : [])
          .map(action => ({ permission: { resource: 'inventory', action } })),
      },
    }]);
    assertAccess.mockImplementation(async (_userId, module, entityId) => {
      if (module !== 'inventory' || entityId !== company) throw new ForbiddenException('Company access denied');
      return { entityId };
    });
    inventory.getWarehouses.mockResolvedValue([]);
    inventory.getSnapshotsForProduct.mockResolvedValue([]);
    inventory.createWarehouse.mockImplementation(async body => body);
    inventory.importLegacyErpInventory.mockResolvedValue({ rows: 1 });
  });

  afterAll(async () => { await app.close(); });

  const get = (path: string, actor = 'reader') => request(url).get(`/api/v1/inventory/${path}`).set('x-test-actor', actor);
  const post = (path: string, actor = 'operator') => request(url).post(`/api/v1/inventory/${path}`).set('x-test-actor', actor);
  const upload = (query: string, actor = 'operator') => post(`import/erp${query}`, actor)
    .attach('file', Buffer.from('sku,qty\nQA,1\n'), 'inventory.csv');

  it.each(['adjust', 'reserve', 'release'])('removes the generic %s route even for an administrator', async path => {
    await post(path, 'admin').send({ entityId: company, quantity: 999 }).expect(404);
    expect(inventory.adjustStock).not.toHaveBeenCalled();
    expect(inventory.reserveStock).not.toHaveBeenCalled();
    expect(inventory.releaseReservedStock).not.toHaveBeenCalled();
  });

  it('requires an authenticated actor and inventory read permission', async () => {
    await request(url).get(`/api/v1/inventory/warehouses?entityId=${company}`).expect(401);
    await get(`warehouses?entityId=${company}`, 'unprivileged').expect(403);
    await get(`snapshots?entityId=${company}&productId=p1`, 'unprivileged').expect(403);
    expect(inventory.getWarehouses).not.toHaveBeenCalled();
    expect(inventory.getSnapshotsForProduct).not.toHaveBeenCalled();
  });

  it('requires inventory update permission for warehouse creation and every import including preview', async () => {
    await post('warehouses', 'reader').send(warehouse).expect(403);
    await upload(`?entityId=${company}&dryRun=true`, 'reader').expect(403);
    await upload(`?entityId=${company}`, 'reader').expect(403);
    expect(inventory.createWarehouse).not.toHaveBeenCalled();
    expect(inventory.importLegacyErpInventory).not.toHaveBeenCalled();
  });

  it('enforces company access on reads and writes, including admin permission bypass', async () => {
    await get('warehouses?entityId=foreign-company', 'admin').expect(403);
    await get('snapshots?entityId=foreign-company&productId=p1').expect(403);
    await post('warehouses').send({ ...warehouse, entityId: 'foreign-company' }).expect(403);
    await upload('?entityId=foreign-company').expect(403);
    expect(inventory.getWarehouses).not.toHaveBeenCalled();
    expect(inventory.getSnapshotsForProduct).not.toHaveBeenCalled();
    expect(inventory.createWarehouse).not.toHaveBeenCalled();
    expect(inventory.importLegacyErpInventory).not.toHaveBeenCalled();
  });

  it.each(['', '?entityId=', '?entityId=%20', '?entityId=company-a&entityId=company-a'])('requires an explicit scalar company for read and import (%s)', async query => {
    await get(`warehouses${query}`).expect(400);
    await upload(query).expect(400);
    expect(inventory.getWarehouses).not.toHaveBeenCalled();
    expect(inventory.importLegacyErpInventory).not.toHaveBeenCalled();
  });

  it('requires the warehouse company in the validated body and a product for snapshots', async () => {
    await post(`warehouses?entityId=${company}`).send({ code: 'MAIN', name: 'Main' }).expect(400);
    await post('warehouses').send({ ...warehouse, entityId: 123 }).expect(400);
    await get(`snapshots?entityId=${company}`).expect(400);
    await get(`snapshots?entityId=${company}&productId=%20`).expect(400);
    expect(inventory.createWarehouse).not.toHaveBeenCalled();
    expect(inventory.getSnapshotsForProduct).not.toHaveBeenCalled();
  });

  it('rejects unexpected warehouse fields and import flags', async () => {
    await post('warehouses').send({ ...warehouse, entity: { connect: { id: 'foreign-company' } } }).expect(400);
    await upload(`?entityId=${company}&force=yes`).expect(400);
    await upload(`?entityId=${company}&dryRun=yes`).expect(400);
    await upload(`?entityId=${company}&bypass=true`).expect(400);
    expect(inventory.createWarehouse).not.toHaveBeenCalled();
    expect(inventory.importLegacyErpInventory).not.toHaveBeenCalled();
  });

  it('rejects multipart scope and options after parsing; body cannot override the guarded query', async () => {
    for (const [field, value] of [['entityId', 'foreign-company'], ['entityId', company], ['force', 'true']]) {
      await post(`import/erp?entityId=${company}`).field(field, value)
        .attach('file', Buffer.from('sku,qty\nQA,1\n'), 'inventory.csv').expect(400);
    }
    await post('import/erp').field('entityId', company)
      .attach('file', Buffer.from('sku,qty\nQA,1\n'), 'inventory.csv').expect(400);
    expect(inventory.importLegacyErpInventory).not.toHaveBeenCalled();
  });

  it('passes only validated, authorized company input to the existing services', async () => {
    await get(`warehouses?entityId=${company}`).expect(200);
    await get(`snapshots?entityId=${company}&productId=p1`).expect(200);
    await post('warehouses').send(warehouse).expect(201);
    await upload(`?entityId=${company}&dryRun=true&force=false&sheet=Opening`).expect(201);
    expect(assertAccess).toHaveBeenCalledWith('reader', 'inventory', company);
    expect(assertAccess).toHaveBeenCalledWith('operator', 'inventory', company);
    expect(inventory.getWarehouses).toHaveBeenCalledWith(company);
    expect(inventory.getSnapshotsForProduct).toHaveBeenCalledWith(company, 'p1');
    expect(inventory.createWarehouse).toHaveBeenCalledWith(warehouse);
    expect(inventory.importLegacyErpInventory).toHaveBeenCalledWith({
      entityId: company,
      file: expect.objectContaining({ originalname: 'inventory.csv' }),
      sheet: 'Opening', dryRun: true, force: false,
    });
  });
});
