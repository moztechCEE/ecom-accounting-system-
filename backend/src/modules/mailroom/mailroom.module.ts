import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { MailroomController } from './mailroom.controller';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { MailroomTabletController } from './mailroom-tablet.controller';
import { MailroomTabletService } from './mailroom-tablet.service';
import { RepairWorkbenchController } from './repair-workbench.controller';
import { RepairWorkbenchService } from './repair-workbench.service';
@Module({
  imports: [NotificationModule, AuthModule],
  controllers: [MailroomController, MailroomTabletController, RepairWorkbenchController],
  providers: [MailroomService, MailroomSyncService, MailroomTabletService, RepairWorkbenchService],
})
export class MailroomModule {}
