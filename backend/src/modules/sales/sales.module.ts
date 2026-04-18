import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { CustomerController } from './customer.controller';
import { SalesService } from './sales.service';
import { SalesOrderService } from './services/sales-order.service';
import { CustomerService } from './customer.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module'; // 依賴：產生會計分錄
import { InventoryModule } from '../inventory/inventory.module';
import { ApModule } from '../ap/ap.module';

/**
 * SalesModule
 * 銷售模組，處理銷售訂單、出貨、收款等電商銷售流程
 *
 * 功能：
 * - 銷售訂單管理（多平台、多幣別）
 * - 訂單狀態追蹤
 * - 自動產生銷售相關會計分錄
 * - 平台費用與金流手續費計算
 * - 支援退款與退貨處理
 *
 * 依賴模組：
 * - AccountingModule: 用於產生銷售相關會計分錄
 *
 * 分錄邏輯：
 * - 訂單完成時：
 *   借：應收帳款 / 銀行存款
 *   貸：銷貨收入、應付平台費、應付金流費
 * - 退款時：沖回收入與費用
 */
@Module({
  imports: [PrismaModule, AccountingModule, InventoryModule, ApModule],
  controllers: [SalesController, CustomerController],
  providers: [SalesService, SalesOrderService, CustomerService],
  exports: [SalesService, SalesOrderService],
})
export class SalesModule {}
