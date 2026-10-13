import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AfterSalesIntegrationModule } from '../integration/after-sales/after-sales.module';
import { MetaAdsIntegrationModule } from '../integration/meta-ads/meta-ads.module';
import { GoogleAdsIntegrationModule } from '../integration/google-ads/google-ads.module';
import { Ga4IntegrationModule } from '../integration/ga4/ga4.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import {
  IntegrationSettingsController,
  OperationLogsController,
} from './operations-admin.controller';
import { IntegrationSettingsService } from './integration-settings.service';
import { OperationLogsService } from './operation-logs.service';
import { OperationsSourceReader } from './operations-source.reader';
@Module({
  imports: [
    AuthModule,
    AfterSalesIntegrationModule,
    MetaAdsIntegrationModule,
    GoogleAdsIntegrationModule,
    Ga4IntegrationModule,
    InvoicingModule,
  ],
  controllers: [IntegrationSettingsController, OperationLogsController],
  providers: [
    IntegrationSettingsService,
    OperationLogsService,
    OperationsSourceReader,
  ],
})
export class OperationsAdminModule {}
