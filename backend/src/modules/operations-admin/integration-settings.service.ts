import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { MetaAdsService } from '../integration/meta-ads/meta-ads.service';
import { GoogleAdsService } from '../integration/google-ads/google-ads.service';
import { Ga4Service } from '../integration/ga4/ga4.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { OperationsSourceReader } from './operations-source.reader';
import { connectionInput } from './operations-admin.contract';
@Injectable()
export class IntegrationSettingsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly access: EntityAccessService,
    private readonly config: ConfigService,
    private readonly source: OperationsSourceReader,
    private readonly meta: MetaAdsService,
    private readonly google: GoogleAdsService,
    private readonly ga4: Ga4Service,
    private readonly invoices: InvoicingService,
  ) {}
  async authority(
    actorId: string,
    entityId: string,
    action: 'read' | 'update',
  ) {
    const access = await this.access.assertAccess(actorId, 'sales', entityId);
    const user = await this.auth.validateUser(actorId);
    const admin = user.roles.some(({ role }) =>
      ['SUPER_ADMIN', 'ADMIN'].includes(role.code),
    );
    if (!access.isSuperAdmin && access.scope !== 'ENTITY')
      throw new ForbiddenException('串接設定需要公司範圍權限');
    const grants = user.effectivePermissions || [];
    const all = admin || grants.includes('integration_settings:' + action);
    const sourceOnly = grants.includes('after_sales_settings:' + action);
    if (!all && !sourceOnly) throw new ForbiddenException('沒有串接設定權限');
    return { all, sourceOnly };
  }
  async list(actorId: string, entityId: string) {
    const authority = await this.authority(actorId, entityId, 'read');
    const connections = await this.db.integrationConnection.findMany({
      where: {
        entityId,
        ...(!authority.all
          ? { category: { in: ['LINE', 'AFTER_SALES', 'INVOICE'] } }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { provider: 'asc' }, { brand: 'asc' }],
      take: 200,
    });
    const sync = authority.all
      ? await this.db.connectorSyncState.findMany({
          where: { entityId },
          select: {
            connector: true,
            status: true,
            lastSuccessAt: true,
            lastFailureAt: true,
          },
          take: 30,
        })
      : [];
    let source: any = {
      available: false,
      code: 'SOURCE_UNAVAILABLE',
      items: [],
    };
    try {
      const data = await this.source.read(
        actorId,
        entityId,
        'integration-status',
      );
      source = {
        available: true,
        items: data.items.map((row: any) => ({
          brand: row.brand,
          kind: row.kind,
          configured: row.configured === true,
          verified: row.verified === true,
          devStub: row.devStub === true,
          issuerName: row.issuerName || null,
        })),
      };
    } catch {}
    const profiles = authority.all
      ? this.invoices
          .getInvoiceProviderReadiness()
          .accounts.filter((row) => row.entityId === entityId)
          .map((row) => ({
            key: row.key,
            environment: row.env,
            ready: row.ready,
            missing: row.missing,
            verified: false,
          }))
      : [];
    await this.authority(actorId, entityId, 'read');
    return {
      connections: connections.map((row) => ({
        ...row,
        credentialRef: row.credentialRef,
        verificationStatus: row.verificationStatus,
      })),
      sync,
      source,
      invoiceProfiles: profiles,
      canManage: authority.all,
      categories: authority.all
        ? ['LINE', 'COMMERCE', 'ADS', 'INVOICE', 'AFTER_SALES']
        : ['LINE', 'INVOICE', 'AFTER_SALES'],
    };
  }
  async save(actorId: string, input: Record<string, unknown>) {
    const entityId = String(input.entityId || '');
    const permission = await this.authority(actorId, entityId, 'update');
    const data = connectionInput(input);
    if (!permission.all && !['LINE', 'AFTER_SALES'].includes(data.category))
      throw new ForbiddenException('此串接設定需要管理權限');
    const version = Number(input.version || 0);
    if (!Number.isInteger(version) || version < 0)
      throw new BadRequestException('設定版本不符');
    const id = typeof input.id === 'string' ? input.id : undefined;
    return this.db.$transaction(async (tx) => {
      if (id) {
        const previous = await tx.integrationConnection.findUnique({
          where: { id },
        });
        if (!previous || previous.entityId !== entityId)
          throw new NotFoundException('串接設定不存在');
        const result = await tx.integrationConnection.updateMany({
          where: { id, entityId, version },
          data: {
            ...data,
            metadata: data.metadata as Prisma.InputJsonValue,
            updatedBy: actorId,
            version: { increment: 1 },
            verificationStatus: 'UNVERIFIED',
            verifiedAt: null,
            verificationCode: null,
          },
        });
        if (result.count !== 1)
          throw new ConflictException('串接設定已更新，請重新整理');
        await tx.auditLog.create({
          data: {
            userId: actorId,
            companyId: entityId,
            brand: data.brand || null,
            tableName: 'integration_connections',
            recordId: id,
            action: 'UPDATE',
            newData: { changedFields: Object.keys(data), version: version + 1 },
          },
        });
        return tx.integrationConnection.findUnique({ where: { id } });
      }
      try {
        const row = await tx.integrationConnection.create({
          data: {
            ...data,
            metadata: data.metadata as Prisma.InputJsonValue,
            entityId,
            updatedBy: actorId,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            companyId: entityId,
            brand: data.brand || null,
            tableName: 'integration_connections',
            recordId: row.id,
            action: 'CREATE',
            newData: {
              provider: data.provider,
              category: data.category,
              version: 1,
            },
          },
        });
        return row;
      } catch (error) {
        if ((error as any).code === 'P2002')
          throw new ConflictException('此串接帳號已存在');
        throw error;
      }
    });
  }
  async verify(actorId: string, entityId: string, id: string, version: number) {
    const authority = await this.authority(actorId, entityId, 'update');
    const row = await this.db.integrationConnection.findUnique({
      where: { id },
    });
    if (!row || row.entityId !== entityId)
      throw new NotFoundException('串接設定不存在');
    if (!authority.all && !['LINE', 'AFTER_SALES'].includes(row.category))
      throw new ForbiddenException('此串接驗證需要管理權限');
    if (row.version !== version)
      throw new ConflictException('串接設定已更新，請重新整理');
    if (!row.enabled) throw new BadRequestException('串接已停用');
    let status = 'UNVERIFIED',
      code = 'PROVIDER_NOT_CONFIGURED';
    try {
      if (
        row.provider === 'AFTER_SALES' ||
        row.provider === 'LINE' ||
        (row.provider === 'ECPAY' &&
          (row.metadata as any).runtimeOwner === 'AFTER_SALES')
      ) {
        const data = await this.source.read(
          actorId,
          entityId,
          'integration-status',
        );
        if (row.provider === 'AFTER_SALES') {
          status = 'VERIFIED';
          code = 'CONTRACT_VERIFIED';
        } else {
          const current = data.items.find(
            (item: any) =>
              item.brand === row.brand &&
              item.kind === (row.provider === 'LINE' ? 'LINE' : 'INVOICE'),
          );
          code = current?.devStub
            ? 'DEV_STUB'
            : current?.configured
              ? 'CONFIGURED_NOT_VERIFIED'
              : 'PROVIDER_NOT_CONFIGURED';
          const metadata = row.metadata as Record<string, unknown>;
          const actualIds =
            row.provider === 'LINE'
              ? [
                  current?.messagingChannelId,
                  current?.officialAccountId,
                ].filter(Boolean)
              : [current?.accountId, current?.merchantKey].filter(Boolean);
          const expectedLogin = metadata.loginChannelId;
          const expectedMessaging = metadata.messagingChannelId;
          if (
            !current?.devStub &&
            (actualIds.length === 0 ||
              !actualIds.includes(row.accountId) ||
              (expectedLogin && expectedLogin !== current?.loginChannelId) ||
              (expectedMessaging &&
                expectedMessaging !== current?.messagingChannelId))
          )
            code = 'RUNTIME_MAPPING_MISMATCH';
          // Registry edits never prove that a credential reference was applied by
          // the Source runtime. Its own verified profile is shown separately.
          status = 'UNVERIFIED';
        }
      } else if (
        row.provider === 'META' ||
        row.provider === 'GOOGLE_ADS' ||
        row.provider === 'GA4'
      ) {
        const service =
          row.provider === 'META'
            ? this.meta
            : row.provider === 'GOOGLE_ADS'
              ? this.google
              : this.ga4;
        const info: any = service.getConnectionInfo();
        const accounts =
          info.configuredAccounts || info.configuredProperties || [];
        const matched = accounts.find(
          (account: any) =>
            account.entityId === entityId &&
            String(account.brand || '') === row.brand &&
            String(
              account.accountId || account.customerId || account.propertyId,
            ) === row.accountId,
        );
        if (!matched) {
          code = 'RUNTIME_MAPPING_MISMATCH';
        } else if (this.config.get('ERP_DEV_SANDBOX') === 'true') {
          code = 'DEV_EXTERNAL_PROBE_DISABLED';
        } else {
          const date = new Date(Date.now() - 86400000);
          if (row.provider === 'META')
            await this.meta.previewInsights({
              accountIds: [row.accountId],
              since: date,
              until: date,
              limit: 1,
              maxPages: 1,
            });
          else if (row.provider === 'GOOGLE_ADS')
            await this.google.previewInsights({
              customerIds: [row.accountId],
              since: date,
              until: date,
              pageSize: 1,
              maxPages: 1,
            });
          else
            await this.ga4.report({
              propertyIds: [row.accountId],
              since: date,
              until: date,
              limit: 1,
            });
          status = 'VERIFIED';
          code = 'READ_ONLY_PROBE_OK';
        }
      } else if (row.provider === 'ECPAY') {
        const account = this.invoices
          .getInvoiceProviderReadiness()
          .accounts.find(
            (item) => item.entityId === entityId && item.key === row.accountId,
          );
        code = account?.ready
          ? 'CONFIGURED_NOT_VERIFIED'
          : 'PROVIDER_NOT_CONFIGURED';
      } else {
        code = 'READ_ONLY_PROBE_NOT_AVAILABLE';
      }
    } catch {
      status = 'FAILED';
      code = 'READ_ONLY_PROBE_FAILED';
    }
    await this.authority(actorId, entityId, 'update');
    await this.db.$transaction(async (tx) => {
      const result = await tx.integrationConnection.updateMany({
        where: { id, entityId, version },
        data: {
          verificationStatus: status,
          verificationCode: code,
          verifiedAt: new Date(),
        },
      });
      if (result.count !== 1)
        throw new ConflictException('串接設定已更新，驗證結果未套用');
      await tx.auditLog.create({
        data: {
          userId: actorId,
          companyId: entityId,
          brand: row.brand || null,
          tableName: 'integration_connections',
          recordId: id,
          action: 'VERIFY',
          newData: { status, code, version },
        },
      });
    });
    return { status, code, version };
  }
}
