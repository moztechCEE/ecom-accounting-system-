import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsString } from 'class-validator';
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
}
