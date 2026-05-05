import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as OTPAuth from 'otpauth';
import { AuthMailService } from './auth-mail.service';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';

/**
 * AuthService
 * 認證服務，處理所有與身份驗證相關的業務邏輯
 *
 * 主要功能：
 * - 使用者註冊（密碼加密）
 * - 使用者登入（密碼驗證 + JWT 產生）
 * - Token 驗證與解析
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 10;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authMailService: AuthMailService,
  ) {}

  /**
   * 註冊新使用者
   * @param registerDto - 註冊資料
   * @returns 新建立的使用者與 JWT token
   */
  async register(registerDto: RegisterDto) {
    const { email, password, name } = registerDto;

    const normalizedEmail = (email ?? '').trim().toLowerCase();

    // 檢查 email 是否已存在
    const existingUser = await this.usersService.findForAuthByEmail(normalizedEmail);
    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // 加密密碼
    const passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS);

    // 建立使用者
    const user = await this.usersService.createForAuth({
      email: normalizedEmail,
      name,
      passwordHash,
      mustChangePassword: false,
    });

    this.logger.log(`New user registered: ${normalizedEmail}`);

    // 產生 JWT token
    const token = await this.generateToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        mustChangePassword: user.mustChangePassword,
      },
      access_token: token,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersService.findForAuthById(userId);
    if (!user || !user.passwordHash || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different');
    }

    await this.usersService.updatePassword(userId, dto.newPassword, {
      mustChangePassword: false,
      clearPasswordResetToken: true,
    });

    return { success: true };
  }

  async requestPasswordReset(dto: RequestPasswordResetDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.usersService.findForAuthByEmail(normalizedEmail);

    if (!user || !user.isActive) {
      return {
        success: true,
        message:
          '如果該電子郵件存在於系統中，您將收到一封重設密碼通知。',
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.usersService.setPasswordResetToken(user.id, tokenHash, expiresAt);

    const resetUrl = this.buildPasswordResetUrl(token);
    await this.authMailService.sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl,
    });

    return {
      success: true,
      message:
        '如果該電子郵件存在於系統中，您將收到一封重設密碼通知。',
    };
  }

  async confirmPasswordReset(dto: ConfirmPasswordResetDto) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(dto.token.trim())
      .digest('hex');

    const user = await this.usersService.findByPasswordResetTokenHash(tokenHash);
    if (!user || !user.isActive) {
      throw new BadRequestException('Reset token is invalid or expired');
    }

    await this.usersService.updatePassword(user.id, dto.newPassword, {
      mustChangePassword: false,
      clearPasswordResetToken: true,
    });

    return { success: true };
  }

  /**
   * 使用者登入
   * @param loginDto - 登入資料
   * @returns JWT token 與使用者資訊
   */
  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;
    const emailInput = (email ?? '').trim();
    const normalizedEmail = emailInput.toLowerCase();

    // 尋找使用者
    const user = await this.usersService.findForAuthByEmail(normalizedEmail);
    if (!user) {
      this.logger.warn(`Login failed: user not found (${emailInput})`);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      this.logger.warn(`Login failed: missing password hash (${normalizedEmail})`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 驗證密碼
    let isPasswordValid = false;
    try {
      isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Login failed: bcrypt error (${normalizedEmail})`,
        err?.stack,
      );
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!isPasswordValid) {
      this.logger.warn(`Login failed: invalid password (${emailInput})`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 檢查使用者是否啟用
    if (!user.isActive) {
      this.logger.warn(`Login failed: user disabled (${emailInput})`);
      throw new UnauthorizedException('User account is disabled');
    }

    this.logger.log(`User logged in: ${normalizedEmail}`);

    // 產生 JWT token
    const token = await this.generateToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      access_token: token,
    };
  }

  /**
   * 驗證使用者（用於 JWT Strategy）
   * @param userId - 使用者 ID
   * @returns 使用者資訊
   */
  async validateUser(userId: string) {
    try {
      const user = await this.usersService.findById(userId);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new UnauthorizedException('User not found or inactive');
      }
      throw error;
    }
  }

  /**
   * 產生 JWT Token
   * @param userId - 使用者 ID
   * @param email - 使用者 Email
   * @returns JWT token 字串
   */
  private async generateToken(userId: string, email: string): Promise<string> {
    const payload = { sub: userId, email };
    return this.jwtService.signAsync(payload);
  }

  private buildPasswordResetUrl(token: string) {
    const appBaseUrl = this.configService.get<string>('APP_BASE_URL')?.trim();
    const corsOrigin = this.configService.get<string>('CORS_ORIGIN')?.trim();
    const configuredBaseUrl =
      appBaseUrl || (corsOrigin && corsOrigin !== '*' ? corsOrigin : '') || 'http://localhost:5173';
    const baseUrl = configuredBaseUrl.replace(/\/+$/, '');
    return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  }

  /**
   * 產生 2FA Secret
   */
  async generateTwoFactorSecret(userEmail: string) {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: 'EcomAccounting',
      label: userEmail,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: secret,
    });

    return {
      secret: secret.base32,
      otpauthUrl: totp.toString(),
    };
  }

  /**
   * 驗證 2FA Token
   */
  verifyTwoFactorToken(token: string, secret: string): boolean {
    const totp = new OTPAuth.TOTP({
      issuer: 'EcomAccounting',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const delta = totp.validate({ token, window: 1 });
    return delta !== null;
  }

  /**
   * 啟用 2FA (需先驗證 Token)
   */
  async enableTwoFactor(userId: string, token: string, secret: string) {
    const isValid = this.verifyTwoFactorToken(token, secret);
    if (!isValid) {
      throw new BadRequestException('Invalid authentication code');
    }
    await this.usersService.updateTwoFactorConfig(userId, secret, true);
    return true;
  }
}
