import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('DEV public entry restrictions', () => {
  const before = process.env.ERP_DEV_SANDBOX;
  const catalogBefore = process.env.B2B_PUBLIC_CATALOG_ENABLED;
  const orderBefore = process.env.B2B_PUBLIC_ORDER_ENABLED;
  const privateQuoteBefore = process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED;
  afterEach(() => {
    if (before === undefined) delete process.env.ERP_DEV_SANDBOX;
    else process.env.ERP_DEV_SANDBOX = before;
    if (catalogBefore === undefined)
      delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
    else process.env.B2B_PUBLIC_CATALOG_ENABLED = catalogBefore;
    if (orderBefore === undefined) delete process.env.B2B_PUBLIC_ORDER_ENABLED;
    else process.env.B2B_PUBLIC_ORDER_ENABLED = orderBefore;
    if (privateQuoteBefore === undefined) delete process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED;
    else process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED = privateQuoteBefore;
  });
  function request(method: string, path: string) {
    const context = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ method, path }) }),
    } as unknown as ExecutionContext;
    const guard = new JwtAuthGuard({
      getAllAndOverride: () => true,
    } as unknown as Reflector);
    return () => guard.canActivate(context);
  }
  it('keeps login and readiness available but blocks anonymous writes and callbacks', () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    expect(request('POST', '/api/v1/auth/login')()).toBe(true);
    expect(request('GET', '/api/v1/health/ready')()).toBe(true);
    for (const path of [
      '/api/v1/auth/register',
      '/api/v1/auth/password-reset/confirm',
      '/api/v1/integrations/shopify/webhook',
    ]) {
      expect(request('POST', path)).toThrow(ForbiddenException);
    }
  });
  it('preserves existing public policy outside the explicit DEV runtime', () => {
    delete process.env.ERP_DEV_SANDBOX;
    expect(request('POST', '/api/v1/auth/register')()).toBe(true);
  });
  it('allows the read-only MSRP catalog in DEV only when its separate flag is enabled', () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
    expect(request('GET', '/api/v1/b2b/public/catalog')).toThrow(
      ForbiddenException,
    );
    expect(request('GET', '/api/v1/b2b/public/catalog/facets')).toThrow(
      ForbiddenException,
    );
    process.env.B2B_PUBLIC_CATALOG_ENABLED = 'true';
    expect(request('GET', '/api/v1/b2b/public/catalog')()).toBe(true);
    expect(request('GET', '/api/v1/b2b/public/catalog/facets')()).toBe(true);
    expect(request('POST', '/api/v1/b2b/public/catalog')).toThrow(
      ForbiddenException,
    );
  });
  it('allows guest request intake in DEV only when both public flags are enabled', () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
    delete process.env.B2B_PUBLIC_ORDER_ENABLED;
    expect(request('POST', '/api/v1/b2b/public/requests')).toThrow(
      ForbiddenException,
    );
    process.env.B2B_PUBLIC_CATALOG_ENABLED = 'true';
    expect(request('POST', '/api/v1/b2b/public/requests')).toThrow(
      ForbiddenException,
    );
    process.env.B2B_PUBLIC_ORDER_ENABLED = 'true';
    expect(request('POST', '/api/v1/b2b/public/requests')()).toBe(true);
    expect(request('GET', '/api/v1/b2b/public/requests')).toThrow(
      ForbiddenException,
    );
  });
  it('allows only the two private quote POST endpoints under their separate DEV flag', () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    delete process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED;
    expect(request('POST', '/api/v1/b2b/public/quote-access/preview'))
      .toThrow(ForbiddenException);
    expect(request('POST', '/api/v1/b2b/public/quote-access/accept'))
      .toThrow(ForbiddenException);
    process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED = 'true';
    expect(request('POST', '/api/v1/b2b/public/quote-access/preview')()).toBe(true);
    expect(request('POST', '/api/v1/b2b/public/quote-access/accept')()).toBe(true);
    expect(request('GET', '/api/v1/b2b/public/quote-access/preview'))
      .toThrow(ForbiddenException);
  });
  it('allows only the exact public order-reference GET route when both flags are enabled', () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    const path = '/api/v1/b2b/public/orders/G-0123456789ABCDEF01234567';
    delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
    delete process.env.B2B_PUBLIC_ORDER_ENABLED;
    expect(request('GET', path)).toThrow(ForbiddenException);
    process.env.B2B_PUBLIC_CATALOG_ENABLED = 'true';
    expect(request('GET', path)).toThrow(ForbiddenException);
    process.env.B2B_PUBLIC_ORDER_ENABLED = 'true';
    expect(request('GET', path)()).toBe(true);
    expect(request('GET', `${path}/extra`)).toThrow(ForbiddenException);
    expect(request('GET', '/api/v1/b2b/public/orders/G-guess')).toThrow(
      ForbiddenException,
    );
    expect(request('POST', path)).toThrow(ForbiddenException);
    expect(request('GET', '/api/v1/b2b/public/orders')).toThrow(
      ForbiddenException,
    );
  });
});
