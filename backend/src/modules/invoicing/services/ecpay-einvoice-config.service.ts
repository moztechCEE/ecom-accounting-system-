import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvoiceMerchantEnvironment,
  InvoiceMerchantReadiness,
  InvoiceProviderReadiness,
} from '../interfaces/invoice-adapter.interface';

export type EcpayEinvoiceProfile = {
  key: string;
  merchantId: string;
  hashKey: string;
  hashIv: string;
  entityId: string;
  env: InvoiceMerchantEnvironment;
  issueUrl: string;
  queryUrl: string;
  invalidUrl: string;
  allowanceUrl: string;
  allowanceInvalidUrl: string;
  description: string;
};

const ECPAY_STAGE_BASE_URL = 'https://einvoice-stage.ecpay.com.tw';
const ECPAY_PRODUCTION_BASE_URL = 'https://einvoice.ecpay.com.tw';

const DEFAULT_MERCHANTS: Array<
  Pick<EcpayEinvoiceProfile, 'key' | 'merchantId' | 'entityId' | 'description'>
> = [
  {
    key: 'shopify-main',
    merchantId: '3290494',
    entityId: 'tw-entity-001',
    description: 'MOZTECH Shopify official site',
  },
  {
    key: 'groupbuy-main',
    merchantId: '3150241',
    entityId: 'tw-entity-001',
    description: '1Shop / groupbuy / future Shopline',
  },
];

@Injectable()
export class EcpayEinvoiceConfigService {
  private readonly logger = new Logger(EcpayEinvoiceConfigService.name);
  private readonly profiles: EcpayEinvoiceProfile[];

  constructor(private readonly configService: ConfigService) {
    this.profiles = this.loadProfiles();
  }

  getProfiles() {
    return this.profiles;
  }

  resolveProfile(merchantKey?: string | null, merchantId?: string | null) {
    const normalizedKey = merchantKey?.trim();
    const normalizedMerchantId = merchantId?.trim();

    if (normalizedKey || normalizedMerchantId) {
      return this.profiles.find(
        (profile) =>
          (normalizedKey &&
            (profile.key === normalizedKey ||
              profile.merchantId === normalizedKey)) ||
          (normalizedMerchantId && profile.merchantId === normalizedMerchantId),
      );
    }

    const readyProfiles = this.profiles.filter(
      (profile) => this.getProfileMissingFields(profile).length === 0,
    );

    if (readyProfiles.length === 1) {
      return readyProfiles[0];
    }

    return null;
  }

  getReadiness(): InvoiceProviderReadiness {
    const accounts = this.profiles.map((profile) => this.toReadiness(profile));
    const readyAccounts = accounts.filter((account) => account.ready);

    const message =
      readyAccounts.length > 0
        ? `已設定 ${readyAccounts.length} 個可用綠界電子發票帳號。`
        : '尚未設定可正式開票的綠界電子發票帳號。';

    return {
      provider: 'ecpay',
      ready: readyAccounts.length > 0,
      canIssue: readyAccounts.length > 0,
      message,
      requiredEnv: [
        'ECPAY_EINVOICE_ACCOUNTS_JSON',
        'merchantId',
        'hashKey',
        'hashIv',
        'issueUrl',
        'queryUrl',
      ],
      accounts,
    };
  }

  getProfileMissingFields(profile: EcpayEinvoiceProfile) {
    const missing: string[] = [];
    if (!profile.merchantId) missing.push('merchantId');
    if (!profile.hashKey) missing.push('hashKey');
    if (!profile.hashIv) missing.push('hashIv');
    if (!profile.issueUrl) missing.push('issueUrl');
    if (!profile.queryUrl) missing.push('queryUrl');
    if (!profile.invalidUrl) missing.push('invalidUrl');
    if (!profile.allowanceUrl) missing.push('allowanceUrl');
    return missing;
  }

