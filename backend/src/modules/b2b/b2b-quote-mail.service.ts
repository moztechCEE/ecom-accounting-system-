import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// The repository does not carry nodemailer's declaration package; keep this
// transport boundary narrow so delivery evidence is checked with typed data.
const smtpMailer = nodemailer as unknown as {
  createTransport(config: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  }): {
    sendMail(message: {
      from: string;
      to: string;
      subject: string;
      text: string;
    }): Promise<{
      accepted: string[];
    }>;
    close(): void;
  };
};

@Injectable()
export class B2bQuoteMailService {
  constructor(private readonly config: ConfigService) {}

  private settings() {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const portRaw = this.config.get<string>('SMTP_PORT')?.trim();
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS')?.trim();
    const originRaw = this.config
      .get<string>('B2B_PRIVATE_QUOTE_FRONTEND_ORIGIN')
      ?.trim();
    const port = Number(portRaw);
    if (
      !host ||
      !portRaw ||
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !from ||
      !originRaw ||
      !!user !== !!pass
    )
      throw new ServiceUnavailableException('私密報價電子郵件尚未完成設定');
    let origin: URL;
    try {
      origin = new URL(originRaw);
    } catch {
      throw new ServiceUnavailableException('私密報價網址設定無效');
    }
    if (
      origin.protocol !== 'https:' ||
      !origin.hostname ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.origin !== originRaw.replace(/\/$/, '')
    )
      throw new ServiceUnavailableException(
        '私密報價網址須為獨立的 HTTPS 網站來源',
      );
    return {
      host,
      port,
      from,
      auth: user && pass ? { user, pass } : undefined,
      origin: origin.origin,
    };
  }

  assertConfigured() {
    this.settings();
  }

  async send(params: {
    to: string;
    quotationNo: string;
    token: string;
    expiresAt: Date;
  }) {
    const config = this.settings();
    const link = `${config.origin}/b2b/private-quote#token=${encodeURIComponent(params.token)}`;
    const transport = smtpMailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.auth,
    });
    try {
      const result = await transport.sendMail({
        from: config.from,
        to: params.to,
        subject: `Corely 正式報價 ${params.quotationNo}`,
        text: [
          '您好：',
          '',
          `請以以下私密連結檢視並明確確認正式報價 ${params.quotationNo}：`,
          link,
          '',
          `連結有效至 ${params.expiresAt.toISOString()}；轉寄連結會讓收件者看到報價。`,
          '若非貴公司採購需求，請勿確認並聯絡業務。',
        ].join('\n'),
      });
      if (
        !result.accepted?.some(
          (address) => address.toLowerCase() === params.to.toLowerCase(),
        )
      )
        throw new Error('recipient not accepted by SMTP');
    } catch {
      // Never log a URL, token, or mail transport error that may contain them.
      throw new ServiceUnavailableException('私密報價電子郵件未成功交付 SMTP');
    } finally {
      transport.close();
    }
  }
}
