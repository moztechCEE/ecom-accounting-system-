import { ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { B2bService } from './b2b.service';

const B2B_AUTH_MODE = 'b2bAuthMode';
export const B2bSession = () => SetMetadata(B2B_AUTH_MODE, 'session');
export const B2bLogin = () => SetMetadata(B2B_AUTH_MODE, 'login');

// Existing employee/public policy stays intact. Only explicitly decorated portal
// handlers use customer sessions, including in the otherwise closed DEV sandbox.
@Injectable()
export class B2bAwareJwtAuthGuard extends JwtAuthGuard {
  constructor(
    private readonly b2bReflector: Reflector,
    private readonly b2b: B2bService,
  ) {
    super(b2bReflector);
  }
  canActivate(context: ExecutionContext) {
    const mode = this.b2bReflector.getAllAndOverride<string>(B2B_AUTH_MODE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (mode === 'login') {
      this.b2b.ensureEnabled();
      return true;
    }
    if (mode === 'session') {
      const req = context.switchToHttp().getRequest();
      return this.b2b
        .authenticate(req.headers.authorization)
        .then((identity) => {
          req.b2b = identity;
          return true;
        });
    }
    return super.canActivate(context);
  }
}
