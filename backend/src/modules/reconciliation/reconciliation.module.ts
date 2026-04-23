import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { ProviderPayoutReconciliationService } from './provider-payout-reconciliation.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { EcpayShopifyPayoutService } from './ecpay-shopify-payout.service';
import { LinePayService } from './line-pay.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ArModule } from '../ar/ar.module';
import { ReportsModule } from '../reports/reports.module';
import { ShopifyIntegrationModule } from '../integration/shopify/shopify.module';
import { OneShopIntegrationModule } from '../integration/one-shop/one-shop.module';
import { SalesModule } from '../sales/sales.module';

/**
 * ReconciliationModule
 *
 * 銀行自動對帳模組
 *
 * 功能：
 * - 銀行明細匯入（CSV/JSON）
 * - 自動比對銀行交易與會計記錄
 * - 虛擬帳號管理與匹配
 * - 對帳差異處理
 * - 對帳報表產生
 *
 * TODO: 未來整合
 * - 各家銀行CSV格式轉換器
 * - 多層級匹配規則引擎（金額+日期+客戶名+備註）
 * - 機器學習自動分類建議
 * - 即時銀行API串接（部分銀行支援）
 * - 異常交易告警
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ArModule,
    ReportsModule,
    SalesModule,
    ShopifyIntegrationModule,
    OneShopIntegrationModule,
  ],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationService,
    ProviderPayoutReconciliationService,
    EcpayShopifyPayoutService,
    LinePayService,
    RolesGuard,
  ],
  exports: [
    ReconciliationService,
    ProviderPayoutReconciliationService,
    EcpayShopifyPayoutService,
    LinePayService,
  ],
})
export class ReconciliationModule {}
