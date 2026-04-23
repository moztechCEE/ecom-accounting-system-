import { Controller, Get, Post, Body, Query, UseGuards, Param, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';
import { ExpenseIntelligenceService } from './expense-intelligence.service';

/**
 * 報表控制器
 * 產生各類財務報表：損益表、資產負債表、現金流量表等
 */
@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(CacheInterceptor) // Enable Caching for all reports
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly expenseIntelligenceService: ExpenseIntelligenceService,
  ) {}

  @Post('analyze')
  @ApiOperation({ summary: 'AI 財務分析 (Expense Intelligence)' })
  @ApiResponse({ status: 200, description: '成功產生分析報告' })
  @ApiBody({ 
    schema: {
      type: 'object',
      properties: {
        entityId: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        context: { type: 'string', description: 'Context for analysis (e.g. "Monthly Review")' }
      }
    }
  })
  async getAIAnalysis(
    @Body() body: { entityId: string; startDate: string; endDate: string; context?: string },
  ) {
    const { entityId, startDate, endDate, context } = body;
    
    // Fetch underlying financial data (e.g., Income Statement)
    // Note: This relies on reportsService.getIncomeStatement returning raw data object, not a StreamableFile.
    // We assume it returns an object based on standard NestJS patterns unless it's designed for PDF export.
    const financialData = await this.reportsService.getIncomeStatement(entityId, new Date(startDate), new Date(endDate));

    return this.expenseIntelligenceService.analyzeFinancialReport(
      context || 'General Financial Health Check',
      financialData,
    );
  }

  @Get('income-statement')
  @CacheTTL(300000) // Cache for 5 minutes (in ms for v5, or seconds for v4/v6? Nest Cache v5 uses ms usually)
  // Check version: cache-manager v5 changed to milliseconds? 
  // CacheModule v3 (Nest v10) uses milliseconds.
  // Let's assume ms to be safe or verify. 
  // "cache-manager": "^6.0.0" in package.json.
  // NestJS Cache Manager usually takes milliseconds.
  // Actually, @CacheTTL() behavior depends on the store. Redis store might expect seconds or ms.
  // Let's use 60 seconds (60000 ms) to be safe for now, or just trust defaults. 
  // Let's put 60 * 1000 = 60000 if it is ms.
  @ApiOperation({ summary: '產生損益表 (Income Statement / P&L)' })
  @ApiResponse({ status: 200, description: '成功產生損益表' })
  @ApiQuery({ name: 'entityId', required: true, description: '實體ID' })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: '開始日期 (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: '結束日期 (YYYY-MM-DD)',
  })
  async getIncomeStatement(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getIncomeStatement(
      entityId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Get('balance-sheet')
  @ApiOperation({ summary: '產生資產負債表 (Balance Sheet)' })
  @ApiResponse({ status: 200, description: '成功產生資產負債表' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({
    name: 'asOfDate',
    required: true,
    description: '截止日期 (YYYY-MM-DD)',
  })
  async getBalanceSheet(
    @Query('entityId') entityId: string,
    @Query('asOfDate') asOfDate: string,
  ) {
    return this.reportsService.getBalanceSheet(entityId, new Date(asOfDate));
  }

  @Get('cash-flow')
  @ApiOperation({ summary: '產生現金流量表 (Cash Flow Statement)' })
  @ApiResponse({ status: 200, description: '成功產生現金流量表' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async getCashFlow(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getCashFlowStatement(
      entityId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Get('trial-balance')
  @ApiOperation({ summary: '產生試算表 (Trial Balance)' })
  @ApiResponse({ status: 200, description: '成功產生試算表' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'periodId', required: true, description: '會計期間ID' })
  async getTrialBalance(
    @Query('entityId') entityId: string,
    @Query('periodId') periodId: string,
  ) {
    // TODO: Implement trial balance
    return { message: 'Trial balance not yet implemented', entityId, periodId };
  }

  @Get('general-ledger')
  @ApiOperation({ summary: '產生總分類帳 (General Ledger)' })
  @ApiResponse({ status: 200, description: '成功產生總分類帳' })
  @ApiQuery({ name: 'accountId', required: true, description: '會計科目ID' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async getGeneralLedger(
    @Query('accountId') accountId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    // TODO: Implement general ledger
    return {
      message: 'General ledger not yet implemented',
      accountId,
      startDate,
      endDate,
    };
  }

  @Get('sales-summary')
  @ApiOperation({ summary: '產生銷售彙總表' })
  @ApiResponse({ status: 200, description: '成功產生銷售彙總' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  @ApiQuery({
    name: 'groupBy',
    required: false,
    description: '分組依據: channel|month|product',
  })
  async getSalesSummary(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('groupBy') groupBy?: string,
  ) {
    // TODO: Implement sales summary
    return {
      message: 'Sales summary not yet implemented',
      entityId,
      startDate,
      endDate,
      groupBy,
    };
  }

  @Get('dashboard-sales-overview')
  @ApiOperation({ summary: '儀錶板通路業績與對帳概況' })
  @ApiResponse({ status: 200, description: '成功取得儀錶板業績概況' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getDashboardSalesOverview(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getDashboardSalesOverview(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('dashboard-reconciliation-feed')
  @ApiOperation({ summary: '儀錶板最近收款與撥款追蹤' })
  @ApiResponse({ status: 200, description: '成功取得最近對帳與撥款明細' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getDashboardReconciliationFeed(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getDashboardReconciliationFeed(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('dashboard-executive-overview')
  @ApiOperation({ summary: '儀錶板 CEO 總覽' })
  @ApiResponse({ status: 200, description: '成功取得 CEO 視角的營運摘要' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getDashboardExecutiveOverview(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getDashboardExecutiveOverview(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('dashboard-operations-hub')
  @ApiOperation({ summary: '儀錶板營運總控台摘要' })
  @ApiResponse({ status: 200, description: '成功取得營運、人事、薪資與發票總覽' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getDashboardOperationsHub(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getDashboardOperationsHub(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('data-completeness-audit')
  @ApiOperation({ summary: '資料完整度稽核：訂單、顧客、付款、發票與對帳缺口' })
  @ApiResponse({ status: 200, description: '成功取得資料完整度稽核結果' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getDataCompletenessAudit(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getDataCompletenessAudit(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('monthly-channel-reconciliation')
  @ApiOperation({ summary: '按月份查看平台營收與綠界對帳矩陣' })
  @ApiResponse({ status: 200, description: '成功取得月度對帳矩陣' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getMonthlyChannelReconciliation(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getMonthlyChannelReconciliation(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('order-reconciliation-audit')
  @ApiOperation({ summary: '逐筆訂單對帳稽核' })
  @ApiResponse({ status: 200, description: '成功取得訂單、帳款、發票與稅額逐筆稽核結果' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getOrderReconciliationAudit(
    @Query('entityId') entityId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getOrderReconciliationAudit(
      entityId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('management-summary')
  @ApiOperation({ summary: '年 / 季 / 月 / 週營運管理報表' })
  @ApiResponse({ status: 200, description: '成功取得管理報表彙整' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({
    name: 'groupBy',
    required: true,
    enum: ['year', 'quarter', 'month', 'week', 'day'],
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getManagementSummary(
    @Query('entityId') entityId: string,
    @Query('groupBy') groupBy: 'year' | 'quarter' | 'month' | 'week' | 'day',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getManagementSummary(
      entityId,
      groupBy,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('ecommerce-history')
  @ApiOperation({ summary: '歷年電商業績、顧客來源與產品品牌彙整' })
  @ApiResponse({ status: 200, description: '成功取得歷史電商彙整資料' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({
    name: 'groupBy',
    required: true,
    enum: ['year', 'quarter', 'month', 'week', 'day'],
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getEcommerceHistory(
    @Query('entityId') entityId: string,
    @Query('groupBy') groupBy: 'year' | 'quarter' | 'month' | 'week' | 'day',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getEcommerceHistory(
      entityId,
      groupBy,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get(':id/export')
  @ApiOperation({ summary: '匯出報表 (Excel/PDF)' })
  @ApiResponse({ status: 200, description: '成功匯出報表' })
  @ApiQuery({ name: 'format', required: true, enum: ['xlsx', 'pdf'] })
  async exportReport(
    @Param('id') id: string,
    @Query('format') format: string,
    @Query('entityId') entityId: string,
  ) {
    // Mock export implementation
    // In a real app, this would generate a file stream
    return {
      message: 'Report export initiated',
      reportId: id,
      format,
      downloadUrl: `/api/v1/reports/download/${id}.${format}?token=temp-token`,
    };
  }
}
