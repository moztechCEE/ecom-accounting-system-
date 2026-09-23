import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

const entityId = 'tw-entity-001';
const customerId = 'synthetic-customer';
const actor = { user: { id: 'staff', entityId: 'untrusted-legacy-scalar' } };

describe('Customer master write company boundaries', () => {
  let controller: CustomerController;
  let access: { getContext: jest.Mock };
  let customer: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; delete: jest.Mock };
  beforeEach(() => {
    access = { getContext: jest.fn().mockResolvedValue({ entityId, noAccess: false }) };
    customer = {
      create: jest.fn().mockResolvedValue({ id: customerId, entityId }),
      findFirst: jest.fn().mockResolvedValue({ id: customerId, code: 'QA-CUSTOMER' }),
      update: jest.fn().mockResolvedValue({ id: customerId, entityId }),
      delete: jest.fn().mockResolvedValue({ id: customerId, entityId }),
    };
    controller = new CustomerController(new CustomerService({ customer } as unknown as PrismaService), access as unknown as EntityAccessService);
  });
  const createData = () => ({ name: 'Synthetic customer', code: 'QA-CUSTOMER' }) as Prisma.CustomerCreateInput;

  it('creates using verified primary membership when JWT has no scalar company', async () => {
    await controller.create({ user: { id: 'staff' } }, createData());
    expect(access.getContext).toHaveBeenCalledWith('staff', 'sales', undefined);
    expect(customer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Synthetic customer', entity: { connect: { id: entityId } } }) });
  });
  it('supports explicit permitted company and ignores body/scalar company overrides', async () => {
    const data = { ...createData(), entityId: 'foreign', entity: { connect: { id: 'foreign' } } };
    await controller.create(actor, data, entityId);
    expect(access.getContext).toHaveBeenCalledWith('staff', 'sales', entityId);
    const written = customer.create.mock.calls[0][0].data;
    expect(written.entity).toEqual({ connect: { id: entityId } });
    expect(written).not.toHaveProperty('entityId');
    expect(data.entity).toEqual({ connect: { id: 'foreign' } });
  });
  it.each(['create', 'update', 'remove'] as const)('rejects %s in unauthorized company before database writes', async (method) => {
    access.getContext.mockResolvedValue({ entityId: 'foreign', noAccess: true });
    const result = method === 'create' ? controller.create(actor, createData(), 'foreign')
      : method === 'update' ? controller.update(actor, customerId, { name: 'Changed' }, 'foreign')
      : controller.remove(actor, customerId, 'foreign');
    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    expect(customer.create).not.toHaveBeenCalled();
    expect(customer.findFirst).not.toHaveBeenCalled();
    expect(customer.update).not.toHaveBeenCalled();
    expect(customer.delete).not.toHaveBeenCalled();
  });
  it('rejects absent authentication and malformed company before customer lookup', async () => {
    await expect(controller.create({}, createData(), entityId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.update(actor, customerId, {}, '')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.remove(actor, customerId, [] as unknown as string)).rejects.toBeInstanceOf(BadRequestException);
    expect(access.getContext).not.toHaveBeenCalled();
    expect(customer.findFirst).not.toHaveBeenCalled();
  });
  it('scopes update lookup and mutation and cannot move customer through nested input', async () => {
    await controller.update(actor, customerId, { name: 'Updated synthetic customer', entityId: 'foreign', entity: { connect: { id: 'foreign' } } } as Prisma.CustomerUpdateInput, entityId);
    expect(customer.findFirst).toHaveBeenCalledWith({ where: { id: customerId, entityId }, select: { id: true, code: true } });
    expect(customer.update).toHaveBeenCalledWith({ where: { id: customerId, entityId }, data: { name: 'Updated synthetic customer' } });
  });
  it.each(['update', 'remove'] as const)('does not %s foreign customer ID within permitted company scope', async (method) => {
    customer.findFirst.mockResolvedValue(null);
    const result = method === 'update' ? controller.update(actor, 'foreign-customer', { name: 'Changed' }, entityId)
      : controller.remove(actor, 'foreign-customer', entityId);
    await expect(result).rejects.toBeInstanceOf(NotFoundException);
    expect(customer.findFirst.mock.calls[0][0].where).toEqual({ id: 'foreign-customer', entityId });
    expect(customer.update).not.toHaveBeenCalled();
    expect(customer.delete).not.toHaveBeenCalled();
  });
  it('scopes deletion in both lookup and final mutation', async () => {
    await controller.remove(actor, customerId, entityId);
    expect(customer.findFirst).toHaveBeenCalledWith({ where: { id: customerId, entityId }, select: { id: true } });
    expect(customer.delete).toHaveBeenCalledWith({ where: { id: customerId, entityId } });
  });
  it('requires the existing sales_orders:create grant for every customer-master write', () => {
    for (const method of ['create', 'update', 'remove'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, CustomerController.prototype[method])).toEqual(['sales_orders:create']);
      expect(Reflect.getMetadata(GUARDS_METADATA, CustomerController.prototype[method])).toContain(PermissionsGuard);
    }
  });
});
