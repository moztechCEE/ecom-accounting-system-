import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErpAfterSalesModuleService } from '../integration/after-sales/erp-module.service';
import { serviceSignature } from '../integration/after-sales/erp-module.contract';
import { MailroomService } from './mailroom.service';
import { can, requireEntity } from './mailroom.contract';
import { physicalCustody, repairWorkflow } from './repair-workflow.contract';
import {
  AfterSalesOptionsQuery,
  AfterSalesTasksQuery,
  RegisterAfterSalesCaseDto,
} from './after-sales-tasks.dto';

const CONTRACT = 'corely.doa.tasks.v1';
const DEV_SOURCE =
  'https://corely-aftersales-module-dev-sp5g377smq-de.a.run.app/after-sales-app';
const SOURCE_PATH = '/api/integration/erp/workbench';
type SourceItem = {
  id: string;
  number: string;
  type: string;
  [key: string]: unknown;
};
type SourceResponse = {
  contractVersion: string;
  items?: SourceItem[];
  item?: SourceItem;
  [key: string]: unknown;
};
const sameCaseIds = (left: string[], right: string[]) => {
  const expected = new Set(left);
  const current = new Set(right);
  return (
    expected.size === current.size &&
    [...expected].every((id) => current.has(id))
  );
};

@Injectable()
export class AfterSalesTasksService {
  constructor(
    private readonly config: ConfigService,
    private readonly module: ErpAfterSalesModuleService,
    private readonly db: PrismaService,
    private readonly mailroom: MailroomService,
  ) {}

