import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollRepository } from './payroll.repository';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module'; // 依賴：薪資分錄
import { ApprovalsModule } from '../approvals/approvals.module'; // 依賴：薪資審批
import { AttendanceModule } from '../attendance/attendance.module'; // 依賴：考勤數據
import { RolesGuard } from '../../common/guards/roles.guard';
import { UsersModule } from '../users/users.module';

/**
 * PayrollModule
 * 薪資管理模組
 *
 * 依賴模組：
 * - AccountingModule: 薪資產生會計分錄
 * - ApprovalsModule: 薪資需要審批流程
 * - AttendanceModule: 獲取考勤時數
 */
@Module({
  imports: [
    PrismaModule,
    AccountingModule,
    ApprovalsModule,
    AttendanceModule,
    UsersModule,
  ],
  controllers: [PayrollController],
  providers: [PayrollService, PayrollRepository, RolesGuard],
  exports: [PayrollService],
})
export class PayrollModule {}
