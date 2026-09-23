import { Module } from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { PurchaseController } from './purchase.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CostModule } from '../cost/cost.module';
import { PurchaseB2bQueueService } from './purchase-b2b-queue.service';

@Module({
  imports: [PrismaModule, InventoryModule, CostModule],
  controllers: [PurchaseController],
  providers: [PurchaseService, PurchaseB2bQueueService],
  exports: [PurchaseService],
})
export class PurchaseModule {}
