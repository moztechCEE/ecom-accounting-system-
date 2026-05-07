import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ShoplineService } from './shopline.service';

class SyncRequestDto {
  @IsString()
  entityId!: string;

  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsDateString()
  until?: string;
}

class SummaryQueryDto {
  @IsString()
  entityId!: string;

  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsDateString()
  until?: string;
}

class AgentsQueryDto {
  @IsOptional()
  @IsString()
  merchantId?: string;
}

class PreviewQueryDto {
  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsDateString()
  until?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

class PaymentsQueryDto extends PreviewQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  dateMin?: string;

  @IsOptional()
  @IsDateString()
  dateMax?: string;

  @IsOptional()
  @IsString()
  maxPages?: string;

  @IsOptional()
  @IsString()
  pageInfo?: string;

  @IsOptional()
  @IsString()
  sinceId?: string;

  @IsOptional()
  @IsString()
  payoutId?: string;

  @IsOptional()
  @IsString()
  payoutTransactionNo?: string;

  @IsOptional()
  @IsString()
  accountType?: string;

  @IsOptional()
  @IsString()
  isSettlementDetails?: string;

  @IsOptional()
  @IsString()
  transactionType?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  tradeOrderId?: string;
}

class SyncPaymentsRequestDto extends SyncRequestDto {
  @IsOptional()
  @IsString()
  maxPages?: string;

  @IsOptional()
  @IsString()
  payoutId?: string;

  @IsOptional()
  @IsString()
  accountType?: string;

  @IsOptional()
  @IsBoolean()
  isSettlementDetails?: boolean;
}

@Controller('integrations/shopline')
export class ShoplineController {
  constructor(private readonly shoplineService: ShoplineService) {}

  @Get('health')
  async health() {
    return this.shoplineService.testConnection();
  }

  @Get('connection-info')
  async connectionInfo() {
    return this.shoplineService.getConnectionInfo();
  }

  @Get('token-info')
  async tokenInfo() {
    return this.shoplineService.getTokenInfo();
  }

  @Get('agents')
  async agents(@Query() query: AgentsQueryDto) {
    return this.shoplineService.getAgents({
      merchantId: query.merchantId,
    });
  }

  @Get('preview/orders')
  async previewOrders(@Query() query: PreviewQueryDto) {
    return this.shoplineService.previewOrders({
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: query.limit,
    });
  }

  @Get('preview/customers')
  async previewCustomers(@Query() query: PreviewQueryDto) {
    return this.shoplineService.previewCustomers({
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit: query.limit,
    });
  }

  @Get('payments/balance')
  async paymentBalance() {
    return this.shoplineService.previewPaymentBalance();
  }

  @Get('payments/readiness')
  async paymentReadiness() {
    return this.shoplineService.getPaymentsReadiness();
  }

  @Get('payments/billing-records')
  async paymentBillingRecords(@Query() query: PaymentsQueryDto) {
    return this.shoplineService.previewPaymentBillingRecords({
      since: this.resolveQueryDate(query.since, query.startDate, query.dateMin),
      until: this.resolveQueryDate(query.until, query.endDate, query.dateMax),
      limit: query.limit,
      maxPages: query.maxPages,
      pageInfo: query.pageInfo,
      sinceId: query.sinceId,
      payoutId: query.payoutId,
      payoutTransactionNo: query.payoutTransactionNo,
      accountType: query.accountType,
      isSettlementDetails: query.isSettlementDetails,
    });
  }

  @Get('payments/transactions')
  async paymentTransactions(@Query() query: PaymentsQueryDto) {
    return this.shoplineService.previewPaymentTransactions({
      since: this.resolveQueryDate(query.since, query.startDate, query.dateMin),
      until: this.resolveQueryDate(query.until, query.endDate, query.dateMax),
      limit: query.limit,
      maxPages: query.maxPages,
      pageInfo: query.pageInfo,
      sinceId: query.sinceId,
      transactionType: query.transactionType,
      status: query.status,
      tradeOrderId: query.tradeOrderId,
    });
  }

  @Get('payments/payouts')
  async paymentPayouts(@Query() query: PaymentsQueryDto) {
    return this.shoplineService.previewPaymentPayouts({
      since: this.resolveQueryDate(query.since, query.startDate, query.dateMin),
      until: this.resolveQueryDate(query.until, query.endDate, query.dateMax),
      limit: query.limit,
      maxPages: query.maxPages,
      pageInfo: query.pageInfo,
      sinceId: query.sinceId,
      payoutTransactionNo: query.payoutTransactionNo,
      status: query.status,
    });
  }

  @Post('sync/orders')
  async syncOrders(@Body() body: SyncRequestDto) {
    return this.shoplineService.syncOrders({
      entityId: body.entityId,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
    });
  }

  @Post('sync/customers')
  async syncCustomers(@Body() body: SyncRequestDto) {
    return this.shoplineService.syncCustomers({
      entityId: body.entityId,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
    });
  }

  @Post('sync/transactions')
  async syncTransactions(@Body() body: SyncRequestDto) {
    return this.shoplineService.syncTransactions({
      entityId: body.entityId,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
    });
  }

  @Post('sync/payments/billing-records')
  async syncPaymentBillingRecords(
    @Body() body: SyncPaymentsRequestDto,
    @CurrentUser('id') userId?: string,
  ) {
    return this.shoplineService.syncPaymentBillingRecords({
      entityId: body.entityId,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
      maxPages: body.maxPages,
      payoutId: body.payoutId,
      accountType: body.accountType,
      userId,
    });
  }

  @Public()
  @Post('sync/auto')
  async autoSync(
    @Headers('x-sync-token') syncToken: string | undefined,
    @Body() body: Partial<SyncRequestDto>,
  ) {
    this.shoplineService.assertSchedulerToken(syncToken);

    return this.shoplineService.autoSync({
      entityId: body.entityId,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
    });
  }

  @Get('summary')
  async summary(@Query() query: SummaryQueryDto) {
    return this.shoplineService.getSummary({
      entityId: query.entityId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
    });
  }

  @Public()
  @Post('webhook')
  async webhook(
    @Headers('x-shopline-topic') topic: string | undefined,
    @Body() payload: any,
  ) {
    return this.shoplineService.handleWebhook(topic || 'unknown', payload);
  }

  private resolveQueryDate(...values: Array<string | undefined>) {
    const value = values.find((item) => item);
    return value ? new Date(value) : undefined;
  }
}
