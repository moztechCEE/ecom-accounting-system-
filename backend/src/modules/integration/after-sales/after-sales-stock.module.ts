import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { AfterSalesStockService } from './after-sales-stock.service';
import { AfterSalesStockController } from './after-sales-stock.controller';
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AfterSalesStockController],
  providers: [AfterSalesStockService],
  exports: [AfterSalesStockService],
})
export class AfterSalesStockModule {}
