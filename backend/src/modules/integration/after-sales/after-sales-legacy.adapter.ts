import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AfterSalesReadiness,
  LegacyAfterSalesCaseDetail,
  LegacyAfterSalesCaseList,
  LegacyAfterSalesHealth,
} from './after-sales-legacy.types';
import {
  projectWorkbenchDetail,
  projectWorkbenchList,
} from './after-sales-workbench.projection';

type ListCasesInput = {
  limit?: number;
  cursor?: string;
  updatedAfter?: string;
  includeDeleted?: boolean;
};

@Injectable()
export class AfterSalesLegacyAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly useCloudRunIam: boolean;
  private readonly cloudRunAudience: string;
  private cloudRunIdentityToken?: { value: string; refreshAt: number };

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('AFTER_SALES_LEGACY_BASE_URL', '') || ''
    ).replace(/\/+$/, '');
    this.apiKey =
      this.configService.get<string>('AFTER_SALES_LEGACY_API_KEY', '') || '';

    const configuredTimeout = Number(
      this.configService.get<string>('AFTER_SALES_LEGACY_TIMEOUT_MS', '10000'),
    );
    this.timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 10000;
    this.useCloudRunIam =
      this.configService.get<string>(
        'AFTER_SALES_LEGACY_USE_CLOUD_RUN_IAM',
        'false',
      ) === 'true';
    this.cloudRunAudience =
      this.configService.get<string>(
        'AFTER_SALES_LEGACY_CLOUD_RUN_AUDIENCE',
        '',
      ) || this.getBaseUrlOrigin();
  }

  async getReadiness(): Promise<AfterSalesReadiness> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        connected: false,
        mode: 'read_only',
        contractVersion: null,
        sourceCommit: null,
        featureBaseline: null,
        checkedAt: new Date().toISOString(),
        reason: 'not_configured',
      };
    }

    try {
      const health = await this.request<LegacyAfterSalesHealth>(
        '/api/integration/v1/health',
      );

      return {
        configured: true,
        connected: health.ok === true,
        mode: 'read_only',
        contractVersion: health.contractVersion,
        sourceCommit: health.sourceCommit,
        featureBaseline: health.featureBaseline ?? null,
        checkedAt: health.checkedAt,
      };
    } catch {
      return {
        configured: true,
        connected: false,
        mode: 'read_only',
        contractVersion: null,
        sourceCommit: null,
        featureBaseline: null,
        checkedAt: new Date().toISOString(),
        reason: 'connection_failed',
      };
    }
  }

  listCases(input: ListCasesInput) {
    const query = new URLSearchParams();
    if (input.limit) query.set('limit', String(input.limit));
    if (input.cursor) query.set('cursor', input.cursor);
    if (input.updatedAfter) query.set('updatedAfter', input.updatedAfter);
    if (input.includeDeleted) query.set('includeDeleted', 'true');

    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.request<LegacyAfterSalesCaseList>(
      `/api/integration/v1/cases${suffix}`,
    );
  }

  getCase(caseId: string) {
    return this.request<LegacyAfterSalesCaseDetail>(
      `/api/integration/v1/cases/${encodeURIComponent(caseId)}`,
    );
  }

  async getWorkbench(input: {
    page?: number;
    pageSize?: number;
    view?: string;
    type?: string;
    status?: string;
    search?: string;
  }) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input))
      if (value !== undefined && value !== '') query.set(key, String(value));
    return projectWorkbenchList(
      await this.request<Record<string, unknown>>(
        `/api/integration/v1/workbench/cases?${query}`,
      ),
    );
  }

  async getWorkbenchCase(caseId: string) {
    return projectWorkbenchDetail(
      await this.request<Record<string, unknown>>(
        `/api/integration/v1/workbench/cases/${encodeURIComponent(caseId)}`,
      ),
      caseId,
    );
  }

  private isConfigured() {
    if (!this.baseUrl || !this.apiKey) return false;

    try {
      const parsed = new URL(this.baseUrl);
      return parsed.protocol === 'https:' || parsed.hostname === 'localhost';
    } catch {
      return false;
    }
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('售後系統唯讀整合尚未完成設定');
    }
  }

  private getBaseUrlOrigin() {
    try {
      return new URL(this.baseUrl).origin;
    } catch {
      return '';
    }
  }

  private async getCloudRunIdentityToken() {
    if (!this.useCloudRunIam) return null;
    if (!this.cloudRunAudience) {
      throw new ServiceUnavailableException(
        '售後系統 Cloud Run audience 尚未設定',
      );
    }

    if (
      this.cloudRunIdentityToken &&
      this.cloudRunIdentityToken.refreshAt > Date.now()
    ) {
      return this.cloudRunIdentityToken.value;
    }

    const metadataUrl = new URL(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity',
    );
    metadataUrl.searchParams.set('audience', this.cloudRunAudience);
    metadataUrl.searchParams.set('format', 'full');

    const response = await fetch(metadataUrl, {
      method: 'GET',
      headers: { 'Metadata-Flavor': 'Google' },
      redirect: 'error',
      signal: AbortSignal.timeout(Math.min(this.timeoutMs, 3000)),
    });
    const value = response.ok ? (await response.text()).trim() : '';

    if (!value) {
      throw new BadGatewayException('無法取得售後系統 Cloud Run 服務身分');
    }

    this.cloudRunIdentityToken = {
      value,
      refreshAt: Date.now() + 50 * 60 * 1000,
    };
    return value;
  }

  private async request<T>(path: string): Promise<T> {
    this.assertConfigured();

    try {
      const cloudRunIdentityToken = await this.getCloudRunIdentityToken();
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...(cloudRunIdentityToken
            ? {
                'X-Serverless-Authorization': `Bearer ${cloudRunIdentityToken}`,
              }
            : {}),
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.status === 404) {
        throw new NotFoundException('找不到售後案件');
      }

      if (response.status === 401 || response.status === 403) {
        throw new BadGatewayException('售後系統拒絕 ERP 服務憑證');
      }

      if (!response.ok) {
        throw new BadGatewayException('售後系統暫時無法提供資料');
      }

      return (await response.json()) as T;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException('售後系統查詢逾時');
      }

      throw new BadGatewayException('無法連線至售後系統');
    }
  }
}
