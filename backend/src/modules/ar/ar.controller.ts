/**
 * ar.controller.ts
 * 修改（2026-04）：新增 GET /ar/summary 回傳應收帳款總額摘要
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ArService } from './ar.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * 應收帳款控制器
 * 管理 AR 發票、帳齡分析、催收等
 */
@ApiTags('ar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ar')
export class ArController {
  constructor(private readonly arService: ArService) {}

  @Get('invoices')
  @ApiOperation({ summary: '查詢應收帳款發票列表' })
  @ApiResponse({ status: 200, description: '成功取得AR發票列表' })
  async getInvoices(
    @Query('entityId') entityId?: string,
    @Query('status') status?: string,
  ) {
    return this.arService.getInvoices(entityId, status);
  }

  @Get('monitor')
  @ApiOperation({ summary: '查詢銷售應收與入帳追蹤' })
  async getReceivableMonitor(
    @Query('entityId') entityId: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.arService.getReceivableMonitor(
      entityId,
      status,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('overpaid')
  @ApiOperation({
    summary: '查詢超收或疑似重複收款明細',
    description:
      '只讀診斷 paidAmount > grossAmount 的銷售訂單，列出付款明細與可能原因，不會修改 Payment 或 AR 資料。',
  })
  async getOverpaidReceivables(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.arService.getOverpaidReceivables(entityId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('sync/sales-orders')
  @ApiOperation({ summary: '將銷售訂單同步為應收帳款與收入分錄' })
  async syncSalesOrders(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return this.arService.syncSalesReceivables(entityId, userId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: '查詢單一AR發票' })
  async getInvoice(@Param('id') id: string) {
    return this.arService.getInvoice(id);
  }

  @Post('invoices')
  @ApiOperation({ summary: '建立AR發票' })
  async createInvoice(@Body() data: any) {
    return this.arService.createInvoice(data);
  }

  @Put('invoices/:id/receive')
  @ApiOperation({ summary: '記錄收款' })
  async recordPayment(
    @Param('id') id: string,
    @Body() data: any,
    @CurrentUser('id') userId: string,
  ) {
    return this.arService.recordPayment(id, { ...data, userId });
  }

  @Get('aging-report')
  @ApiOperation({ summary: '產生帳齡分析表' })
  @ApiResponse({ status: 200, description: 'AR帳齡分析' })
  async getAgingReport(@Query('entityId') entityId: string) {
    return this.arService.getAgingReport(entityId, new Date());
  }

  @Get('b2b-statements')
  @ApiOperation({ summary: '查詢 B2B 月結客戶應收對帳總覽' })
  async getB2BStatements(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.arService.getB2BStatements(
      entityId,
      asOfDate ? new Date(asOfDate) : new Date(),
      startDate ? new Date(startDate) : undefined,
    );
  }

  @Put('invoices/:id/write-off')
  @ApiOperation({ summary: '呆帳沖銷' })
  async writeOff(@Param('id') id: string, @Body() data: any) {
    return this.arService.writeOffBadDebt(
      id,
      data.amount || 0,
      data.reason || 'Write off',
    );
  }

  /**
   * GET /ar/summary
   * 回傳應收帳款總額摘要（未收總額、逾期筆數、逾期金額）
   * 供 Dashboard 財務快覽使用
   */
  @Get('summary')
  @ApiOperation({ summary: '應收帳款摘要', description: '查詢 ArInvoice 未收總額與逾期資訊' })
  @ApiResponse({ status: 200, description: '{ outstanding, overdueCount, overdueAmount }' })
  async getSummary(@Query('entityId') entityId?: string) {
    return this.arService.getSummary(entityId);
  }
}
