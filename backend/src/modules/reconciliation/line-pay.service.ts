import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'crypto';

type LinePayEnvironment = 'production' | 'sandbox';

type LinePayProfile = {
  key: string;
  entityId: string;
  companyName: string | null;
  brandName: string | null;
  merchantId: string;
  channelId: string;
  channelSecret: string;
  env: LinePayEnvironment;
  sourceChannel: string;
  ecpayMerchantKey: string | null;
};

type LinePayPaymentQuery = {
  profileKey?: string;
  transactionId?: string;
  orderId?: string;
};

@Injectable()
export class LinePayService {
  private readonly logger = new Logger(LinePayService.name);
  private readonly profiles: LinePayProfile[];

  constructor(private readonly configService: ConfigService) {
    this.profiles = this.loadProfiles();
  }

  getConfigStatus() {
    return {
      configured: this.profiles.length > 0,
      profiles: this.profiles.map((profile) => ({
        key: profile.key,
        entityId: profile.entityId,
        companyName: profile.companyName,
        brandName: profile.brandName,
        merchantId: profile.merchantId,
        channelId: this.mask(profile.channelId),
        env: profile.env,
        sourceChannel: profile.sourceChannel,
        ecpayMerchantKey: profile.ecpayMerchantKey,
        hasChannelSecret: Boolean(profile.channelSecret),
      })),
    };
  }

  async getPaymentDetails(query: LinePayPaymentQuery) {
    const profile = this.resolveProfile(query.profileKey);
    const params = new URLSearchParams();

    if (query.transactionId?.trim()) {
      params.set('transactionId', query.transactionId.trim());
    }

    if (query.orderId?.trim()) {
      params.set('orderId', query.orderId.trim());
    }

    if (!params.toString()) {
      throw new BadRequestException('transactionId or orderId is required');
    }

    const requestPath = '/v3/payments';
    const queryString = params.toString();
    const response = await this.request(profile, requestPath, queryString);

    return {
      profile: {
        key: profile.key,
        merchantId: profile.merchantId,
        brandName: profile.brandName,
        sourceChannel: profile.sourceChannel,
      },
      raw: response,
    };
  }

  private async request(
    profile: LinePayProfile,
    requestPath: string,
    queryString = '',
  ) {
    const nonce = randomUUID();
    const signature = this.sign(profile, requestPath, queryString, nonce);
    const url = `${this.resolveBaseUrl(profile)}${requestPath}${
      queryString ? `?${queryString}` : ''
    }`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-LINE-ChannelId': profile.channelId,
        'X-LINE-Authorization-Nonce': nonce,
        'X-LINE-Authorization': signature,
      },
    });

    const text = await response.text();
    let body: unknown = text;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      this.logger.warn(`LINE Pay returned non-JSON response: ${text}`);
    }

    if (!response.ok) {
      throw new ServiceUnavailableException({
        message: `LINE Pay API failed with ${response.status}`,
        body,
      });
    }

    return body;
  }

  private sign(
    profile: LinePayProfile,
    requestPath: string,
    queryString: string,
    nonce: string,
  ) {
    const message = `${profile.channelSecret}${requestPath}${queryString}${nonce}`;

    return createHmac('sha256', profile.channelSecret)
      .update(message)
      .digest('base64');
  }

  private resolveProfile(profileKey?: string) {
    if (!this.profiles.length) {
      throw new BadRequestException(
        'LINE Pay profile is not configured. Please set LINE_PAY_ACCOUNTS_JSON or LINE_PAY_* env vars.',
      );
    }

    if (!profileKey?.trim()) {
      return this.profiles[0];
    }

    const normalizedKey = profileKey.trim();
    const profile = this.profiles.find(
      (item) =>
        item.key === normalizedKey ||
        item.merchantId === normalizedKey ||
        item.channelId === normalizedKey,
    );

    if (!profile) {
      throw new BadRequestException(`LINE Pay profile not found: ${profileKey}`);
    }

    return profile;
  }

  private resolveBaseUrl(profile: LinePayProfile) {
    return profile.env === 'sandbox'
      ? 'https://sandbox-api-pay.line.me'
      : 'https://api-pay.line.me';
  }

  private loadProfiles() {
    const profiles: LinePayProfile[] = [];
    const rawJson = this.configService.get<string>('LINE_PAY_ACCOUNTS_JSON', '');

    if (rawJson?.trim()) {
      try {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const profile = this.toProfile(item);
            if (profile) {
              profiles.push(profile);
            }
          }
        }
      } catch (error: any) {
        this.logger.warn(
          `Failed to parse LINE_PAY_ACCOUNTS_JSON: ${error.message}`,
        );
      }
    }

    const legacyProfile = this.toProfile({
      key: this.configService.get<string>('LINE_PAY_PROFILE_KEY', 'moztech-shopify'),
      entityId: this.configService.get<string>(
        'LINE_PAY_ENTITY_ID',
        this.configService.get<string>('DEFAULT_ENTITY_ID', 'tw-entity-001'),
      ),
      companyName: this.configService.get<string>('LINE_PAY_COMPANY_NAME', ''),
      brandName: this.configService.get<string>('LINE_PAY_BRAND_NAME', ''),
      merchantId: this.configService.get<string>('LINE_PAY_MERCHANT_ID', ''),
      channelId: this.configService.get<string>('LINE_PAY_CHANNEL_ID', ''),
      channelSecret: this.configService.get<string>(
        'LINE_PAY_CHANNEL_SECRET',
        '',
      ),
      env: this.configService.get<string>('LINE_PAY_ENV', 'production'),
      sourceChannel: this.configService.get<string>(
        'LINE_PAY_SOURCE_CHANNEL',
        'shopify',
      ),
      ecpayMerchantKey: this.configService.get<string>(
        'LINE_PAY_ECPAY_MERCHANT_KEY',
        'shopify-main',
      ),
    });

    if (
      legacyProfile &&
      !profiles.some((profile) => profile.key === legacyProfile.key)
    ) {
      profiles.push(legacyProfile);
    }

    return profiles;
  }

  private toProfile(raw: any): LinePayProfile | null {
    const channelId = this.clean(raw?.channelId || raw?.channel_id);
    const channelSecret = this.clean(
      raw?.channelSecret || raw?.channel_secret,
    );
    const merchantId = this.clean(raw?.merchantId || raw?.merchant_id);

    if (!channelId || !channelSecret || !merchantId) {
      return null;
    }

    return {
      key: this.clean(raw?.key) || merchantId,
      entityId:
        this.clean(raw?.entityId || raw?.entity_id) ||
        this.configService.get<string>('DEFAULT_ENTITY_ID', 'tw-entity-001'),
      companyName: this.clean(raw?.companyName || raw?.company_name),
      brandName: this.clean(raw?.brandName || raw?.brand_name),
      merchantId,
      channelId,
      channelSecret,
      env: this.normalizeEnv(raw?.env),
      sourceChannel: this.clean(raw?.sourceChannel || raw?.source_channel) || 'shopify',
      ecpayMerchantKey:
        this.clean(raw?.ecpayMerchantKey || raw?.ecpay_merchant_key) || null,
    };
  }

  private normalizeEnv(value: unknown): LinePayEnvironment {
    return String(value || '').toLowerCase() === 'sandbox'
      ? 'sandbox'
      : 'production';
  }

  private clean(value: unknown) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
  }

  private mask(value: string) {
    if (value.length <= 6) {
      return '***';
    }

    return `${value.slice(0, 3)}***${value.slice(-3)}`;
  }
}
