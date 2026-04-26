import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { InvoicingService } from './invoicing.service';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * InvoicingController
 *
 * 電子發票管理 API
 *
 * 功能：
 * - 預覽發票
 * - 開立發票
 * - 作廢發票
 * - 開立折讓單
 * - 查詢發票狀態
 */
@ApiTags('Invoicing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invoicing')
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  /**
   * 查詢訂單的發票狀態
   */
  @Get('by-order/:orderId')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '查詢訂單的發票狀態',
    description: '查詢指定訂單的所有發票記錄，包含發票明細和操作歷程',
  })
  @ApiParam({
    name: 'orderId',
    description: '銷售訂單ID',
    example: 'order-uuid-123',
  })
  @ApiResponse({
    status: 200,
    description: '發票資料列表',
  })
  async getInvoiceByOrderId(@Param('orderId') orderId: string) {
    return this.invoicingService.getInvoiceByOrderId(orderId);
  }

  @Get('queue')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '查詢發票待辦隊列',
    description:
      '取得目前待開票、可開票、已開票的訂單隊列，供 Dashboard 與營運中心使用。',
  })
  async getInvoiceQueue(
    @Query('entityId') entityId: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.invoicingService.getInvoiceQueue(entityId, {
      limit: limit ? Number(limit) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('readiness')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '查詢綠界電子發票開立 readiness',
    description:
      '只回傳設定完整度，不會呼叫綠界開立發票；用來確認 3290494 / 3150241 是否已具備正式開票條件。',
  })
  async getInvoiceProviderReadiness() {
    return this.invoicingService.getInvoiceProviderReadiness();
  }

  /**
   * 預覽發票內容
   */
  @Get('preview/:orderId')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({
    summary: '預覽發票內容',
    description:
      '在正式開立發票前，預覽發票內容，包含金額計算、稅額、明細等資訊',
  })
  @ApiParam({
    name: 'orderId',
    description: '銷售訂單ID',
    example: 'order-uuid-123',
  })
  @ApiResponse({
    status: 200,
    description: '發票預覽資料',
    schema: {
      example: {
        orderId: 'order-uuid-123',
        invoiceType: 'B2C',
        buyerName: '測試客戶',
        currency: 'TWD',
        amountOriginal: '1000.00',
        taxAmountOriginal: '50.00',
        totalAmountOriginal: '1050.00',
        estimatedInvoiceNumber: 'AA12345678',
        warnings: [],
      },
    },
  })
  async previewInvoice(@Param('orderId') orderId: string) {
    return this.invoicingService.previewInvoice(orderId);
  }

  /**
   * 開立正式發票
   */
  @Post('issue/:orderId')
  @Roles('ADMIN', 'ACCOUNTANT')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '開立正式發票（待綠界 API Adapter 啟用）',
    description:
      '正式環境目前不允許用本地假字軌開票；需先接上綠界電子發票 API。現階段請改用綠界銷項發票匯入回填訂單。',
  })
  @ApiParam({
    name: 'orderId',
    description: '銷售訂單ID',
    example: 'order-uuid-123',
  })
  @ApiResponse({
    status: 201,
    description: '發票開立成功',
    schema: {
      example: {
        success: true,
        invoiceId: 'invoice-uuid-456',
        invoiceNumber: 'AA12345678',
        totalAmount: '1050.00',
        currency: 'TWD',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '訂單不存在',
  })
  @ApiResponse({
    status: 409,
    description: '訂單已開立發票',
  })
  async issueInvoice(
    @Param('orderId') orderId: string,
    @Body() dto: IssueInvoiceDto,
    @CurrentUser() user: any,
  ) {
    return this.invoicingService.issueInvoice(orderId, dto, user.userId);
  }

  @Post('issue-eligible')
  @Roles('ADMIN', 'ACCOUNTANT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '批次開立符合條件的訂單發票（待綠界 API Adapter 啟用）',
    description:
      '正式環境目前不允許批次產生本地假字軌發票；需先接上綠界電子發票 API。現階段請改用綠界銷項發票匯入回填訂單。',
  })
  async issueEligibleInvoices(
    @Body()
    body: {
      entityId: string;
      limit?: number;
      startDate?: string;
      endDate?: string;
      invoiceType?: string;
      merchantKey?: string;
      merchantId?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.invoicingService.issueEligibleInvoices(
      body.entityId,
      user.userId,
      {
        limit: body.limit,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        invoiceType: body.invoiceType,
        merchantKey: body.merchantKey,
        merchantId: body.merchantId,
      },
    );
  }

  /**
   * 作廢發票
   */
  @Post(':invoiceId/void')
  @Roles('ADMIN', 'ACCOUNTANT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '作廢發票',
    description: '作廢已開立的發票，作廢後將無法恢復，並記錄作廢原因',
  })
  @ApiParam({
    name: 'invoiceId',
    description: '發票ID',
    example: 'invoice-uuid-456',
  })
  @ApiResponse({
    status: 200,
    description: '發票作廢成功',
    schema: {
      example: {
        success: true,
        invoiceNumber: 'AA12345678',
        voidAt: '2025-11-18T12:00:00Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '發票狀態不符（已作廢或非已開立狀態）',
  })
  @ApiResponse({
    status: 404,
    description: '發票不存在',
  })
  async voidInvoice(
    @Param('invoiceId') invoiceId: string,
    @Body() body: { reason: string },
    @CurrentUser() user: any,
  ) {
    return this.invoicingService.voidInvoice(
      invoiceId,
      body.reason,
      user.userId,
    );
  }

  /**
   * 開立折讓單
   */
  @Post(':invoiceId/allowance')
  @Roles('ADMIN', 'ACCOUNTANT')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '開立折讓單',
    description: '對已開立的發票開立折讓單（負項發票），用於部分退款或價格調整',
  })
  @ApiParam({
    name: 'invoiceId',
    description: '原發票ID',
    example: 'invoice-uuid-456',
  })
  @ApiResponse({
    status: 201,
    description: '折讓單開立成功',
    schema: {
      example: {
        success: true,
        allowanceInvoiceNumber: 'AA12345678-AL-123456',
        allowanceAmount: 100,
        originalInvoiceNumber: 'AA12345678',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '折讓金額不合法或發票狀態不符',
  })
  @ApiResponse({
    status: 404,
    description: '發票不存在',
  })
  async createAllowance(
    @Param('invoiceId') invoiceId: string,
    @Body() body: { allowanceAmount: number; reason: string },
    @CurrentUser() user: any,
  ) {
    return this.invoicingService.createAllowance(
      invoiceId,
      body.allowanceAmount,
      body.reason,
      user.userId,
    );
  }
}
