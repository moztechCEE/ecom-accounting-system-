import { Controller, Get, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { Ga4Service } from './ga4.service';

class Ga4ReportQueryDto {
  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsDateString()
  until?: string;

  @IsOptional()
  @IsString()
  propertyIds?: string;

  @IsOptional()
  @IsString()
  dimensions?: string;

  @IsOptional()
  @IsString()
  metrics?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

@Controller('integrations/ga4')
export class Ga4Controller {
  constructor(private readonly ga4Service: Ga4Service) {}

  @Get('connection-info')
  connectionInfo() {
    return this.ga4Service.getConnectionInfo();
  }

  @Get('readiness')
  readiness(@Query() query: Ga4ReportQueryDto) {
    return this.ga4Service.getReadiness({
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
    });
  }

  @Get('account-summaries')
  accountSummaries() {
    return this.ga4Service.accountSummaries();
  }

  @Get('report')
  report(@Query() query: Ga4ReportQueryDto) {
    return this.ga4Service.report({
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      propertyIds: this.splitCsv(query.propertyIds),
      dimensions: this.splitCsv(query.dimensions),
      metrics: this.splitCsv(query.metrics),
      limit: query.limit,
    });
  }

  private splitCsv(value?: string) {
    return (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
