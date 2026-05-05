import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);

  constructor(private readonly configService: ConfigService) {}

  private getTransportConfig() {
    const host = this.configService.get<string>('SMTP_HOST')?.trim();
    const portValue = this.configService.get<string>('SMTP_PORT')?.trim();
    const user = this.configService.get<string>('SMTP_USER')?.trim();
    const pass = this.configService.get<string>('SMTP_PASS')?.trim();
    const from = this.configService.get<string>('SMTP_FROM')?.trim();

    if (!host || !portValue || !from) {
      return null;
    }

    const port = Number(portValue);
    if (!Number.isFinite(port)) {
      return null;
    }

    return {
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
      from,
    };
  }

  isConfigured() {
    return this.getTransportConfig() !== null;
  }

  async sendPasswordResetEmail(params: {
    to: string;
    name: string;
    resetUrl: string;
  }) {
    const config = this.getTransportConfig();
    if (!config) {
      this.logger.warn(
        `SMTP not configured. Password reset email not sent for ${params.to}. Reset URL: ${params.resetUrl}`,
      );
      return { sent: false };
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });

    await transporter.sendMail({
      from: config.from,
      to: params.to,
      subject: '重設您的系統密碼',
      text: [
        `Hi ${params.name || '使用者'},`,
        '',
        '我們收到您的密碼重設申請，請點擊以下連結重新設定密碼：',
        params.resetUrl,
        '',
        '此連結將於 30 分鐘後失效。',
        '如果這不是您本人操作，請忽略這封信。',
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <p>Hi ${params.name || '使用者'},</p>
          <p>我們收到您的密碼重設申請，請點擊以下按鈕重新設定密碼：</p>
          <p>
            <a href="${params.resetUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">
              重新設定密碼
            </a>
          </p>
          <p>如果按鈕無法點擊，也可以直接複製這個連結：</p>
          <p><a href="${params.resetUrl}">${params.resetUrl}</a></p>
          <p>此連結將於 30 分鐘後失效。如果這不是您本人操作，請忽略這封信。</p>
        </div>
      `,
    });

    return { sent: true };
  }
}
