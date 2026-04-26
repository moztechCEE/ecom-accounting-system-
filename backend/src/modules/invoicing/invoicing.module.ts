import { Module } from '@nestjs/common';
import { InvoicingController } from './invoicing.controller';
import { InvoicingService } from './invoicing.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { EcpayEinvoiceAdapter } from './adapters/ecpay-einvoice.adapter';
import { EcpayEinvoiceConfigService } from './services/ecpay-einvoice-config.service';

/**
 * InvoicingModule
 *
 * 電子發票整合模組
 *
 * 功能：
 * - 預覽交易的電子發票內容
 * - 開立正式電子發票
 * - 發票作廢與折讓
 * - 與台灣財政部電子發票系統整合
 *
 * TODO: 未來整合
 * - 串接財政部電子發票API（Turnkey）
 * - 支援B2B、B2C發票格式
 * - 自動上傳至大平台
 * - 發票PDF產生與email寄送
 */
@Module({
  imports: [PrismaModule],
  controllers: [InvoicingController],
  providers: [
    InvoicingService,
    EcpayEinvoiceAdapter,
    EcpayEinvoiceConfigService,
  ],
  exports: [InvoicingService],
})
export class InvoicingModule {}