  private source() {
    const base =
      this.config.get<string>('AFTER_SALES_TASK_SOURCE_URL', '').trim() ||
      (this.config.get('ERP_DEV_SANDBOX') === 'true' ? DEV_SOURCE : '');
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new ServiceUnavailableException('售後案件來源尚未設定');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['/', '/after-sales-app', '/after-sales-app/'].includes(url.pathname)
    )
      throw new ServiceUnavailableException('售後案件來源設定不符');
    const secret = this.config.get<string>('AFTER_SALES_MODULE_SECRET', '');
    if (secret.length < 32)
      throw new ServiceUnavailableException('售後案件來源尚未開通');
    return { base: url.toString().replace(/\/$/, ''), secret };
  }
  private async request(
    userId: string,
    entityId: string,
    suffix: string,
    method: 'GET' | 'POST' = 'GET',
    payload?: unknown,
  ): Promise<SourceResponse> {
    const actor = await this.module.actor(userId, entityId);
    if (
      !actor.modules.includes('cases') ||
      (method === 'POST' && !actor.writeModules.includes('cases'))
    )
      throw new ForbiddenException('沒有此售後案件操作權限');
    const { base, secret } = this.source();
    const url = new URL(base + SOURCE_PATH + suffix);
    const path = SOURCE_PATH + suffix;
    const body = method === 'POST' ? JSON.stringify(payload) : '';
    if (Buffer.byteLength(body) > 65536)
      throw new BadRequestException('案件內容過大');
    const time = Math.floor(Date.now() / 1000).toString();
    let response: Response;
    try {
      response = await fetch(url.href, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: {
          'content-type': 'application/json',
          'x-erp-time': time,
          'x-erp-entity': entityId,
          'x-erp-actor': userId,
          'x-erp-signature': serviceSignature(
            secret,
            method,
            path,
            time,
            entityId,
            userId,
            body,
          ),
        },
        ...(method === 'POST' ? { body } : {}),
      });
    } catch (error) {
      if ((error as { name?: string }).name === 'TimeoutError')
        throw new GatewayTimeoutException('售後來源讀取逾時，請重試');
      throw new BadGatewayException('售後來源連線失敗');
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (!reader) throw new BadGatewayException('售後來源回應缺少內容');
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1048576) {
          await reader.cancel();
          throw new BadGatewayException('售後來源回應過大');
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    let result: SourceResponse;
    try {
      result = JSON.parse(
        Buffer.concat(chunks).toString('utf8'),
      ) as SourceResponse;
    } catch {
      throw new BadGatewayException('售後來源回應格式不符');
    }
    if (!response.ok) {
      const raw = (result as unknown as { error?: unknown }).error;
      const message =
        typeof raw === 'string' && raw.length < 300
          ? raw
          : '售後案件操作未完成';
      if (response.status === 403 || response.status === 401)
        throw new ForbiddenException(message);
      if (response.status === 404) throw new NotFoundException(message);
      if (response.status === 409) throw new ConflictException(message);
      if (response.status === 400 || response.status === 422)
        throw new BadRequestException(message);
      throw new BadGatewayException('售後來源暫時無法完成操作');
    }
    if (!result || result.contractVersion !== CONTRACT)
      throw new BadGatewayException('售後案件接口版本不符');
    // A permission change during the upstream read must not return stale authorization.
    let current: Awaited<ReturnType<ErpAfterSalesModuleService['actor']>>;
    try {
      current = await this.module.actor(userId, entityId);
    } catch (error) {
      if (method === 'POST')
        throw new ServiceUnavailableException(
          '案件結果待確認，請使用原操作重試',
        );
      throw error;
    }
    if (
      !current.modules.includes('cases') ||
      (method === 'POST' && !current.writeModules.includes('cases'))
    )
      throw method === 'POST'
        ? new ServiceUnavailableException('案件結果待確認，請使用原操作重試')
        : new ForbiddenException('售後案件權限已變更');
    return result;
  }
  private async repairContext(
    userId: string,
    entityId: string,
    caseIds?: string[],
  ) {
    if (this.config.get('MAILROOM_ENABLED') !== 'true')
      return {
        mineIds: [] as string[],
        tasks: [] as Record<string, unknown>[],
        overflow: false,
      };
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, entityId);
    if (!can(actor, 'mailroom:review'))
      return {
        mineIds: [] as string[],
        tasks: [] as Record<string, unknown>[],
        overflow: false,
      };
    const rows = await this.db.mailroomItem.findMany({
      where: {
        entityId,
        receipt: {
          entityId,
          sourceCaseId: caseIds ? { in: caseIds } : { not: null },
        },
        OR: [
          { receipt: { category: 'REPAIR' } },
          { receipt: { category: 'RETURN' }, repairOwnerId: { not: null } },
        ],
        ...(caseIds ? {} : { status: 'WAITING_CUSTOMER' }),
      },
      include: { receipt: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      ...(caseIds ? {} : { take: 501 }),
    });
    const mineIds = new Set<string>();
    const tasks: Record<string, unknown>[] = [];
    for (const row of rows) {
      const csr = repairWorkflow(row.repairWorkflow).csr;
      const actionable =
        row.status === 'WAITING_CUSTOMER' &&
        !!csr &&
        ((csr.status === 'SENT' &&
          (!csr.sentToUserId || csr.sentToUserId === userId)) ||
          (csr.status === 'ACCEPTED' && csr.ownerId === userId));
      if (actionable && row.receipt.sourceCaseId)
        mineIds.add(row.receipt.sourceCaseId);
      if (caseIds)
        tasks.push({
          kind: 'repair',
          itemId: row.id,
          sourceCaseId: row.receipt.sourceCaseId,
          label: row.productName || row.label,
          status: row.status,
          version: row.version,
          actionable,
          csr: csr
            ? {
                status: csr.status,
                ownerId: csr.ownerId,
                sentToUserId: csr.sentToUserId,
              }
            : null,
          owner: csr
            ? {
                erpUserId:
                  csr.status === 'ACCEPTED' ? csr.ownerId : csr.sentToUserId,
                name: actionable
                  ? csr.status === 'SENT' && !csr.sentToUserId
                    ? '待客服認領'
                    : actor.name
                  : null,
                status: csr.status,
              }
            : null,
        });
    }
    return {
      mineIds: [...mineIds].slice(0, 100),
      tasks,
      overflow: rows.length > 500 || mineIds.size > 100,
    };
  }
  async list(userId: string, query: AfterSalesTasksQuery) {
    await this.module.actor(userId, query.entityId);
    const context = await this.repairContext(userId, query.entityId);
    const signedMineIds = [...context.mineIds].sort();
    const search = new URLSearchParams();
    for (const key of [
      'scope',
      'lifecycle',
      'type',
      'stage',
      'brand',
      'search',
      'page',
      'pageSize',
    ] as const)
      if (query[key] !== undefined && query[key] !== '')
        search.set(key, String(query[key]));
    if (signedMineIds.length)
      search.set('erpMineCaseIds', JSON.stringify(signedMineIds));
    const queryString = search.toString();
    const result = await this.request(
      userId,
      query.entityId,
      '/cases' + (queryString ? '?' + queryString : ''),
    );
    if (
      !Array.isArray(result.items) ||
      result.items.length > 100 ||
      result.items.some(
        (item) =>
          !item ||
          typeof item.id !== 'string' ||
          typeof item.number !== 'string',
      )
    )
      throw new BadGatewayException('售後案件清單格式不符');
    // Source counts and pagination already include the signed personal union.
    // A changed handoff invalidates the entire response, not just visible rows.
    const fresh = await this.repairContext(userId, query.entityId);
    if (
      !sameCaseIds(signedMineIds, fresh.mineIds) ||
      context.overflow !== fresh.overflow
    )
      throw new ConflictException('交辦已更新，請重新整理案件清單');
    const pageIds = new Set(result.items.map((item) => item.id));
    const exact = await this.repairContext(userId, query.entityId, [
      ...pageIds,
    ]);
    const signed = new Set(signedMineIds);
    const expectedPageMine = signedMineIds.filter((id) => pageIds.has(id));
    const exactPageMine = exact.mineIds.filter(
      (id) => pageIds.has(id) && (!fresh.overflow || signed.has(id)),
    );
    // Catch another reassignment during the exact task read. In an overflowed
    // queue only the bounded signed union influenced Source ownership/counts.
    if (!sameCaseIds(expectedPageMine, exactPageMine))
      throw new ConflictException('交辦已更新，請重新整理案件清單');
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        tasks: exact.tasks.filter((task) => task.sourceCaseId === item.id),
      })),
      handoffs: { repairQueueHasMore: fresh.overflow },
    };
  }
  async options(userId: string, query: AfterSalesOptionsQuery) {
    const result = await this.request(
      userId,
      query.entityId,
      '/options' +
        (query.search
          ? '?' +
            new URLSearchParams({ search: query.search.trim() }).toString()
          : ''),
    );
    // The existing delegated actor authorizes the pinned company scope. The
    // browser must consume this server capability rather than inventing it.
    return { ...result, canReadAll: true };
  }
  async detail(userId: string, entityId: string, id: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
      throw new BadRequestException('案件識別碼不正確');
    const result = await this.request(
      userId,
      entityId,
      '/cases/' + encodeURIComponent(id),
    );
    if (result.item?.id !== id)
      throw new BadGatewayException('售後案件詳情識別不符');
    const context = await this.repairContext(userId, entityId, [id]);
    const physical = await this.casePhysicalSummary(entityId, id);
    await this.module.actor(userId, entityId);
    const sourceHistory = Array.isArray(result.history) ? result.history : [];
    return {
      ...result, tasks: context.tasks, ...physical,
      history: [...sourceHistory, ...physical.physicalHistory]
        .sort((a, b) => String((b as { occurredAt?: string }).occurredAt || '').localeCompare(String((a as { occurredAt?: string }).occurredAt || '')))
        .slice(0, 100),
    };
  }
  /** Case-authorized high-level custody; photos and technical documents remain on their guarded routes. */
  private async casePhysicalSummary(entityId: string, caseId: string) {
    if (this.config.get('MAILROOM_ENABLED') !== 'true') return { custodySummary: null, physicalHistory: [] };
    const rows = await this.db.mailroomItem.findMany({
      where: { entityId, receipt: { entityId, sourceCaseId: caseId } },
      select: { id: true, productName: true, status: true, location: true, custodianId: true, repairOwnerId: true, repairWorkflow: true, receipt: { select: { customerServiceUserId: true } } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 201,
    });
    if (rows.length > 200) return { custodySummary: '實物超過 200 件，請查看收發紀錄', physicalHistory: [] };
    if (!rows.length) return { custodySummary: null, physicalHistory: [] };
    const users = await this.db.user.findMany({ where: { id: { in: [...new Set(rows.map(row => row.custodianId))] } }, select: { id: true, name: true } });
    const names = new Map(users.map(user => [user.id, user.name]));
    const custodyLabels: Record<string, string> = { TECHNICIAN: '維修室', MAILROOM: '收發室', FACTORY_CARRIER: '送原廠物流', CUSTOMER_CARRIER: '寄回物流', FACTORY: '原廠', INVENTORY: '庫存', LINKED_CASE: '已轉其他案件', UNKNOWN: '保管位置待核對' };
    const custodySummary = rows.map(row => {
      const custody = physicalCustody(row);
      const owner = ['TECHNICIAN', 'MAILROOM'].includes(custody) ? names.get(row.custodianId) : null;
      return `${row.productName} · ${custodyLabels[custody] || custody}${owner ? '／' + owner : ''}${row.location && ['TECHNICIAN', 'MAILROOM'].includes(custody) ? ' · ' + row.location : ''}`;
    }).join('；');
    const actions = await this.db.mailroomAction.findMany({
      where: { entityId, itemId: { in: rows.map(row => row.id) } },
      select: { id: true, action: true, toStatus: true, actorName: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
    });
    return { custodySummary, physicalHistory: actions.map(action => ({ id: 'erp:' + action.id, type: action.action, title: '收發／維修進度', description: action.toStatus, actorName: action.actorName, occurredAt: action.createdAt.toISOString() })) };
  }
  async register(userId: string, input: RegisterAfterSalesCaseDto) {
    const { entityId, requestId, brand, customerKind, payload, verifiedApplicationRef } = input;
    return this.request(userId, entityId, '/cases', 'POST', {
      requestId,
      brand,
      customerKind,
      payload,
      ...(verifiedApplicationRef ? { verifiedApplicationRef } : {}),
    });
  }
  async applications(userId: string, entityId: string, status?: string, cursor?: string) {
    const params = new URLSearchParams(); if (status) params.set('status', status); if (cursor) params.set('cursor', cursor);
    const query = params.size ? '?' + params.toString() : '';
    const result = await this.request(userId, entityId, '/applications' + query);
    if (!Array.isArray(result.items) || result.items.some(row => row.companyId !== entityId)) throw new BadGatewayException('申請公司回應不符');
    return result;
  }
  async application(userId: string, entityId: string, id: string, index?: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || (index !== undefined && !['0', '1', '2', '3'].includes(index))) throw new BadRequestException('申請識別資料無效');
    const result = await this.request(userId, entityId, '/applications/' + id + (index !== undefined ? '/photos/' + index : ''));
    if (index === undefined && (result.id !== id || result.companyId !== entityId)) throw new BadGatewayException('申請識別回應不符');
    return result;
  }
  async applicationCommand(userId: string, entityId: string, command: Record<string, unknown>, id?: string) {
    if (id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException('申請識別資料無效');
    return this.request(userId, entityId, '/applications' + (id ? '/' + id : ''), 'POST', command);
  }
  async command(userId: string, entityId: string, caseId: string, suffix: 'communications' | 'repair-proposals/adopt' | 'factory-actions' | 'brand-review', command: Record<string, unknown>) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(caseId)) throw new BadRequestException('案件識別碼不正確');
    return this.request(userId, entityId, '/cases/' + encodeURIComponent(caseId) + '/' + suffix, 'POST', command);
  }
  async photo(userId: string, entityId: string, caseId: string, confirmationId: string, index: string) {
    if (![caseId, confirmationId].every(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)) || !['0', '1', '2', '3'].includes(index)) throw new BadRequestException('照片識別碼不正確');
    return this.request(userId, entityId, '/cases/' + encodeURIComponent(caseId) + '/communications/' + encodeURIComponent(confirmationId) + '/photos/' + index);
  }
}
