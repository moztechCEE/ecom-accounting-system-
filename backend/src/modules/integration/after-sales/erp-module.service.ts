import {
  ForbiddenException,
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { AuthService } from '../../auth/auth.service';
import { EntityAccessService } from '../../../common/entity-access/entity-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { publishedPublicDisplay } from '../../product/after-sales-public-display.contract';
import {
  hasSourceAdministrationPermissions,
  matchesSignature,
  moduleGrants,
  serviceSignature,
  SOURCE_SECTIONS,
} from './erp-module.contract';

@Injectable()
export class ErpAfterSalesModuleService {
  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly entityAccess: EntityAccessService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}
  /** Machine-only projection after Source verifies the invite and brand identity. No staff grants or private product fields. */
  async publicCatalog(req: { headers: Record<string, string>; method: string; originalUrl: string }, entityId: string) {
    const settings = this.settings(), actor = 'public-catalog', time = req.headers['x-erp-time'];
    if (entityId !== settings.entity || req.headers['x-erp-entity'] !== entityId || req.headers['x-erp-actor'] !== actor
      || typeof time !== 'string' || !/^\d{10}$/.test(time) || Math.abs(Date.now() / 1000 - Number(time)) > 60 || req.method !== 'GET'
      || req.headers['transfer-encoding'] !== undefined || req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0'
      || !req.originalUrl.startsWith('/api/v1/after-sales/module/public-catalog?')
      || !matchesSignature(req.headers['x-erp-signature'] || '', serviceSignature(settings.secret, 'GET', req.originalUrl, time, entityId, actor)))
      throw new UnauthorizedException('售後顯示服務簽章無效');
    const url = new URL(req.originalUrl, 'https://erp.invalid'), q = url.searchParams;
    const rawSearch = q.get('search') || '', search = rawSearch.trim(), limit = q.get('limit') || '20', brand = q.get('brand');
    if (url.pathname !== '/api/v1/after-sales/module/public-catalog' || url.hash || q.get('entityId') !== entityId
      || [...q.keys()].some(k => !['entityId', 'brand', 'search', 'limit'].includes(k) || q.getAll(k).length !== 1)
      || !['MOZTECH', 'BONSON'].includes(brand || '') || rawSearch.length > 100 || /[\x00-\x1f]/.test(rawSearch)
      || !/^[1-9]\d?$/.test(limit) || Number(limit) > 20) throw new BadRequestException('售後顯示查詢條件無效');
    if (!this.prisma) throw new ServiceUnavailableException('產品來源尚未開通');
    const term = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; sku: string; modelNumber: string | null; barcode: string | null; display: unknown }>>(Prisma.sql`
      SELECT p.id,p.name,p.sku,p.model_number AS "modelNumber",p.barcode,p.attributes->'afterSalesPublicDisplay' AS display
      FROM products p JOIN entities e ON e.id=p.entity_id
      WHERE p.entity_id=${entityId} AND p.is_active=true AND e.is_active=true
        AND p.attributes->'afterSalesPublicDisplay'->'version'='1'::jsonb
        AND p.attributes->'afterSalesPublicDisplay'->'published'='true'::jsonb
        AND p.attributes->'afterSalesPublicDisplay'->'brands' @> ${JSON.stringify([brand])}::jsonb
        AND (${search}='' OR p.name ILIKE ${term} OR p.sku ILIKE ${term} OR p.model_number ILIKE ${term} OR p.barcode ILIKE ${term}
          OR p.attributes->'afterSalesPublicDisplay'->>'displayName' ILIKE ${term}
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p.attributes->'afterSalesPublicDisplay'->'aliases')='array'
            THEN p.attributes->'afterSalesPublicDisplay'->'aliases' ELSE '[]'::jsonb END) a WHERE a ILIKE ${term}))
      ORDER BY p.sku,p.id LIMIT ${Number(limit) + 1}`);
    const items = rows.slice(0, Number(limit)).flatMap(row => {
      const display = publishedPublicDisplay(row.display, brand!);
      return display ? [{ id: row.id, name: display.displayName || row.name, sku: row.sku, modelNumber: row.modelNumber,
        barcode: row.barcode, imageUrl: display.imageUrl || null, aliases: display.aliases }] : [];
    });
    const result = { contractVersion: 'corely.erp.after-sales-public-catalog.v1', complete: rows.length <= Number(limit), items };
    if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new ServiceUnavailableException('售後顯示資料超出限制');
    return result;
  }
  async products(req: { headers: Record<string, string>; method: string; originalUrl: string }, userId: string, entityId: string) {
    const actor = await this.inspect(req, userId, entityId);
    if (!actor.modules.includes('cases') && !actor.modules.includes('products'))
      throw new ForbiddenException('沒有售後產品選用權限');
    const url = new URL(req.originalUrl, 'https://erp.invalid');
    const q = url.searchParams;
    if (url.pathname !== `/api/v1/after-sales/module/actors/${encodeURIComponent(userId)}/products`
      || [...q.keys()].some(key => !['entityId', 'search', 'ids', 'limit'].includes(key) || q.getAll(key).length !== 1)
      || q.get('entityId') !== entityId)
      throw new BadRequestException('產品查詢條件無效');
    const search = (q.get('search') || '').trim();
    const rawLimit = q.get('limit') || '50';
    if (search.length > 100 || /[\x00-\x1f]/.test(search) || !/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > 50)
      throw new BadRequestException('產品查詢條件無效');
    let ids: string[] | undefined;
    if (q.has('ids')) {
      try { ids = JSON.parse(q.get('ids')!) as string[]; } catch { throw new BadRequestException('產品識別資料無效'); }
      if (!Array.isArray(ids) || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length
        || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) || search)
        throw new BadRequestException('產品識別資料無效');
    }
    if (!this.prisma) throw new ServiceUnavailableException('產品來源尚未開通');
    const rows = await this.prisma.product.findMany({
      where: { entityId, isActive: true, ...(ids ? { id: { in: ids } } : {}),
        ...(search ? { OR: ['sku', 'name', 'barcode', 'modelNumber'].map(field => ({ [field]: { contains: search, mode: 'insensitive' as const } })) } : {}) },
      select: { id: true, entityId: true, sku: true, name: true, modelNumber: true, barcode: true, salesPrice: true, updatedAt: true, entity: { select: { baseCurrency: true } } },
      orderBy: [{ sku: 'asc' }, { id: 'asc' }], take: Math.max(Number(rawLimit), ids?.length || 0) + 1,
    });
    const fresh = await this.actor(userId, entityId);
    if (!fresh.modules.includes('cases') && !fresh.modules.includes('products')) throw new ForbiddenException('產品權限已變動');
    const limit = Math.max(Number(rawLimit), ids?.length || 0);
    return { contractVersion: 'corely.erp.products.v1', complete: rows.length <= limit, items: rows.slice(0, limit).map(row => ({
      id: row.id, entityId: row.entityId, sku: row.sku, name: row.name, model: row.modelNumber, barcode: row.barcode,
      unitPrice: row.salesPrice.toFixed(2), currency: row.entity.baseCurrency, warrantyMonths: null, updatedAt: row.updatedAt.toISOString(),
    })) };
  }
  private settings() {
    const entity = this.config
      .get<string>('AFTER_SALES_MODULE_ENTITY_ID', '')
      .trim();
    const secret = this.config.get<string>('AFTER_SALES_MODULE_SECRET', '');
    if (
      this.config.get('AFTER_SALES_MODULE_ENABLED') !== 'true' ||
      !entity ||
      secret.length < 32
    )
      throw new ServiceUnavailableException('售後整合模組尚未開通');
    return { entity, secret };
  }
  async actor(userId: string, entityId: string) {
    const { entity } = this.settings();
    if (entityId !== entity)
      throw new ForbiddenException('此公司尚未綁定售後來源');
    const user = await this.auth.validateUser(userId);
    if (user.mustChangePassword || (user.employee && !user.employee.isActive))
      throw new ForbiddenException('請先完成密碼變更，並確認員工帳號有效');
    const access = await this.entityAccess.assertAccess(
      userId,
      'sales',
      entity,
    );
    // The original source is one tenancy: never widen SELF/DEPARTMENT into its global records.
    if (!access.isSuperAdmin && access.scope !== 'ENTITY')
      throw new ForbiddenException('售後來源需要公司範圍權限');
    const roles = (user.roles || []).map((entry) => entry.role.code);
    const privileged = roles.some((r: string) =>
      ['SUPER_ADMIN', 'ADMIN'].includes(r),
    );
    const permissions = user.effectivePermissions || [];
    const grants = moduleGrants(permissions, privileged);
    if (!grants.read.length) throw new ForbiddenException('沒有售後模組權限');
    const role =
      privileged || hasSourceAdministrationPermissions(permissions)
        ? 'admin'
        : roles.includes('ACCOUNTANT') || grants.write.includes('accounting_workbench')
          ? 'accounting'
          : roles.includes('CUSTOMER_SERVICE') ||
              roles.includes('DOA_DEV_QA_CSR')
            ? 'customer_service'
            : roles.includes('REPAIR_TECHNICIAN')
              ? 'technician'
              : roles.includes('MAILROOM_OPERATOR')
                ? 'warehouse'
                : 'sales';
    return {
      userId: user.id,
      email: user.email,
      entityId: entity,
      role,
      modules: grants.read,
      writeModules: grants.write,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }
  async launch(
    userId: string,
    entityId: string,
    section: string,
    returnOrigin: string,
    caseId?: string,
    intent: 'detail' | 'edit' = 'detail',
  ) {
    const allowed = [
      'https://corely-erp-dev-sp5g377smq-de.a.run.app',
      'https://aftersales-review---corely-erp-dev-sp5g377smq-de.a.run.app',
      'https://aftersales-final---corely-erp-dev-sp5g377smq-de.a.run.app',
    ];
    if (!allowed.includes(returnOrigin))
      throw new ForbiddenException('售後入口來源不符');
    let path: string = SOURCE_SECTIONS[section as keyof typeof SOURCE_SECTIONS];
    if (!path) throw new ForbiddenException('售後功能入口不存在');
    const actor = await this.actor(userId, entityId);
    const required =
      section === 'workbench'
        ? 'dashboard'
        : section === 'accounting'
          ? 'accounting_workbench'
          : section === 'audit-logs'
            ? 'audit_logs'
            : [
                  'customers',
                  'quotes',
                  'reshipments',
                  'exchange-returns',
                  'refund-pickups',
                  'private-purchases',
                  'customer-issues',
                ].includes(section)
              ? 'cases'
              : section;
    if (!actor.modules.includes(required))
      throw new ForbiddenException('沒有此售後功能權限');
    const { secret } = this.settings();
    if (caseId !== undefined) {
      if (
        ![
          'cases',
          'repairs',
          'reshipments',
          'exchange-returns',
          'refund-pickups',
          'private-purchases',
          'customer-issues',
        ].includes(section) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(caseId)
      )
        throw new ForbiddenException('案件入口不符');
      if (
        intent === 'edit' &&
        !actor.writeModules.includes(
          section === 'repairs' ? 'repairs' : 'cases',
        )
      )
        throw new ForbiddenException('沒有此案件編輯權限');
      // Resolve the actual case before signing a contextual path. Reserved route
      // names and non-existent IDs must never become arbitrary module launches.
      const base =
        this.config.get<string>('AFTER_SALES_TASK_SOURCE_URL', '').trim() ||
        (this.config.get('ERP_DEV_SANDBOX') === 'true'
          ? 'https://corely-aftersales-module-dev-sp5g377smq-de.a.run.app/after-sales-app'
          : '');
      let source: URL;
      try {
        source = new URL(base);
      } catch {
        throw new ServiceUnavailableException('售後案件來源尚未設定');
      }
      if (
        source.protocol !== 'https:' ||
        source.username ||
        source.password ||
        source.search ||
        source.hash ||
        !['/', '/after-sales-app', '/after-sales-app/'].includes(
          source.pathname,
        )
      )
        throw new ServiceUnavailableException('售後案件來源設定不符');
      const sourceUrl = new URL(source.toString().replace(/\/$/, '') + '/api/integration/erp/workbench/cases/' + encodeURIComponent(caseId));
      const sourcePath = '/api/integration/erp/workbench/cases/' + encodeURIComponent(caseId);
      const time = Math.floor(Date.now() / 1000).toString();
      const response = await fetch(
        sourceUrl.href,
        {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
          headers: {
            'x-erp-time': time,
            'x-erp-entity': entityId,
            'x-erp-actor': userId,
            'x-erp-signature': serviceSignature(
              secret,
              'GET',
              sourcePath,
              time,
              entityId,
              userId,
            ),
          },
        },
      );
      if (!response.ok) throw new ForbiddenException('找不到可存取的售後案件');
      if (Number(response.headers.get('content-length') || 0) > 1048576) {
        await response.body?.cancel();
        throw new ServiceUnavailableException('售後案件回應過大');
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > 1048576)
        throw new ServiceUnavailableException('售後案件回應過大');
      let detail: {
        contractVersion?: string;
        item?: { id?: string; type?: string };
        actions?: { id?: string }[];
      };
      try {
        detail = JSON.parse(text) as typeof detail;
      } catch {
        throw new ServiceUnavailableException('售後案件回應不符');
      }
      if (
        detail.contractVersion !== 'corely.doa.tasks.v1' ||
        detail.item?.id !== caseId ||
        (intent === 'edit' &&
          !detail.actions?.some((action) => action.id === 'edit_source'))
      )
        throw new ForbiddenException('案件入口權限不符');
      if (detail.item.type === 'REPAIR' && !actor.modules.includes('repairs'))
        throw new ForbiddenException('沒有維修案件權限');
      await this.actor(userId, entityId);
      path =
        '/cases/' +
        encodeURIComponent(caseId) +
        (intent === 'edit' ? '/edit' : '');
    }
    const payload = Buffer.from(
      JSON.stringify({
        userId: actor.userId,
        entityId: actor.entityId,
        jti: randomUUID(),
        purpose: 'erp.aftersales.launch.v1',
        path,
        returnOrigin,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url');
    const ticket =
      payload +
      '.' +
      createHmac('sha256', secret).update(payload).digest('base64url');
    return {
      ticket,
      action: '/after-sales-app/api/integration/erp/session',
      expiresIn: 60,
    };
  }
  async inspect(
    req: {
      headers: Record<string, string>;
      method: string;
      originalUrl: string;
    },
    userId: string,
    entity: string,
  ) {
    const settings = this.settings();
    const time = req.headers['x-erp-time'];
    if (
      entity !== settings.entity ||
      req.headers['x-erp-entity'] !== entity ||
      req.headers['x-erp-actor'] !== userId ||
      typeof time !== 'string' ||
      !/^\d{10}$/.test(time) ||
      Math.abs(Date.now() / 1000 - Number(time)) > 60 ||
      req.method !== 'GET' ||
      !matchesSignature(
        req.headers['x-erp-signature'] || '',
        serviceSignature(
          settings.secret,
          'GET',
          req.originalUrl,
          time,
          entity,
          userId,
        ),
      )
    )
      throw new UnauthorizedException('售後服務簽章無效');
    return this.actor(userId, entity);
  }
}
