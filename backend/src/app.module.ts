import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Common modules
import { ConfigModule } from './common/config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuditModule } from './common/audit/audit.module';
import { DatabaseModule } from './common/database/database.module';
import { RedisModule } from './common/redis/redis.module'; // Added RedisModule
import { GlobalQueueModule } from './common/queue/queue.module'; // Added QueueModule
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

// Feature modules - 按照指定的 12 個模組順序
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { EntitiesModule } from './modules/entities/entities.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { SalesModule } from './modules/sales/sales.module';
import { CostModule } from './modules/cost/cost.module';
import { ArModule } from './modules/ar/ar.module';
import { ApModule } from './modules/ap/ap.module';
import { ExpenseModule } from './modules/expense/expense.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { BankingModule } from './modules/banking/banking.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { ReportsModule } from './modules/reports/reports.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { VendorModule } from './modules/vendor/vendor.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductModule } from './modules/product/product.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AiModule } from './modules/ai/ai.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ShopifyIntegrationModule } from './modules/integration/shopify/shopify.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { AssemblyModule } from './modules/assembly/assembly.module';

/**
 * AppModule
 * 應用程式根模組
 *
 * 架構設計：
 * - Common: 共用模組（Prisma, Config, Guards, Decorators）
 * - Modules: 14 個業務模組（依序為：Auth, Users, Entities, Accounting, Sales, Cost, AR, AP, Expense, Approvals, Banking, Payroll, Reports, Invoicing, Reconciliation）
 *
 * 模組依賴關係（重要！）：
 * - SalesModule → AccountingModule（訂單完成時產生會計分錄）
 * - ApModule → ApprovalsModule, BankingModule（AP需要審批流程與銀行付款）
 * - PayrollModule → AccountingModule, ApprovalsModule（薪資需產生分錄與審批）
 * - ExpenseModule → ApprovalsModule, ApModule（費用需審批後產生AP）
 * - ArModule → AccountingModule（AR發票產生會計分錄）
 * - CostModule → AccountingModule（成本攤提產生分錄）
 * - ReportsModule → AccountingModule（報表依賴會計資料）
 * - InvoicingModule → SalesModule, ArModule（電子發票整合）
 * - ReconciliationModule → BankingModule, AccountingModule（銀行對帳整合）
 *
 * 全域設定：
 * - ConfigModule: 環境變數管理
 * - PrismaModule: 資料庫連線
 * - JwtAuthGuard: 預設所有路由都需要 JWT 驗證（除非標記 @Public()）
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    DatabaseModule,
    RedisModule, // Added logic
    GlobalQueueModule, // Global Queue
    ScheduleModule.forRoot(),

    // Features
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    EntitiesModule,
    VendorModule,
    InventoryModule,
    ProductModule,

    // 2. 核心會計模組（被其他模組依賴）
    AccountingModule,
    ApprovalsModule,
    BankingModule,

    // 3. 業務模組（依賴核心模組）
    SalesModule, // → AccountingModule
    CostModule, // → AccountingModule
    ArModule, // → AccountingModule
    ApModule, // → ApprovalsModule, BankingModule
    ExpenseModule, // → ApprovalsModule, ApModule
    PayrollModule, // → AccountingModule, ApprovalsModule

    // 4. 報表模組（依賴所有業務模組）
    ReportsModule, // → AccountingModule

    // 5. 整合模組（外部服務整合）
    InvoicingModule, // → SalesModule, ArModule (電子發票)
    ReconciliationModule, // → BankingModule, AccountingModule (銀行對帳)
    ShopifyIntegrationModule,
    NotificationModule,
    AiModule,
    AttendanceModule,
    PurchaseModule,
    AssemblyModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 全域啟用 JWT 驗證
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
