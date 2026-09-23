import { Module } from '@nestjs/common';
import { ExpenseController } from './expense.controller';
import { ExpenseService } from './expense.service';
import { ExpenseRepository } from './expense.repository';
import { AccountingClassifierService } from './accounting-classifier.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module'; // 依賴：費用審批
import { ApModule } from '../ap/ap.module'; // 依賴：審批後產生AP
import { NotificationModule } from '../notification/notification.module';
import { AiModule } from '../ai/ai.module';
import { ExpenseReceiptController } from './expense-receipt.controller';
import { ExpenseReceiptService } from './expense-receipt.service';

/**
 * ExpenseModule
 * 費用管理模組
 *
 * 依賴模組：
 * - ApprovalsModule: 費用申請需要審批
 * - ApModule: 審批通過後產生應付帳款
 */
@Module({
  imports: [PrismaModule, ApprovalsModule, ApModule, NotificationModule, AiModule],
  controllers: [ExpenseController, ExpenseReceiptController],
  providers: [ExpenseService, ExpenseRepository, AccountingClassifierService, ExpenseReceiptService],
  exports: [ExpenseService],
})
export class ExpenseModule {}
