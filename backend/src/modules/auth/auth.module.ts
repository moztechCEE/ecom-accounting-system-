import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthMailService } from './auth-mail.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../common/prisma/prisma.module';

/**
 * AuthModule
 * 認證模組，處理使用者登入、註冊、JWT 驗證等功能
 *
 * 功能：
 * - 使用者註冊與登入
 * - JWT Token 產生與驗證
 * - 密碼加密與比對
 * - 與 UsersModule 整合進行使用者管理
 */
@Module({
  imports: [
    UsersModule,
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expiresIn = config.get<string>('JWT_EXPIRES_IN') || '7d';
        return {
          secret: config.get<string>('JWT_SECRET') || 'default-secret',
          signOptions: {
            expiresIn: expiresIn as any,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthMailService, JwtStrategy],
  exports: [AuthService, AuthMailService, JwtModule],
})
export class AuthModule {}
