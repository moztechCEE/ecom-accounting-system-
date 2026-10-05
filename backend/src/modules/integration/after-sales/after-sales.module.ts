import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AfterSalesStockModule } from './after-sales-stock.module';
import { ErpAfterSalesModuleController } from './erp-module.controller';
import { ErpAfterSalesModuleService } from './erp-module.service';
import { AfterSalesPreparationController } from './after-sales-preparation.controller';
import { AfterSalesPreparationService } from './after-sales-preparation.service';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AfterSalesController } from './after-sales.controller';
import { AfterSalesLegacyAdapter } from './after-sales-legacy.adapter';
import { AfterSalesMigrationService } from './after-sales-migration.service';
import { AfterSalesSourceGuard } from './after-sales-source.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';

@Module({
  imports: [PrismaModule, AuthModule, AfterSalesStockModule],
  controllers: [
    AfterSalesController,
    AfterSalesPreparationController,
    ErpAfterSalesModuleController,
  ],
  providers: [
    ErpAfterSalesModuleService,
    AfterSalesPreparationService,
    AfterSalesLegacyAdapter,
    AfterSalesMigrationService,
    RolesGuard,
    PermissionsGuard,
    AfterSalesSourceGuard,
  ],
  exports: [AfterSalesLegacyAdapter, ErpAfterSalesModuleService],
})
export class AfterSalesIntegrationModule {}
