import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { ProviderPayoutReconciliationService } from './provider-payout-reconciliation.service';
import { EcpayShopifyPayoutService } from './ecpay-shopify-payout.service';
import { RolesGuard } from '../../common/guards/roles.guard';

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
}
