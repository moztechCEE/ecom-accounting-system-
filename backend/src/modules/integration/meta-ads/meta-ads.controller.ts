import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { Public } from '../../../common/decorators/public.decorator';
import { MetaAdsService } from './meta-ads.service';

class MetaAdsInsightsQueryDto {
  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsDateString()
  until?: string;

  @IsOptional()
  @IsString()
  accountIds?: string;

  @IsOptional()
  @IsString()
  level?: 'account' | 'campaign';

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  maxPages?: string;
}

class MetaAdsSyncDto {
  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsDateString()
  until?: string;

  @IsOptional()
  @IsString()
  accountIds?: string;

  @IsOptional()
  @IsString()
  includeZeroSpend?: string;

  @IsOptional()
  @IsString()
  maxPages?: string;
}

@Controller('integrations/meta-ads')
export class MetaAdsController {
  constructor(private readonly metaAdsService: MetaAdsService) {}

  @Get('connection-info')
  connectionInfo() {
    return this.metaAdsService.getConnectionInfo();
  }

  @Get('readiness')
  readiness() {
    return this.metaAdsService.getReadiness();
  }

  @Get('ad-accounts')
  adAccounts(@Query('limit') limit?: string) {
    return this.metaAdsService.previewAdAccounts({ limit });
  }

  @Get('insights')
  insights(@Query() query: MetaAdsInsightsQueryDto) {
    return this.metaAdsService.previewInsights({
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      accountIds: this.splitCsv(query.accountIds),
      level: query.level === 'campaign' ? 'campaign' : 'account',
      limit: query.limit,
      maxPages: query.maxPages,
    });
  }

  @Post('sync')
  sync(@Body() body: MetaAdsSyncDto) {
    return this.metaAdsService.syncInsights({
      entityId: body.entityId,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
      accountIds: this.splitCsv(body.accountIds),
      includeZeroSpend: body.includeZeroSpend === 'true',
      maxPages: body.maxPages,
    });
  }

  @Public()
  @Post('sync/auto')
  autoSync(
    @Headers('x-sync-token') syncToken: string | undefined,
    @Body() body: MetaAdsSyncDto,
  ) {
    this.metaAdsService.assertSchedulerToken(syncToken);
    return this.metaAdsService.syncInsights({
      entityId: body.entityId,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
      accountIds: this.splitCsv(body.accountIds),
      includeZeroSpend: body.includeZeroSpend === 'true',
      maxPages: body.maxPages,
    });
  }

  private splitCsv(value?: string) {
    return (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
