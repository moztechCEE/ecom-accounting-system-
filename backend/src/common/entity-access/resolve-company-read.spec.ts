import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EntityAccessService } from './entity-access.service';
import { resolveCompanyRead } from './resolve-company-read';
import { ProductController } from '../../modules/product/product.controller';
import { CustomerController } from '../../modules/sales/customer.controller';
import { ProductService } from '../../modules/product/product.service';
import { CustomerService } from '../../modules/sales/customer.service';
import { PurchaseController } from '../../modules/purchase/purchase.controller';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

describe('Verified company read scope', () => {
  const getContext = jest.fn();
  const access = { getContext } as unknown as EntityAccessService;
  beforeEach(() => {
    getContext.mockReset().mockResolvedValue({ entityId: 'tw-entity-001', noAccess: false });
  });

  it('resolves explicit or default verified membership instead of a JWT scalar', async () => {
    await expect(resolveCompanyRead(access, 'service', 'sales')).resolves.toBe('tw-entity-001');
    expect(getContext).toHaveBeenLastCalledWith('service', 'sales', undefined);
    await resolveCompanyRead(access, 'service', 'inventory', 'tw-entity-001');
    expect(getContext).toHaveBeenLastCalledWith('service', 'inventory', 'tw-entity-001');
  });

  it.each([null, '', ' ', [], {}, 3])('rejects malformed requested company %p before querying', async (value) => {
    await expect(resolveCompanyRead(access, 'service', 'sales', value)).rejects.toBeInstanceOf(BadRequestException);
    expect(getContext).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated, absent membership and foreign company', async () => {
    await expect(resolveCompanyRead(access, undefined, 'sales')).rejects.toBeInstanceOf(ForbiddenException);
    expect(getContext).not.toHaveBeenCalled();
    for (const context of [{ entityId:'foreign', noAccess:true }, { entityId:'', noAccess:false }]) {
      getContext.mockResolvedValue(context);
      await expect(resolveCompanyRead(access, 'service', 'sales', 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('product reads pass only the resolved company into service', async () => {
    const service = { findAll: jest.fn(), findOne: jest.fn() };
    const controller = new ProductController(service as unknown as ProductService, access);
    const req = { user: { id:'service', entityId:'untrusted-foreign' } };
    await controller.findAll(req);
    await controller.findOne(req, 'product-1', 'tw-entity-001');
    expect(service.findAll).toHaveBeenCalledWith('tw-entity-001', { type:undefined, category:undefined });
    expect(service.findOne).toHaveBeenCalledWith('tw-entity-001', 'product-1');
    getContext.mockResolvedValue({ entityId:'foreign', noAccess:true });
    await expect(controller.findAll(req, undefined, undefined, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.findAll).toHaveBeenCalledTimes(1);
  });

  it('customer reads pass only the resolved company into service', async () => {
    const service = { findAll: jest.fn(), findOne: jest.fn() };
    const controller = new CustomerController(service as unknown as CustomerService, access);
    const req = { user:{ id:'service' } };
    await controller.findAll(req);
    await controller.findOne(req, 'customer-1', 'tw-entity-001');
    expect(service.findAll).toHaveBeenCalledWith('tw-entity-001', { limit: undefined, offset: undefined, search: undefined });
    expect(service.findOne).toHaveBeenCalledWith('tw-entity-001', 'customer-1');
    getContext.mockResolvedValue({ entityId:'foreign', noAccess:true });
    await expect(controller.findAll(req, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.findAll).toHaveBeenCalledTimes(1);
  });

  it('product writes reject foreign scope and preserve the resolved entity', async () => {
    const service = { create: jest.fn(), update: jest.fn(), remove: jest.fn() };
    const controller = new ProductController(service as unknown as ProductService, access);
    const req = { user: { id: 'service', entityId: 'untrusted-foreign' } };
    const dto = { sku: 'TEST', name: 'Test', barcode: 'TEST' };
    await controller.create(req, dto, 'tw-entity-001');
    await controller.update(req, 'product-1', { name: 'Updated' }, 'tw-entity-001');
    await controller.remove(req, 'product-1', 'tw-entity-001');
    expect(service.create).toHaveBeenCalledWith('tw-entity-001', dto);
    expect(service.update).toHaveBeenCalledWith('tw-entity-001', 'product-1', { name: 'Updated' });
    expect(service.remove).toHaveBeenCalledWith('tw-entity-001', 'product-1');
    getContext.mockResolvedValue({ entityId: 'foreign', noAccess: true });
    await expect(controller.create(req, dto, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.update(req, 'product-1', {}, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.remove(req, 'product-1', 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.update).toHaveBeenCalledTimes(1);
    expect(service.remove).toHaveBeenCalledTimes(1);
  });

  it('company reads require read permission without granting write roles', () => {
    for (const method of [CustomerController.prototype.findAll, CustomerController.prototype.findOne]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['sales_orders:read']);
    }
    for (const method of [PurchaseController.prototype.findAll, PurchaseController.prototype.findOne]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['purchase_orders:read']);
      expect(Reflect.getMetadata(ROLES_KEY, method)).toBeUndefined();
    }
    expect(Reflect.getMetadata(ROLES_KEY, PurchaseController.prototype.create)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PurchaseController.prototype.create)).toEqual(['purchase_orders:create']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PurchaseController.prototype.options)).toEqual(['purchase_orders:create']);
    expect(Reflect.getMetadata(ROLES_KEY, PurchaseController.prototype.receive)).toEqual(['ADMIN', 'OPERATOR']);
  });
});