  private toReadiness(profile: EcpayEinvoiceProfile): InvoiceMerchantReadiness {
    const missing = this.getProfileMissingFields(profile);
    return {
      key: profile.key,
      merchantId: profile.merchantId || null,
      entityId: profile.entityId || null,
      description: profile.description || null,
      env: profile.env,
      issueUrl: profile.issueUrl || null,
      queryUrl: profile.queryUrl || null,
      invalidUrl: profile.invalidUrl || null,
      allowanceUrl: profile.allowanceUrl || null,
      ready: missing.length === 0,
      missing,
    };
  }

  private loadProfiles() {
    const parsedProfiles = this.loadConfiguredProfiles();
    const profiles = [...parsedProfiles];

    for (const merchant of DEFAULT_MERCHANTS) {
      if (
        !profiles.some(
          (profile) =>
            profile.key === merchant.key ||
            profile.merchantId === merchant.merchantId,
        )
      ) {
        profiles.push(this.normalizeProfile(merchant));
      }
    }

    return profiles;
  }

  private loadConfiguredProfiles() {
    const envCandidates = [
      {
        name: 'ECPAY_EINVOICE_ACCOUNTS_JSON',
        value:
          this.configService.get<string>('ECPAY_EINVOICE_ACCOUNTS_JSON', '') ||
          '',
      },
      {
        name: 'ECPAY_INVOICE_MERCHANTS_JSON',
        value:
          this.configService.get<string>('ECPAY_INVOICE_MERCHANTS_JSON', '') ||
          '',
      },
      {
        name: 'ECPAY_MERCHANTS_JSON',
        value: this.configService.get<string>('ECPAY_MERCHANTS_JSON', '') || '',
      },
    ];

    const candidate = envCandidates.find((item) => item.value.trim());
    if (!candidate) {
      return [];
    }

    try {
      const parsed = JSON.parse(candidate.value);
      if (!Array.isArray(parsed)) {
        this.logger.warn(`${candidate.name} must be a JSON array.`);
        return [];
      }

      return parsed
        .map((item) => this.normalizeProfile(item))
        .filter((profile) => profile.key || profile.merchantId);
    } catch (error) {
      this.logger.warn(
        `Failed to parse ${candidate.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private normalizeProfile(item: any): EcpayEinvoiceProfile {
    const env = this.normalizeEnv(item?.env || item?.environment);
    const baseUrl =
      env === 'stage' ? ECPAY_STAGE_BASE_URL : ECPAY_PRODUCTION_BASE_URL;
    const merchantId =
      typeof item?.merchantId === 'string' ? item.merchantId.trim() : '';

    return {
      key:
        typeof item?.key === 'string' && item.key.trim()
          ? item.key.trim()
          : merchantId,
      merchantId,
      hashKey: this.pickTrimmed(item?.invoiceHashKey, item?.hashKey),
      hashIv: this.pickTrimmed(item?.invoiceHashIv, item?.hashIv),
      entityId: this.pickTrimmed(item?.entityId),
      env,
      issueUrl: this.pickTrimmed(
        item?.issueUrl,
        item?.b2cIssueUrl,
        `${baseUrl}/B2CInvoice/Issue`,
      ),
      queryUrl: this.pickTrimmed(
        item?.queryUrl,
        item?.getIssueUrl,
        item?.invoiceApiUrl,
        item?.apiUrl,
        `${baseUrl}/B2CInvoice/GetIssue`,
      ),
      invalidUrl: this.pickTrimmed(
        item?.invalidUrl,
        item?.voidUrl,
        `${baseUrl}/B2CInvoice/Invalid`,
      ),
      allowanceUrl: this.pickTrimmed(
        item?.allowanceUrl,
        `${baseUrl}/B2CInvoice/Allowance`,
      ),
      allowanceInvalidUrl: this.pickTrimmed(
        item?.allowanceInvalidUrl,
        `${baseUrl}/B2CInvoice/AllowanceInvalid`,
      ),
      description:
        typeof item?.description === 'string' ? item.description.trim() : '',
    };
  }

  private normalizeEnv(value: unknown): InvoiceMerchantEnvironment {
    const normalized =
      typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === 'stage' ||
      normalized === 'staging' ||
      normalized === 'test'
      ? 'stage'
      : 'production';
  }

  private pickTrimmed(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  }
}
