import 'reflect-metadata';
import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { B2bAwareJwtAuthGuard } from './b2b-auth.guard';
import { B2bAdminController, B2bPortalController } from './b2b.controller';
import { B2bRequestDto, B2bSupplierAccountDto } from './b2b.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ENTITY_ACCESS_MODULE_KEY } from '../../common/decorators/entity-access.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

describe('B2B route and input boundaries', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  function context(
    controller: any,
    method: string,
    authorization = 'Bearer b2b_' + 'a'.repeat(64),
  ) {
    const request: any = { headers: { authorization } };
    return {
      ctx: {
        getHandler: () => controller.prototype[method],
        getClass: () => controller,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext,
      request,
    };
  }
  afterEach(() => jest.restoreAllMocks());
  it('allows only the decorated login action to reach password authentication', () => {
    const service: any = { ensureEnabled: jest.fn(), authenticate: jest.fn() };
    const guard = new B2bAwareJwtAuthGuard(new Reflector(), service);
    expect(guard.canActivate(context(B2bPortalController, 'login').ctx)).toBe(
      true,
    );
    expect(service.ensureEnabled).toHaveBeenCalled();
    expect(service.authenticate).not.toHaveBeenCalled();
  });
  it('authenticates every customer route with the separate session service and never creates req.user', async () => {
    const service: any = {
      authenticate: jest.fn().mockResolvedValue({ id: 'customer-account' }),
    };
    const guard = new B2bAwareJwtAuthGuard(new Reflector(), service);
    for (const method of [
      'me',
      'logout',
      'catalog',
      'submit',
      'requests',
      'detail',
    ]) {
      const { ctx, request } = context(B2bPortalController, method);
      expect(await guard.canActivate(ctx)).toBe(true);
      expect(request.b2b.id).toBe('customer-account');
      expect(request.user).toBeUndefined();
    }
    expect(service.authenticate).toHaveBeenCalledTimes(6);
  });
  it('continues employee JWT and DEV public rules for internal staff routes', () => {
    const fallback = jest
      .spyOn(JwtAuthGuard.prototype, 'canActivate')
      .mockReturnValue(false);
    const service: any = { authenticate: jest.fn(), ensureEnabled: jest.fn() };
    const guard = new B2bAwareJwtAuthGuard(new Reflector(), service);
    expect(guard.canActivate(context(B2bAdminController, 'setup').ctx)).toBe(
      false,
    );
    expect(fallback).toHaveBeenCalled();
    expect(service.authenticate).not.toHaveBeenCalled();
  });
  it('requires purchasing scope for supplier account changes', () => {
    const reflector = new Reflector();
    for (const method of ['createSupplierAccount', 'updateSupplierAccount']) {
      const targets = [B2bAdminController.prototype[method as keyof B2bAdminController], B2bAdminController];
      expect(reflector.getAllAndOverride(ENTITY_ACCESS_MODULE_KEY, targets)).toBe('purchasing');
      expect(reflector.getAllAndOverride(PERMISSIONS_KEY, targets)).toEqual(['purchase_orders:create']);
    }
  });
  it('rejects price/customer/company overrides in customer submissions', async () => {
    const valid = {
      requestId: '00000000-0000-4000-8000-000000000001',
      customerPoNumber: 'PO1',
      items: [{ productId: 'p1', quantity: 1 }],
    };
    for (const extra of [
      { entityId: 'another-company' },
      { customerId: 'another-customer' },
      { unitPrice: 0 },
      { items: [{ productId: 'p1', quantity: 1, unitPrice: 0 }] },
    ]) {
      await expect(
        pipe.transform(
          { ...valid, ...extra },
          { type: 'body', metatype: B2bRequestDto },
        ),
      ).rejects.toThrow();
    }
  });
  it.each([0, -1, 0.5, 100001])(
    'rejects invalid ordered quantity %s',
    async (quantity) => {
      await expect(
        pipe.transform(
          {
            requestId: '00000000-0000-4000-8000-000000000001',
            customerPoNumber: 'PO',
            items: [{ productId: 'p1', quantity }],
          },
          { type: 'body', metatype: B2bRequestDto },
        ),
      ).rejects.toThrow();
    },
  );
  it('does not accept customer linkage on a supplier account DTO', async () => {
    await expect(
      pipe.transform(
        {
          entityId: 'e',
          vendorId: 'v',
          customerId: 'c',
          email: 'v@example.com',
          name: 'Supplier',
          password: 'password-12345',
        },
        { type: 'body', metatype: B2bSupplierAccountDto },
      ),
    ).rejects.toThrow();
  });
});
