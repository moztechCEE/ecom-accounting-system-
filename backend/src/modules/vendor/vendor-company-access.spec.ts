import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { Test } from '@nestjs/testing';
import { VendorModule } from './vendor.module';

describe('Vendor master company boundaries', () => {
  const vendor = { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
  const userRole = { findMany: jest.fn() };
  const getContext = jest.fn();
  const db = { vendor, userRole } as unknown as PrismaService;
  const service = new VendorService(db);
  const controller = new VendorController(service, { getContext } as unknown as EntityAccessService, db);
  const actor = { user: { id: 'staff', effectivePermissions: [] as string[] } };
  const permission = (resource: string, action: string) => ({ permission: { resource, action } });
  const role = (...permissions: ReturnType<typeof permission>[]) => ({ role: { code: 'STAFF', permissions } });
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

  beforeEach(() => {
    jest.clearAllMocks();
    userRole.findMany.mockResolvedValue([role(permission('purchase_orders', 'read'))]);
    getContext.mockImplementation(async (_id, _module, requested) => ({ entityId: requested || 'company-a', noAccess: requested === 'company-b' }));
    vendor.findMany.mockResolvedValue([]);
    vendor.findFirst.mockResolvedValue(null);
  });

  it('scopes every read to the verified company and refuses a foreign company before querying vendors', async () => {
    await controller.findAll(actor, 'company-a');
    expect(vendor.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entityId: 'company-a' } }));
    await expect(controller.findAll(actor, 'company-b')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.findOne(actor, 'foreign-vendor', 'company-b')).rejects.toBeInstanceOf(ForbiddenException);
    expect(vendor.findFirst).not.toHaveBeenCalled();
  });

  it('preserves accounting-only AP vendor lookup within accounting company scope', async () => {
    userRole.findMany.mockResolvedValue([role(permission('accounts', 'read'))]);
    await controller.findAll(actor, 'company-a');
    expect(getContext).toHaveBeenCalledWith('staff', 'accounting', 'company-a');
    expect(vendor.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entityId: 'company-a' } }));
    userRole.findMany.mockResolvedValue([]);
    await expect(controller.findAll(actor, 'company-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a purchasing creator choose a supplier without a separate read grant', async () => {
    userRole.findMany.mockResolvedValue([role(permission('purchase_orders', 'create'))]);
    await controller.findAll(actor, 'company-a');
    expect(getContext).toHaveBeenCalledWith('staff', 'purchasing', 'company-a');
  });

  it('requires purchasing create permission for mutations and verifies company', async () => {
    for (const method of ['create', 'update', 'remove'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, controller[method])).toEqual(['purchase_orders:create']);
    }
    await expect(controller.create(actor, { name: 'Supplier' }, 'company-b')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.update(actor, 'v1', { name: 'Changed' }, 'company-b')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.remove(actor, 'v1', 'company-b')).rejects.toBeInstanceOf(ForbiddenException);
    expect(vendor.create).not.toHaveBeenCalled();
    expect(vendor.update).not.toHaveBeenCalled();
    expect(vendor.delete).not.toHaveBeenCalled();
  });

  it('rejects body company overrides, including Prisma relation connect, in both write DTOs', async () => {
    for (const metatype of [CreateVendorDto, UpdateVendorDto]) {
      for (const injected of [{ entityId: 'company-b' }, { entity: { connect: { id: 'company-b' } } }]) {
        await expect(pipe.transform({ name: 'Supplier', ...injected }, { type: 'body', metatype })).rejects.toBeInstanceOf(BadRequestException);
      }
    }
  });

  it('uses verified company even if a direct service caller passes extra body properties', async () => {
    vendor.create.mockResolvedValue({ id: 'v1' });
    await service.create('company-a', { name: 'Supplier', entityId: 'company-b', entity: { connect: { id: 'company-b' } } } as any);
    expect(vendor.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entityId: 'company-a', name: 'Supplier' }) });
    expect(vendor.create.mock.calls[0][0].data.entity).toBeUndefined();
  });

  it('cannot lookup, update or delete another company vendor by raw ID', async () => {
    await expect(service.findOne('company-a', 'foreign-vendor')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('company-a', 'foreign-vendor', { name: 'Changed' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('company-a', 'foreign-vendor')).rejects.toBeInstanceOf(NotFoundException);
    expect(vendor.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-vendor', entityId: 'company-a' } });
    expect(vendor.update).not.toHaveBeenCalled();
    expect(vendor.delete).not.toHaveBeenCalled();
    vendor.findFirst.mockResolvedValue({ id: 'own-vendor', entityId: 'company-a' });
    await service.update('company-a', 'own-vendor', { name: 'New', entityId: 'company-b' } as any);
    await service.remove('company-a', 'own-vendor');
    expect(vendor.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'own-vendor', entityId: 'company-a' } }));
    expect(vendor.update.mock.calls[0][0].data.entityId).toBeUndefined();
    expect(vendor.update).toHaveBeenCalledWith({ where: { id: 'own-vendor', entityId: 'company-a' }, data: { isActive: false } });
    expect(vendor.delete).not.toHaveBeenCalled();
  });
});

describe('VendorModule dependency wiring', () => {
  it('resolves controller with company-access and permission providers', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [VendorModule] }).compile();
    expect(moduleRef.get(VendorController)).toBeInstanceOf(VendorController);
    await moduleRef.close();
  });
});
