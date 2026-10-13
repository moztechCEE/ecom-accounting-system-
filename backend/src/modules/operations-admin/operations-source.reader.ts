import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErpAfterSalesModuleService } from '../integration/after-sales/erp-module.service';
import { serviceSignature } from '../integration/after-sales/erp-module.contract';
@Injectable()
export class OperationsSourceReader {
  constructor(
    private readonly config: ConfigService,
    private readonly module: ErpAfterSalesModuleService,
  ) {}
  async read(
    actorId: string,
    entityId: string,
    section: 'audit-logs' | 'integration-status',
    query: URLSearchParams = new URLSearchParams(),
  ) {
    const permission = section === 'audit-logs' ? 'audit_logs' : 'settings';
    const actor = await this.module.actor(actorId, entityId);
    if (!actor.modules.includes(permission))
      throw new ForbiddenException('沒有此售後來源權限');
    const base =
      this.config.get<string>('AFTER_SALES_TASK_SOURCE_URL', '').trim() ||
      (this.config.get('ERP_DEV_SANDBOX') === 'true'
        ? 'https://corely-aftersales-module-dev-sp5g377smq-de.a.run.app/after-sales-app'
        : '');
    const secret = this.config.get<string>('AFTER_SALES_MODULE_SECRET', '');
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new ServiceUnavailableException('售後來源尚未設定');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['/', '/after-sales-app', '/after-sales-app/'].includes(url.pathname) ||
      secret.length < 32
    )
      throw new ServiceUnavailableException('售後來源設定不符');
    const path =
      '/api/integration/erp/workbench/' +
      section +
      (query.size ? '?' + query.toString() : '');
    const time = String(Math.floor(Date.now() / 1000));
    const response = await fetch(base.replace(/\/$/, '') + path, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        'x-erp-time': time,
        'x-erp-entity': entityId,
        'x-erp-actor': actorId,
        'x-erp-signature': serviceSignature(
          secret,
          'GET',
          path,
          time,
          entityId,
          actorId,
          '',
        ),
      },
    });
    const reader = response.body?.getReader();
    if (!reader) throw new BadGatewayException('售後來源回應缺少內容');
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1048576) {
          await reader.cancel();
          throw new BadGatewayException('售後來源回應過大');
        }
        parts.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!response.ok) throw new BadGatewayException('售後來源暫時無法讀取');
    let data: any;
    try {
      data = JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch {
      throw new BadGatewayException('售後來源格式不符');
    }
    if (
      data.contractVersion !== 'corely.doa.tasks.v1' ||
      !Array.isArray(data.items)
    )
      throw new BadGatewayException('售後來源版本不符');
    const current = await this.module.actor(actorId, entityId);
    if (!current.modules.includes(permission))
      throw new ForbiddenException('售後来源權限已變更');
    return data;
  }
}
