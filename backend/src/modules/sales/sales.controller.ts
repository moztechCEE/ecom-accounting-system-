import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SalesService } from './sales.service';
import { SalesOrderService } from './services/sales-order.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { FulfillSalesOrderDto } from './dto/fulfill-sales-order.dto';
import { ImportEcpayIssuedInvoicesDto } from './dto/import-ecpay-issued-invoices.dto';
import { SyncSalesOrderInvoiceStatusDto } from './dto/sync-sales-order-invoice-status.dto';
/**
 * SalesController 銷售控制器
 */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
@UseGuards(JwtAuthGuard)
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly salesOrderService: SalesOrderService,
  ) {}

  /**
   * 查詢銷售渠道
   */
  @Get('channels')
  @ApiOperation({ summary: '查詢銷售渠道' })
  @ApiQuery({ name: 'entityId', required: true })
  async getSalesChannels(@Query('entityId') entityId: string) {
    return this.salesService.getSalesChannels(this.requireEntityId(entityId));
  }

  /**
   * 查詢銷售訂單
   */
  @Get('orders')
  @ApiOperation({ summary: '查詢銷售訂單' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'channelId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getSalesOrders(
    @Query('entityId') entityId: string,
    @Query('channelId') channelId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedStartDate = this.parseOptionalDate(startDate, 'startDate');
    const parsedEndDate = this.parseOptionalDate(endDate, 'endDate');

    return this.salesOrderService.getSalesOrders(this.requireEntityId(entityId), {
      channelId,
      status,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      limit: this.parseOptionalLimit(limit),
    });
  }

  /**
   * 建立銷售訂單
   */
  @Post('orders')
  @ApiOperation({ summary: '建立銷售訂單' })
  async createSalesOrder(
    @Body() dto: CreateSalesOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.salesOrderService.createSalesOrder(dto, userId);
  }

  /**
   * 訂單出貨 (扣減庫存)
   */
  @Post('orders/:id/fulfill')
  @ApiOperation({ summary: '訂單出貨 (扣減庫存)' })
  @ApiQuery({ name: 'entityId', required: true })
  async fulfillSalesOrder(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Query('entityId') entityId: string,
    @Body() dto: FulfillSalesOrderDto,
  ) {
    return this.salesService.fulfillSalesOrder({
      entityId: this.requireEntityId(entityId),
      warehouseId: dto.warehouseId,
      salesOrderId: orderId,
      itemSerialNumbers: dto.itemSerialNumbers,
    });
  }

  /**
   * 完成訂單（產生會計分錄）
   */
  @Post('orders/:id/complete')
  @ApiOperation({ summary: '完成訂單並產生會計分錄' })
  async completeSalesOrder(
    @Param('id', ParseUUIDPipe) orderId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.salesOrderService.completeSalesOrder(orderId, userId);
  }

  @Post('orders/:id/invoice-status-sync')
  @ApiOperation({ summary: '同步單筆訂單的綠界電子發票狀態' })
  async syncSalesOrderInvoiceStatus(
    @Param('id', ParseUUIDPipe) orderId: string,
  ) {
    return this.salesOrderService.syncOrderInvoiceStatus(orderId);
  }

  @Post('orders/:id/refund')
  @ApiOperation({ summary: '建立訂單退款 / 售後沖銷' })
  async refundSalesOrder(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() body: { refundAmount: number; reason?: string; refundDate?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.salesOrderService.applyRefund(
      orderId,
      Number(body.refundAmount || 0),
      body.reason || '售後退款',
      userId,
      body.refundDate ? new Date(body.refundDate) : undefined,
    );
  }

  @Post('orders/invoice-status-sync')
  @ApiOperation({ summary: '批次同步銷售訂單的綠界電子發票狀態' })
  async syncSalesOrderInvoiceStatusBatch(
    @Body() dto: SyncSalesOrderInvoiceStatusDto,
  ) {
    return this.salesOrderService.syncInvoiceStatusForOrders({
      entityId: this.requireEntityId(dto.entityId),
      channelId: dto.channelId,
      status: dto.status,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      limit: dto.limit,
    });
  }

  @Post('orders/ecpay-issued-invoices/import')
  @ApiOperation({ summary: '匯入綠界銷項發票資料並回填 SalesOrder / Invoice' })
  async importEcpayIssuedInvoices(
    @Body() dto: ImportEcpayIssuedInvoicesDto,
  ) {
    return this.salesOrderService.importEcpayIssuedInvoices({
      entityId: this.requireEntityId(dto.entityId),
      merchantKey: dto.merchantKey?.trim() || undefined,
      merchantId: dto.merchantId?.trim() || undefined,
      markIssued: dto.markIssued !== false,
      dryRun: dto.dryRun === true,
      rows: dto.rows,
      mapping: dto.mapping,
    });
  }

  /**
   * 建立模擬訂單（用於測試）
   */
  @Post('orders/mock')
  @ApiOperation({ summary: '建立模擬訂單用於測試系統流程' })
  @ApiQuery({ name: 'entityId', required: true, description: '公司實體ID' })
  async createMockOrder(
    @Query('entityId') entityId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.salesOrderService.createMockOrder(this.requireEntityId(entityId), userId);
  }

  private requireEntityId(entityId?: string) {
    const trimmed = entityId?.trim();
    if (!trimmed) {
      throw new BadRequestException('entityId is required');
    }
    return trimmed;
  }

  private parseOptionalDate(value: string | undefined, fieldName: string) {
    if (!value?.trim()) {
      return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO date`);
    }

    return parsed;
  }

  private parseOptionalLimit(value: string | undefined) {
    if (!value?.trim()) {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    return parsed;
  }
}
