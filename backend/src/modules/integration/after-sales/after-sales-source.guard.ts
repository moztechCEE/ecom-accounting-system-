import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityAccessService } from '../../../common/entity-access/entity-access.service';

@Injectable()
export class AfterSalesSourceGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly entityAccess: EntityAccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const boundEntity = this.config
      .get<string>('AFTER_SALES_LEGACY_ENTITY_ID')
      ?.trim();
    if (!boundEntity)
      throw new ServiceUnavailableException('售後來源尚未綁定公司');
    const request = context.switchToHttp().getRequest();
    const entityIds = [request.query?.entityId, request.body?.entityId].filter(
      (value) => value !== undefined,
    );
    if (
      !entityIds.length ||
      entityIds.some(
        (value) => typeof value !== 'string' || value !== boundEntity,
      )
    ) {
      throw new ForbiddenException('此公司的售後來源未開通');
    }
    // Legacy user IDs have not been mapped to ERP employees or departments yet.
    // Do not widen SELF/DEPARTMENT scope into company-wide access.
    const access = await this.entityAccess.assertAccess(
      request.user?.id,
      'sales',
      boundEntity,
    );
    if (!access.isSuperAdmin && access.scope !== 'ENTITY')
      throw new ForbiddenException('售後工作台需要公司範圍的售後查詢權限');
    return true;
  }
}
