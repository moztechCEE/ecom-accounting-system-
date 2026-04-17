import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApService } from './ap.service';
import { BatchCreateApInvoicesDto } from './dto/batch-create-ap-invoices.dto';
import { ImportEcpayServiceFeeInvoicesDto } from './dto/import-ecpay-service-fee-invoices.dto';
import { QueryEcpayServiceFeeInvoiceDto } from './dto/query-ecpay-service-fee-invoice.dto';
import { UpdateApInvoiceDto } from './dto/update-ap-invoice.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * 應付帳款控制器
 */
@ApiTags('ap')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ap')
export class ApController {
  constructor(private readonly apService: ApService) {}

  @Get('invoices')
  @ApiOperation({ summary: '查詢應付帳款發票列表' })
  async getInvoices(@Query('entityId') entityId?: string) {
    return this.apService.getInvoices(entityId);
  }

  @Post('invoices')
  @ApiOperation({ summary: '建立AP發票' })
  async createInvoice(@Body() data: any) {
    return this.apService.createInvoice(data);
  }

  @Post('invoices/batch-import')
  @ApiOperation({ summary: '批次匯入AP發票' })
  async batchImport(@Body() payload: BatchCreateApInvoicesDto) {
    return this.apService.batchImportInvoices(payload);
  }

  @Patch('invoices/:id')
  @ApiOperation({ summary: '更新AP發票（付款頻率/到期日）' })
  async updateInvoice(
    @Param('id') id: string,
    @Body() dto: UpdateApInvoiceDto,
  ) {
    return this.apService.updateInvoice(id, dto);
  }

  @Post('invoices/:id/pay')
  @ApiOperation({ summary: '記錄付款' })
  async recordPayment(@Param('id') id: string, @Body() data: any) {
    return this.apService.recordPayment(id, data);
  }

  @Get('invoices/alerts')
  @ApiOperation({ summary: '取得應付帳款警示統計' })
  async getInvoiceAlerts(@Query('entityId') entityId?: string) {
    return this.apService.getInvoiceAlerts(entityId);
  }

  @Get('ecpay/service-fee-invoices/summary')
  @ApiOperation({ summary: '綠界服務費發票摘要' })
  async getEcpayServiceFeeInvoiceSummary(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.apService.getEcpayServiceFeeInvoiceSummary(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Post('ecpay/service-fee-invoices/import')
  @ApiOperation({ summary: '匯入綠界服務費發票' })
  async importEcpayServiceFeeInvoices(
    @Body() payload: ImportEcpayServiceFeeInvoicesDto,
    @CurrentUser() user: any,
  ) {
    return this.apService.importEcpayServiceFeeInvoices(
      payload,
      user?.userId,
    );
  }

  @Post('ecpay/service-fee-invoices/query-status')
  @ApiOperation({ summary: '查詢綠界電子發票是否已開立' })
  async queryEcpayServiceFeeInvoiceStatus(
    @Body() payload: QueryEcpayServiceFeeInvoiceDto,
  ) {
    return this.apService.queryEcpayServiceFeeInvoiceStatus(payload);
  }

  @Get('due-report')
  @ApiOperation({ summary: '到期應付款報表' })
  async getDueReport(@Query('entityId') entityId: string) {
    return this.apService.getDuePayablesReport(entityId);
  }
}
