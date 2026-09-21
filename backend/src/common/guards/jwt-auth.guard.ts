import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JwtAuthGuard
 * JWT 認證守衛，預設所有路由都需要驗證
 * 除非使用 @Public() 裝飾器標記為公開路由
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // 檢查是否為公開路由
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      if (process.env.ERP_DEV_SANDBOX === 'true') {
        const request = context.switchToHttp().getRequest();
        const route = `${request.method} ${request.path.replace(/\/+$/, '')}`;
        const allowed = ['POST /api/v1/auth/login', 'GET /api/v1/auth/login-entities',
          'GET /api/v1/health', 'GET /api/v1/health/ready'];
        if (!allowed.includes(route)) throw new ForbiddenException('DEV 停用公開註冊、回呼與外部作業入口');
      }
      return true;
    }

    return super.canActivate(context);
  }
}
