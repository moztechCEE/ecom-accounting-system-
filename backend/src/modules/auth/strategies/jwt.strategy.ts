import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

/**
 * JwtStrategy
 * JWT 驗證策略，用於驗證請求中的 JWT Token
 *
 * 流程：
 * 1. 從 Authorization Header 提取 Bearer Token
 * 2. 驗證 Token 的有效性
 * 3. 從 Token 中提取 userId
 * 4. 查詢並返回使用者資訊
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'default-secret',
    });
  }

  /**
   * 驗證 JWT Payload
   * @param payload - JWT Token 中的 payload
   * @returns 使用者資訊
   */
  async validate(payload: { sub: string; email: string; purpose?: string; aud?: string }) {
    if (payload.purpose || payload.aud || !payload.email) throw new UnauthorizedException();
    const user = await this.authService.validateUser(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
