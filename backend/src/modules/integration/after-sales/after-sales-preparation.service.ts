import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AfterSalesLegacyAdapter } from './after-sales-legacy.adapter';
import {
  BrandSettings,
  customerQuote,
  parseBrand,
  parseQuote,
  sourcePaymentBrand,
} from './after-sales-preparation.contract';

type BrandRow = { data: BrandSettings; version: number };
type DraftRow = {
  data: Record<string, unknown>;
  request_hash: string;
  created_by: string;
};
@Injectable()
export class AfterSalesPreparationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legacy: AfterSalesLegacyAdapter,
  ) {}
  private parse<T>(parser: (value: unknown) => T, value: unknown) {
    try {
      return parser(value);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
  async brands(entityId: string) {
    const rows = await this.prisma.$queryRaw<BrandRow[]>`
      SELECT data, version FROM after_sales_brand_settings WHERE entity_id = ${entityId} ORDER BY code`;
    return rows.map((row) => ({
      ...row.data,
      version: row.version,
      lineStatus: 'not_connected',
      invoiceStatus: 'unverified',
    }));
  }
  async saveBrand(
    entityId: string,
    actorId: string,
    version: number,
    value: unknown,
  ) {
    const data = this.parse(parseBrand, value);
    const json = JSON.stringify(data);
    // All SQL is parameterized. Compare-and-swap stops one administrator overwriting another.
    const rows =
      version === 0
        ? await this.prisma.$queryRaw<BrandRow[]>`
          INSERT INTO after_sales_brand_settings(entity_id, code, version, data, updated_by)
          VALUES (${entityId}, ${data.code}, 1, ${json}::jsonb, ${actorId})
          ON CONFLICT DO NOTHING RETURNING data, version`
        : await this.prisma.$queryRaw<BrandRow[]>`
          UPDATE after_sales_brand_settings SET data = ${json}::jsonb, version = version + 1,
            updated_by = ${actorId}, updated_at = CURRENT_TIMESTAMP
          WHERE entity_id = ${entityId} AND code = ${data.code} AND version = ${version}
          RETURNING data, version`;
    if (!rows.length) throw new ConflictException('品牌已被更新，請重新載入');
    return {
      ...rows[0].data,
      version: rows[0].version,
      lineStatus: 'not_connected',
      invoiceStatus: 'unverified',
    };
  }
  async drafts(entityId: string) {
    return (
      await this.prisma.$queryRaw<DraftRow[]>`
      SELECT data FROM after_sales_quote_drafts WHERE entity_id = ${entityId}
      ORDER BY created_at DESC LIMIT 100`
    ).map((row) => row.data);
  }
  async saveDraft(
    entityId: string,
    actorId: string,
    requestKey: string,
    value: unknown,
  ) {
    const input = this.parse(parseQuote, value);
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const existing = await this.prisma.$queryRaw<DraftRow[]>`
      SELECT data, request_hash, created_by FROM after_sales_quote_drafts
      WHERE entity_id = ${entityId} AND request_key = ${requestKey}`;
    if (existing.length) return this.replay(existing[0], hash, actorId);
    // Guard has already required exact company binding and ENTITY sales scope.
    const source = await this.legacy.getWorkbenchCase(input.sourceCaseId);
    if (
      source.type !== 'REPAIR' ||
      typeof source.status !== 'string' ||
      ['CLOSED', 'COMPLETED', 'CANCELLED'].includes(source.status)
    )
      throw new BadRequestException('目前僅開放未結束維修案件的報價草稿');
    const sourceBrand = this.parse(() => sourcePaymentBrand(source), null);
    if (sourceBrand && sourceBrand !== input.brandCode)
      throw new ConflictException('原案件付款品牌不同，請先核對品牌');
    return this.prisma.$transaction(async (tx) => {
      const [brand] = await tx.$queryRaw<BrandRow[]>`
      SELECT data, version FROM after_sales_brand_settings
      WHERE entity_id = ${entityId} AND code = ${input.brandCode} FOR SHARE`;
      if (!brand || !brand.data.active)
        throw new NotFoundException('品牌不存在或已停用');
      if (brand.version !== input.brandVersion)
        throw new ConflictException('品牌設定已更新，請重新選取並確認');
      await tx.$executeRaw`
      INSERT INTO after_sales_case_brand_bindings(entity_id, source_case_id, brand_code, created_by)
      VALUES (${entityId}, ${source.id}, ${input.brandCode}, ${actorId}) ON CONFLICT DO NOTHING`;
      const [binding] = await tx.$queryRaw<{ brand_code: string }[]>`
      SELECT brand_code FROM after_sales_case_brand_bindings
      WHERE entity_id = ${entityId} AND source_case_id = ${source.id}`;
      if (!binding || binding.brand_code !== input.brandCode)
        throw new ConflictException('此案件已綁定其他品牌，請使用原品牌');
      const id = randomUUID();
      const draft = {
        id,
        status: 'draft',
        createdAt: new Date().toISOString(),
        sourceCaseId: source.id,
        sourceCaseNumber: source.caseNumber,
        sourceStatus: source.status,
        brandCode: brand.data.code,
        brandVersion: brand.version,
        brandSnapshot: brand.data,
        customerPreview: customerQuote(brand.data, source.caseNumber, input),
        deliveryStatus: 'not_sent',
        invoiceStatus: 'not_issued',
      };
      const rows = await tx.$queryRaw<DraftRow[]>`
      INSERT INTO after_sales_quote_drafts(id, entity_id, request_key, request_hash, data, created_by)
      VALUES (${id}, ${entityId}, ${requestKey}, ${hash}, ${JSON.stringify(draft)}::jsonb, ${actorId})
      ON CONFLICT DO NOTHING RETURNING data, request_hash, created_by`;
      if (rows.length) return rows[0].data;
      const [concurrent] = await tx.$queryRaw<DraftRow[]>`
      SELECT data, request_hash, created_by FROM after_sales_quote_drafts
      WHERE entity_id = ${entityId} AND request_key = ${requestKey}`;
      if (!concurrent) throw new ConflictException('請重試儲存');
      return this.replay(concurrent, hash, actorId);
    });
  }
  private replay(row: DraftRow, hash: string, actorId: string) {
    if (row.request_hash !== hash || row.created_by !== actorId)
      throw new ConflictException('重試識別碼已被使用，請重新確認報價');
    return row.data;
  }
  async caseBrand(entityId: string, sourceCaseId: string) {
    const source = await this.legacy.getWorkbenchCase(sourceCaseId);
    const sourceBrand = this.parse(() => sourcePaymentBrand(source), null);
    const [binding] = await this.prisma.$queryRaw<{ brand_code: string }[]>`
      SELECT brand_code FROM after_sales_case_brand_bindings
      WHERE entity_id = ${entityId} AND source_case_id = ${sourceCaseId}`;
    if (sourceBrand && binding && sourceBrand !== binding.brand_code)
      throw new ConflictException('原案件與報價品牌不一致，須先核對');
    return {
      sourceCaseId,
      brandCode: sourceBrand || binding?.brand_code || null,
    };
  }
}
