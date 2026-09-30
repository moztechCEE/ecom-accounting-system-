import { Module } from '@nestjs/common';
import { B2bService } from './b2b.service';
import { B2bAdminController, B2bPortalController, B2bPrivateQuoteController } from './b2b.controller';
import { SalesModule } from '../sales/sales.module';
import { B2bSupplierAdminController } from './b2b-supplier-admin.controller';
import { B2bSupplierAdminService } from './b2b-supplier-admin.service';
import {
  B2bPriceBookAdminController,
  B2bPublicCatalogController,
} from './b2b-pricebook.controller';
import { B2bPriceBookService } from './b2b-pricebook.service';
import {
  B2bGuestPublicController,
  B2bGuestAdminController,
} from './b2b-guest.controller';
import { B2bGuestService } from './b2b-guest.service';
import { B2bQuoteMailService } from './b2b-quote-mail.service';
@Module({
  imports: [SalesModule],
  controllers: [
    B2bPortalController,
    B2bAdminController,
    B2bPrivateQuoteController,
    B2bSupplierAdminController,
    B2bPriceBookAdminController,
    B2bPublicCatalogController,
    B2bGuestPublicController,
    B2bGuestAdminController,
  ],
  providers: [
    B2bService,
    B2bQuoteMailService,
    B2bSupplierAdminService,
    B2bPriceBookService,
    B2bGuestService,
  ],
  exports: [B2bService, B2bPriceBookService],
})
export class B2bModule {}
