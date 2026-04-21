import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  Put,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BankingService } from './banking.service';

/**
 * 銀行帳戶控制器
 * 管理銀行帳戶、交易記錄、對帳作業
 */
@ApiTags('banking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('banking')
export class BankingController {
  constructor(private readonly bankingService: BankingService) {}

  @Get('accounts')
  @ApiOperation({ summary: '查詢銀行帳戶列表' })
  @ApiResponse({ status: 200, description: '成功取得銀行帳戶列表' })
  async getBankAccounts(@Query('entityId') entityId?: string) {
    return this.bankingService.getBankAccounts(entityId || '');
  }

  @Get('accounts/:id')
  @ApiOperation({ summary: '查詢單一銀行帳戶' })
  @ApiResponse({ status: 200, description: '成功取得銀行帳戶詳情' })
  async getBankAccount(@Param('id') id: string) {
    return this.bankingService.getBankAccount(id);
  }

  @Post('accounts')
  @ApiOperation({ summary: '建立銀行帳戶' })
  @ApiResponse({ status: 201, description: '成功建立銀行帳戶' })
  async createBankAccount(@Body() data: any) {
    return this.bankingService.createBankAccount(data);
  }

  @Get('transactions')
  @ApiOperation({ summary: '查詢銀行交易記錄' })
  @ApiResponse({ status: 200, description: '成功取得交易記錄' })
  async getTransactions(
    @Query('bankAccountId') bankAccountId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.bankingService.getBankTransactions(
      bankAccountId || '',
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Post('transactions')
  @ApiOperation({ summary: '建立銀行交易' })
  @ApiResponse({ status: 201, description: '成功建立交易記錄' })
  async createTransaction(@Body() data: any) {
    return this.bankingService.createBankTransaction(data);
  }

  @Put('transactions/:id/reconcile')
  @ApiOperation({ summary: '更新對帳狀態' })
  @ApiResponse({ status: 200, description: '成功更新對帳狀態' })
  async updateReconciliation(@Param('id') id: string, @Body() data: any) {
    return this.bankingService.updateReconciliation(id, data);
  }

  @Get('accounts/:id/balance')
  @ApiOperation({ summary: '查詢帳戶餘額' })
  @ApiResponse({ status: 200, description: '成功取得帳戶餘額' })
  async getAccountBalance(@Param('id') id: string) {
    return this.bankingService.getAccountBalance(id);
  }

  @Post('accounts/:id/import-statement')
  @ApiOperation({ summary: '匯入銀行對帳單' })
  @ApiResponse({ status: 201, description: '成功匯入對帳單並執行初步對帳' })
  async importStatement(@Param('id') id: string, @Body() data: any) {
    return this.bankingService.importBankStatement(
      id,
      Buffer.from(data.csvContent || '', 'utf8'),
    );
  }

  @Post('accounts/:id/auto-reconcile')
  @ApiOperation({ summary: '執行銀行自動對帳' })
  @ApiResponse({ status: 200, description: '成功執行自動對帳' })
  async autoReconcile(
    @Param('id') id: string,
    @Body() data: { transactionDate?: string },
  ) {
    return this.bankingService.autoReconcile(
      id,
      data?.transactionDate ? new Date(data.transactionDate) : undefined,
    );
  }

  @Post('transactions/:id/manual-reconcile')
  @ApiOperation({ summary: '手動對帳指定銀行交易' })
  @ApiResponse({ status: 200, description: '成功手動對帳' })
  async manualReconcile(
    @Param('id') id: string,
    @Body() data: { paymentId: string },
  ) {
    return this.bankingService.manualReconcile(id, data.paymentId);
  }

  @Get('accounts/:id/reconciliation-report')
  @ApiOperation({ summary: '查詢銀行對帳報表' })
  @ApiResponse({ status: 200, description: '成功取得對帳報表' })
  async getReconciliationReport(
    @Param('id') id: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.bankingService.getReconciliationReport(
      id,
      asOfDate ? new Date(asOfDate) : new Date(),
    );
  }

  @Post('virtual-accounts')
  @ApiOperation({ summary: '建立虛擬帳號' })
  @ApiResponse({ status: 201, description: '成功建立虛擬帳號' })
  async createVirtualAccount(@Body() data: any) {
    return this.bankingService.createVirtualAccount(data);
  }

  @Post('virtual-accounts/match')
  @ApiOperation({ summary: '依虛擬帳號自動配對收款' })
  @ApiResponse({ status: 200, description: '成功執行虛擬帳號配對' })
  async matchVirtualAccount(@Body() data: any) {
    return this.bankingService.matchVirtualAccountPayment(
      data.virtualAccountNumber,
      Number(data.amount),
    );
  }
}
