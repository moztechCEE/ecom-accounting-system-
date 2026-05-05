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
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'banking', action: 'read' })
  @ApiOperation({ summary: '查詢銀行帳戶列表' })
  @ApiResponse({ status: 200, description: '成功取得銀行帳戶列表' })
  async getBankAccounts(
    @CurrentUser() user: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.bankingService.getBankAccounts(entityId || '', user);
  }

  @Get('accounts/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'banking', action: 'read' })
  @ApiOperation({ summary: '查詢單一銀行帳戶' })
  @ApiResponse({ status: 200, description: '成功取得銀行帳戶詳情' })
  async getBankAccount(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bankingService.getBankAccount(id, user);
  }

  @Post('accounts')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '建立銀行帳戶' })
  @ApiResponse({ status: 201, description: '成功建立銀行帳戶' })
  async createBankAccount(@CurrentUser() user: any, @Body() data: any) {
    return this.bankingService.createBankAccount(data, user);
  }

  @Put('accounts/:id/access')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '設定銀行帳戶可檢視人員' })
  @ApiResponse({ status: 200, description: '成功更新銀行帳戶可檢視人員' })
  async updateBankAccountAccess(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() data: { allowedUserIds?: string[] },
  ) {
    return this.bankingService.updateBankAccountAccess(
      id,
      data.allowedUserIds || [],
      user,
    );
  }

  @Get('transactions')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'banking', action: 'read' })
  @ApiOperation({ summary: '查詢銀行交易記錄' })
  @ApiResponse({ status: 200, description: '成功取得交易記錄' })
  async getTransactions(
    @CurrentUser() user: any,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.bankingService.getBankTransactions(
      user,
      bankAccountId || '',
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Post('transactions')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '建立銀行交易' })
  @ApiResponse({ status: 201, description: '成功建立交易記錄' })
  async createTransaction(@CurrentUser() user: any, @Body() data: any) {
    return this.bankingService.createBankTransaction(data, user);
  }

  @Put('transactions/:id/reconcile')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'banking', action: 'update' })
  @ApiOperation({ summary: '更新對帳狀態' })
  @ApiResponse({ status: 200, description: '成功更新對帳狀態' })
  async updateReconciliation(@Param('id') id: string, @Body() data: any) {
    return this.bankingService.updateReconciliation(id, data);
  }

  @Get('accounts/:id/balance')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'banking', action: 'read' })
  @ApiOperation({ summary: '查詢帳戶餘額' })
  @ApiResponse({ status: 200, description: '成功取得帳戶餘額' })
  async getAccountBalance(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bankingService.getAccountBalance(id, user);
  }

  @Post('accounts/:id/import-statement')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '匯入銀行對帳單' })
  @ApiResponse({ status: 201, description: '成功匯入對帳單並執行初步對帳' })
  async importStatement(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() data: any,
  ): Promise<any> {
    return this.bankingService.importBankStatement(
      user,
      id,
      Buffer.from(data.csvContent || '', 'utf8'),
    );
  }

  @Post('accounts/:id/import-statement/preview')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'banking', action: 'read' })
  @ApiOperation({ summary: '預覽銀行對帳單匯入結果，不寫入資料' })
  @ApiResponse({ status: 201, description: '成功解析對帳單預覽' })
  async previewStatement(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() data: any,
  ): Promise<any> {
    return this.bankingService.previewBankStatement(
      user,
      id,
      Buffer.from(data.csvContent || '', 'utf8'),
    );
  }

  @Post('accounts/:id/auto-reconcile')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'banking', action: 'update' })
  @ApiOperation({ summary: '執行銀行自動對帳' })
  @ApiResponse({ status: 200, description: '成功執行自動對帳' })
  async autoReconcile(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() data: { transactionDate?: string },
  ) {
    return this.bankingService.autoReconcile(
      user,
      id,
      data?.transactionDate ? new Date(data.transactionDate) : undefined,
    );
  }

  @Post('transactions/:id/manual-reconcile')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'banking', action: 'update' })
  @ApiOperation({ summary: '手動對帳指定銀行交易' })
  @ApiResponse({ status: 200, description: '成功手動對帳' })
  async manualReconcile(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() data: { paymentId: string },
  ) {
    return this.bankingService.manualReconcile(user, id, data.paymentId);
  }

  @Get('accounts/:id/reconciliation-report')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'banking', action: 'read' })
  @ApiOperation({ summary: '查詢銀行對帳報表' })
  @ApiResponse({ status: 200, description: '成功取得對帳報表' })
  async getReconciliationReport(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.bankingService.getReconciliationReport(
      user,
      id,
      asOfDate ? new Date(asOfDate) : new Date(),
    );
  }

  @Post('virtual-accounts')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '建立虛擬帳號' })
  @ApiResponse({ status: 201, description: '成功建立虛擬帳號' })
  async createVirtualAccount(@CurrentUser() user: any, @Body() data: any) {
    return this.bankingService.createVirtualAccount(user, data);
  }

  @Post('virtual-accounts/match')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '依虛擬帳號自動配對收款' })
  @ApiResponse({ status: 200, description: '成功執行虛擬帳號配對' })
  async matchVirtualAccount(@CurrentUser() user: any, @Body() data: any) {
    return this.bankingService.matchVirtualAccountPayment(
      data.virtualAccountNumber,
      Number(data.amount),
      user,
    );
  }
}
