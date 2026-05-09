import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { Public } from '../../../common/decorators/public.decorator';
import { GoogleAdsService } from './google-ads.service';

class GoogleAdsInsightsQueryDto {
  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsDateString()
  until?: string;

  @IsOptional()
  @IsString()
  customerIds?: string;

  @IsOptional()
  @IsString()
  level?: 'account' | 'campaign';

  @IsOptional()
  @IsString()
  pageSize?: string;

  @IsOptional()
  @IsString()
  maxPages?: string;
}

class GoogleAdsSyncDto {
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
  customerIds?: string;

  @IsOptional()
  @IsString()
  includeZeroSpend?: string;

  @IsOptional()
  @IsString()
  maxPages?: string;
}

@Controller('integrations/google-ads')
export class GoogleAdsController {
  constructor(private readonly googleAdsService: GoogleAdsService) {}

  @Get('connection-info')
  connectionInfo() {
    return this.googleAdsService.getConnectionInfo();
  }

  @Get('readiness')
  readiness() {
    return this.googleAdsService.getReadiness();
  }

  @Get('insights')
  insights(@Query() query: GoogleAdsInsightsQueryDto) {
    return this.googleAdsService.previewInsights({
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      customerIds: this.splitCsv(query.customerIds),
      level: query.level === 'campaign' ? 'campaign' : 'account',
      pageSize: query.pageSize,
      maxPages: query.maxPages,
    });
  }

  @Post('sync')
  sync(@Body() body: GoogleAdsSyncDto) {
    return this.googleAdsService.syncInsights({
      entityId: body.entityId,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
      customerIds: this.splitCsv(body.customerIds),
      includeZeroSpend: body.includeZeroSpend === 'true',
      maxPages: body.maxPages,
    });
  }

  @Public()
  @Post('sync/auto')
  autoSync(
    @Headers('x-sync-token') syncToken: string | undefined,
    @Body() body: GoogleAdsSyncDto,
  ) {
    this.googleAdsService.assertSchedulerToken(syncToken);
    return this.googleAdsService.syncInsights({
      entityId: body.entityId,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
      customerIds: this.splitCsv(body.customerIds),
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
