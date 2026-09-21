import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('DEV public entry restrictions', () => {
  const before = process.env.ERP_DEV_SANDBOX;
  afterEach(() => { if (before === undefined) delete process.env.ERP_DEV_SANDBOX; else process.env.ERP_DEV_SANDBOX = before; });
  function request(method: string, path: string) {
    const context = { getHandler: () => null, getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ method, path }) }) } as unknown as ExecutionContext;
    const guard = new JwtAuthGuard({ getAllAndOverride: () => true } as unknown as Reflector);
    return () => guard.canActivate(context);
  }
  it('keeps login and readiness available but blocks anonymous writes and callbacks', () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    expect(request('POST', '/api/v1/auth/login')()).toBe(true);
    expect(request('GET', '/api/v1/health/ready')()).toBe(true);
    for (const path of ['/api/v1/auth/register', '/api/v1/auth/password-reset/confirm', '/api/v1/integrations/shopify/webhook']) {
      expect(request('POST', path)).toThrow(ForbiddenException);
    }
  });
  it('preserves existing public policy outside the explicit DEV runtime', () => {
    delete process.env.ERP_DEV_SANDBOX;
    expect(request('POST', '/api/v1/auth/register')()).toBe(true);
  });
});
