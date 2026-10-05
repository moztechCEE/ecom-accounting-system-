import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { AuthService } from '../../auth/auth.service';
import { EntityAccessService } from '../../../common/entity-access/entity-access.service';
import {
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
  ) {}
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
    const grants = moduleGrants(user.effectivePermissions || [], privileged);
    if (!grants.read.length) throw new ForbiddenException('沒有售後模組權限');
    const role = privileged
      ? 'admin'
      : roles.includes('ACCOUNTANT')
        ? 'accounting'
        : roles.includes('CUSTOMER_SERVICE') || roles.includes('DOA_DEV_QA_CSR')
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
  ) {
    const allowed = [
      'https://corely-erp-dev-sp5g377smq-de.a.run.app',
      'https://aftersales-review---corely-erp-dev-sp5g377smq-de.a.run.app',
      'https://aftersales-final---corely-erp-dev-sp5g377smq-de.a.run.app',
    ];
    if (!allowed.includes(returnOrigin))
      throw new ForbiddenException('售後入口來源不符');
    const path = SOURCE_SECTIONS[section as keyof typeof SOURCE_SECTIONS];
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
