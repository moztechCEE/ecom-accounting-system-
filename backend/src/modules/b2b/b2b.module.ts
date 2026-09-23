import { Module } from '@nestjs/common';
import { B2bService } from './b2b.service';
import { B2bAdminController, B2bPortalController } from './b2b.controller';
import { SalesModule } from '../sales/sales.module';
import { B2bSupplierAdminController } from './b2b-supplier-admin.controller';
import { B2bSupplierAdminService } from './b2b-supplier-admin.service';
@Module({
  imports: [SalesModule],
  controllers: [B2bPortalController, B2bAdminController, B2bSupplierAdminController],
  providers: [B2bService, B2bSupplierAdminService],
  exports: [B2bService],
})
export class B2bModule {}
