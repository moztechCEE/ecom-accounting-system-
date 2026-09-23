import {
  Controller,
  Post,
  Patch,
  Header,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { UpdateProfileDto, EnableTwoFactorDto } from './dto/account-settings.dto';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * AuthController
 * 認證控制器，處理使用者註冊與登入相關的 HTTP 請求
 */
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 使用者註冊
   */
  @Public()
  @Post('register')
  @ApiOperation({ summary: '使用者註冊' })
  @ApiResponse({ status: 201, description: '註冊成功' })
  @ApiResponse({ status: 409, description: 'Email 已存在' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /**
   * 使用者登入
   */
  @Public()
  @Get('login-entities')
  @ApiOperation({ summary: '取得登入頁可選事業別' })
  @ApiResponse({ status: 200, description: '成功取得登入事業別列表' })
  async getLoginEntities() {
    return this.authService.getLoginEntities();
  }

  /**
   * 使用者登入
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '使用者登入' })
  @ApiResponse({ status: 200, description: '登入成功' })
  @ApiResponse({ status: 401, description: '登入失敗' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '申請忘記密碼重設郵件' })
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '使用重設 token 設定新密碼' })
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.authService.confirmPasswordReset(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登入後修改自己的密碼' })
  async changePassword(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(req.user.id, dto);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  updateProfile(@Req() req: Request & { user: { id: string } }, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.id, dto.name);
  }

  @Get('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  setupTwoFactor(@Req() req: Request & { user: { id: string } }) {
    return this.authService.generateTwoFactorSecret(req.user.id);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  enableTwoFactor(@Req() req: Request & { user: { id: string } }, @Body() body: EnableTwoFactorDto) {
    return this.authService.enableTwoFactor(req.user.id, body.token, body.setupToken, body.currentPassword);
  }
}
