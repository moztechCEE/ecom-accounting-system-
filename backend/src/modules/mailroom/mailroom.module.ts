import { AfterSalesIntegrationModule } from '../integration/after-sales/after-sales.module';
import { MailroomIntakeService } from './mailroom-intake.service';
import { Module } from '@nestjs/common';
import { AfterSalesStockModule } from '../integration/after-sales/after-sales-stock.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { MailroomController } from './mailroom.controller';
import { MailroomService } from './mailroom.service';
import { MailroomSourceSyncService } from './mailroom-source-sync.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { MailroomTabletController } from './mailroom-tablet.controller';
import { MailroomTabletService } from './mailroom-tablet.service';
import { RepairWorkbenchController } from './repair-workbench.controller';
import { RepairWorkbenchService } from './repair-workbench.service';
@Module({
  imports: [
    NotificationModule,
    AuthModule,
    AfterSalesStockModule,
    AfterSalesIntegrationModule,
  ],
  controllers: [
    MailroomController,
    MailroomTabletController,
    RepairWorkbenchController,
  ],
  providers: [
    MailroomService,
    MailroomIntakeService,
    MailroomSyncService,
    MailroomSourceSyncService,
    MailroomTabletService,
    RepairWorkbenchService,
  ],
})
export class MailroomModule {}
