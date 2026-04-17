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
  ) {
    return this.arService.getReceivableMonitor(entityId, status);
  }

  @Post('sync/sales-orders')
  @ApiOperation({ summary: '將銷售訂單同步為應收帳款與收入分錄' })
  async syncSalesOrders(
    @Query('entityId') entityId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.arService.syncSalesReceivables(entityId, userId);
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
  async recordPayment(@Param('id') id: string, @Body() data: any) {
    return this.arService.recordPayment(id, data);
  }

  @Get('aging-report')
  @ApiOperation({ summary: '產生帳齡分析表' })
  @ApiResponse({ status: 200, description: 'AR帳齡分析' })
  async getAgingReport(@Query('entityId') entityId: string) {
    return this.arService.getAgingReport(entityId, new Date());
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
}
