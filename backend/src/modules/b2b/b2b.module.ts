import { Module } from '@nestjs/common';
import { B2bService } from './b2b.service';
import { B2bAdminController, B2bPortalController } from './b2b.controller';
import { SalesModule } from '../sales/sales.module';
@Module({
  imports: [SalesModule],
  controllers: [B2bPortalController, B2bAdminController],
  providers: [B2bService],
  exports: [B2bService],
})
export class B2bModule {}
