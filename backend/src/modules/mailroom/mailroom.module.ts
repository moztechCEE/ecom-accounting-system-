import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { MailroomController } from './mailroom.controller';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { MailroomTabletController } from './mailroom-tablet.controller';
import { MailroomTabletService } from './mailroom-tablet.service';
@Module({
  imports: [NotificationModule, AuthModule],
  controllers: [MailroomController, MailroomTabletController],
  providers: [MailroomService, MailroomSyncService, MailroomTabletService],
})
export class MailroomModule {}
