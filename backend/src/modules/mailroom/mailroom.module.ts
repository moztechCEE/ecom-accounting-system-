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
import { MailroomStorageController } from './mailroom-storage.controller';
import { MailroomStorageService } from './mailroom-storage.service';
import { MailroomCatalogController } from './mailroom-catalog.controller';
import { MailroomCatalogService } from './mailroom-catalog.service';
import { MailroomSourceMediaController } from './mailroom-source-media.controller';
import { MailroomSourceMediaService } from './mailroom-source-media.service';
import { RepairTodoService } from './repair-todo.service';
import { AfterSalesTasksController } from './after-sales-tasks.controller';
import { AfterSalesTasksService } from './after-sales-tasks.service';
@Module({
  imports: [
    NotificationModule,
    AuthModule,
    AfterSalesStockModule,
    AfterSalesIntegrationModule,
  ],
  controllers: [
    AfterSalesTasksController,
    MailroomController,
    MailroomTabletController,
    RepairWorkbenchController,
    MailroomStorageController,
    MailroomCatalogController,
    MailroomSourceMediaController,
  ],
  providers: [
    AfterSalesTasksService,
    MailroomService,
    MailroomIntakeService,
    MailroomSyncService,
    MailroomSourceSyncService,
    MailroomTabletService,
    RepairWorkbenchService,
    MailroomStorageService,
    MailroomCatalogService,
    MailroomSourceMediaService,
    RepairTodoService,
  ],
})
export class MailroomModule {}
