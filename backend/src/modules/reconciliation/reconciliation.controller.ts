/**
 * reconciliation.controller.ts
 * 修改（2026-04）：新增 platform-payouts、missing-invoices、ecpay-payout-status 三支 summary endpoints
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { ImportBankTransactionsDto } from './dto/import-bank-transactions.dto';
import { AutoMatchDto } from './dto/auto-match.dto';
import { ImportProviderPayoutsDto } from './dto/import-provider-payouts.dto';
import { SyncEcpayShopifyPayoutsDto } from './dto/sync-ecpay-shopify-payouts.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ProviderPayoutReconciliationService } from './provider-payout-reconciliation.service';
import { EcpayShopifyPayoutService } from './ecpay-shopify-payout.service';
import { RolesGuard } from '../../common/guards/roles.guard';

class BackfillEcpayShopifyHistoryDto {
  @IsString()
  entityId!: string;

  @IsDateString()
  beginDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  merchantKeys?: string[];

  @IsOptional()
  @IsIn(['1', '2'])
  dateType?: '1' | '2';

  @IsOptional()
  @IsIn(['01', '02', '03', '11'])
  paymentType?: '01' | '02' | '03' | '11';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  windowDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  maxWindows?: number;
}

class AutoRunCoreReconciliationDto {
  @IsString()
  entityId!: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  syncShopify?: boolean;

  @IsOptional()
  @IsBoolean()
  syncOneShop?: boolean;

  @IsOptional()
  @IsBoolean()
  syncEcpayPayouts?: boolean;

  @IsOptional()
  @IsBoolean()
  syncInvoices?: boolean;

  @IsOptional()
  @IsBoolean()
  autoClear?: boolean;
}

class ClearReadyPaymentsDto {
  @IsString()
  entityId!: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

@ApiTags('Reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly providerPayoutService: ProviderPayoutReconciliationService,
    private readonly ecpayShopifyPayoutService: EcpayShopifyPayoutService,
  ) {}

  @Get('center')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '對帳中心',
    description:
      '將訂單、應收、綠界/平台撥款、手續費、發票與分錄收斂成待撥款、可核銷、已核銷、異常四個隊列。',
  })
  async getReconciliationCenter(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reconciliationService.getReconciliationCenter(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('run')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '執行核心對帳 Job',
    description:
      '依序同步平台訂單、綠界撥款、AR、發票狀態，最後重算對帳中心四個隊列。',
  })
  async runCoreReconciliation(
    @Body()
    body: {
      entityId: string;
      startDate?: string;
      endDate?: string;
      syncShopify?: boolean;
      syncOneShop?: boolean;
      syncEcpayPayouts?: boolean;
      syncInvoices?: boolean;
      autoClear?: boolean;
    },
    @CurrentUser('id') userId: string,
  ) {
    return this.reconciliationService.runCoreReconciliationJob({
      entityId: body.entityId,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      userId,
      syncShopify: body.syncShopify,
      syncOneShop: body.syncOneShop,
      syncEcpayPayouts: body.syncEcpayPayouts,
      syncInvoices: body.syncInvoices,
      autoClear: body.autoClear,
    });
  }

  @Post('clear-ready')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '批次核銷可核銷款項',
    description:
      '保守模式：只處理已收款、實際手續費、發票與金額皆完整，且尚未有 reconciliation_payout 分錄的 Payment。',
  })
  async clearReadyPayments(
    @Body() body: ClearReadyPaymentsDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reconciliationService.clearReadyPayments({
      entityId: body.entityId,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      limit: body.limit,
      dryRun: body.dryRun,
      userId,
    });
  }

  @Public()
  @Post('run/auto')
  @ApiOperation({
    summary: '排程執行核心對帳 Job',
    description:
      '提供 Cloud Scheduler 使用。需帶 x-sync-token，流程與手動核心對帳相同。',
  })
  async autoRunCoreReconciliation(
    @Headers('x-sync-token') syncToken: string | undefined,
    @Body() body: AutoRunCoreReconciliationDto,
  ) {
    this.reconciliationService.assertSchedulerToken(syncToken);
    return this.reconciliationService.runCoreReconciliationJob({
      entityId: body.entityId,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      syncShopify: body.syncShopify,
      syncOneShop: body.syncOneShop,
      syncEcpayPayouts: body.syncEcpayPayouts,
      syncInvoices: body.syncInvoices,
      autoClear: body.autoClear,
    });
  }

  @Post('bank/import')
  @Roles('ADMIN')
  @ApiOperation({
    summary: '匯入銀行交易明細',
    description: '從 CSV/JSON 匯入銀行交易資料',
  })
  @ApiResponse({ status: 201, description: '匯入成功' })
  async importBankTransactions(
    @Body() dto: ImportBankTransactionsDto,
    @CurrentUser() user: any,
  ) {
    return this.reconciliationService.importBankTransactions(dto, user.userId);
  }

  @Post('bank/auto-match/:batchId')
  @Roles('ADMIN')
  @ApiOperation({
    summary: '自動對帳',
    description: '對指定批次的銀行交易進行自動匹配',
  })
  @ApiResponse({ status: 200, description: '對帳完成' })
  async autoMatchBankTransactions(
    @Param('batchId') batchId: string,
    @Body() config?: AutoMatchDto,
  ) {
    return this.reconciliationService.autoMatchTransactions(batchId, config);
  }

  @Get('pending')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '查詢待對帳項目',
    description: '取得所有未匹配的銀行交易',
  })
  @ApiResponse({ status: 200, description: '待對帳項目列表' })
  async getPendingItems(@Query('entityId') entityId: string) {
    return this.reconciliationService.getPendingReconciliation(entityId);
  }

  @Post('bank/manual-match')
  @Roles('ADMIN')
  @ApiOperation({
    summary: '手動對帳',
    description: '手動指定銀行交易與業務單據的匹配關係',
  })
  @ApiResponse({ status: 200, description: '對帳成功' })
  async manualMatch(
    @Body()
    body: { bankTransactionId: string; matchedType: string; matchedId: string },
    @CurrentUser() user: any,
  ) {
    return this.reconciliationService.manualMatch(
      body.bankTransactionId,
      body.matchedType,
      body.matchedId,
      user.userId,
    );
  }

  @Post('bank/unmatch')
  @Roles('ADMIN')
  @ApiOperation({ summary: '取消對帳', description: '取消已匹配的銀行交易' })
  @ApiResponse({ status: 200, description: '取消成功' })
  async unmatch(
    @Body() body: { bankTransactionId: string },
    @CurrentUser() user: any,
  ) {
    return this.reconciliationService.unmatch(
      body.bankTransactionId,
      user.userId,
    );
  }

<<<<<<< HEAD
  @Post('payouts/import')
  @Roles('ADMIN')
  @ApiOperation({
    summary: '匯入金流撥款/對帳報表',
    description:
      '支援綠界與 HiTRUST 的原始報表列資料，會回填每筆 Shopify 收款的實際金流手續費與淨額。',
  })
  @ApiResponse({ status: 201, description: '匯入成功' })
  async importProviderPayouts(
    @Body() dto: ImportProviderPayoutsDto,
    @CurrentUser() user: any,
  ) {
    return this.providerPayoutService.importProviderPayouts(dto, user.userId);
  }

  @Get('payouts/batches')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '查詢金流對帳匯入批次',
    description: '列出綠界 / HiTRUST 實際撥款匯入記錄',
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  async getPayoutImportBatches(
    @Query('entityId') entityId: string,
    @Query('provider') provider?: string,
  ) {
    return this.providerPayoutService.getPayoutImportBatches(
      entityId,
      provider,
    );
  }

  @Get('payouts/batches/:batchId')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '查詢單一金流對帳匯入批次',
    description: '查看批次內每一列實際撥款資料與匹配結果',
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  async getPayoutImportBatchDetail(@Param('batchId') batchId: string) {
    return this.providerPayoutService.getPayoutImportBatchDetail(batchId);
  }

  @Post('payouts/ecpay-shopify/sync')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: '直接從綠界 Shopify API 同步撥款對帳資料',
    description:
      '不需手動匯出報表，系統會直接向綠界 Shopify 專用 API 取回撥款資料並回填到既有 Payment。',
  })
  @ApiResponse({ status: 201, description: '同步成功' })
  async syncEcpayShopifyPayouts(
    @Body() dto: SyncEcpayShopifyPayoutsDto,
    @CurrentUser() user: any,
  ) {
    return this.ecpayShopifyPayoutService.syncShopifyPayouts(dto, user.userId);
  }

  @Post('payouts/ecpay-shopify/backfill')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: '按歷史區間回補綠界撥款資料',
    description:
      '系統會自動按月切片向綠界 API 回補歷史資料，可同時處理多個 merchant profile。',
  })
  @ApiResponse({ status: 201, description: '回補成功' })
  async backfillEcpayShopifyPayouts(
    @Body() dto: BackfillEcpayShopifyHistoryDto,
    @CurrentUser() user: any,
  ) {
    return this.ecpayShopifyPayoutService.backfillHistory(dto, user.userId);
  }

  @Public()
  @Post('payouts/ecpay-shopify/backfill/auto')
  async autoBackfillEcpayShopifyPayouts(
    @Headers('x-sync-token') syncToken: string | undefined,
    @Body() dto: BackfillEcpayShopifyHistoryDto,
  ) {
    this.ecpayShopifyPayoutService.assertSchedulerToken(syncToken);
    return this.ecpayShopifyPayoutService.backfillHistory(dto);
=======
  // ── 新增 Summary Endpoints（2026-04）──────────────────────────

  /**
   * GET /reconciliation/platform-payouts
   * 依平台分組加總 Payment 資料，回傳撥款彙總
   */
  @Get('platform-payouts')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '平台撥款彙總',
    description: '依 channel 分組加總 amountGross/feePlatform/feeGateway/amountNet',
  })
  @ApiResponse({ status: 200, description: '各平台撥款彙總陣列' })
  async getPlatformPayouts(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('platform') platform?: string,
  ) {
    return this.reconciliationService.getPlatformPayouts(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      platform,
    );
  }

  /**
   * GET /reconciliation/missing-invoices
   * 查詢有訂單但無發票的 SalesOrder
   */
  @Get('missing-invoices')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '缺發票訂單列表',
    description: '查詢 hasInvoice = false 且 status in [paid, fulfilled, completed] 的訂單',
  })
  @ApiResponse({ status: 200, description: '缺發票訂單列表' })
  async getMissingInvoices(@Query('entityId') entityId: string) {
    return this.reconciliationService.getMissingInvoices(entityId);
  }

  /**
   * GET /reconciliation/ecpay-payout-status
   * 查詢 ECPay 通路的 Payment，依 status 分組
   */
  @Get('ecpay-payout-status')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: 'ECPay 撥款狀態統計',
    description: '查詢 channel LIKE ECPAY 的 Payment，回傳 pending/completed 統計及在途金額',
  })
  @ApiResponse({ status: 200, description: 'ECPay 撥款狀態' })
  async getEcpayPayoutStatus(@Query('entityId') entityId: string) {
    return this.reconciliationService.getEcpayPayoutStatus(entityId);
>>>>>>> a309c4d4 (feat(ai): Claude 自動更新 — 2026-04-22 16:40:40)
  }
}
