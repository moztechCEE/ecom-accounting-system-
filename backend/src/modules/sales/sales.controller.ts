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
  async getSalesOrders(
    @Query('entityId') entityId: string,
    @Query('channelId') channelId?: string,
    @Query('status') status?: string,
  ) {
    return this.salesOrderService.getSalesOrders(this.requireEntityId(entityId), {
      channelId,
      status,
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
}
