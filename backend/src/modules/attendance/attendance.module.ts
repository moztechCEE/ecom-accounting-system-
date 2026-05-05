import { Module } from '@nestjs/common';
import { AttendanceController } from './controllers/attendance.controller';
import { LeaveController } from './controllers/leave.controller';
import { AttendanceService } from './services/attendance.service';
import { ScheduleService } from './services/schedule.service';
import { PolicyService } from './services/policy.service';
import { LeaveService } from './services/leave.service';
import { AnomalyService } from './services/anomaly.service';
import { BalanceService } from './services/balance.service';
import { DisasterClosureService } from './services/disaster-closure.service';
import { AttendanceIntegrationService } from './services/integration.service';
import { OvertimeService } from './services/overtime.service';
import { GpsValidationStrategy } from './strategies/gps-validation.strategy';
import { IpValidationStrategy } from './strategies/ip-validation.strategy';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [AttendanceController, LeaveController],
  providers: [
    AttendanceService,
    ScheduleService,
    PolicyService,
    LeaveService,
    AnomalyService,
    BalanceService,
    DisasterClosureService,
    AttendanceIntegrationService,
    OvertimeService,
    GpsValidationStrategy,
    IpValidationStrategy,
    RolesGuard,
  ],
  exports: [
    AttendanceService,
    LeaveService,
    BalanceService,
    DisasterClosureService,
    AttendanceIntegrationService,
    OvertimeService,
  ],
})
export class AttendanceModule {}
