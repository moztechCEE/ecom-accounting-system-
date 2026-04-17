import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AccountingService } from './accounting.service';
import { ReportService } from './services/report.service';
import { JournalService } from './services/journal.service';

/**
 * AccountingController
 * 會計控制器，提供會計科目與報表查詢的 API
 */
@ApiTags('Accounting')
@ApiBearerAuth()
@Controller('accounting')
@UseGuards(JwtAuthGuard)
export class AccountingController {
  constructor(
    private readonly accountingService: AccountingService,
    private readonly reportService: ReportService,
    private readonly journalService: JournalService,
  ) {}

  private ensureEntityId(entityId?: string) {
    const trimmed = entityId?.trim();
    if (!trimmed) {
      throw new BadRequestException('entityId is required');
    }
    return trimmed;
  }

  /**
   * 取得會計科目表
   */
  @Get('accounts')
  @ApiOperation({ summary: '查詢會計科目表' })
  @ApiQuery({ name: 'entityId', required: true, description: '公司實體 ID' })
  @ApiQuery({
    name: 'type',
    required: false,
    description: '科目類型 (asset/liability/equity/revenue/expense)',
  })
  async getAccounts(
    @Query('entityId') entityId: string,
    @Query('type') type?: string,
  ) {
    const safeEntityId = this.ensureEntityId(entityId);
    return this.accountingService.getAccountsByEntity(safeEntityId, type);
  }

  /**
   * 取得會計期間
   */
  @Get('periods')
  @ApiOperation({ summary: '查詢會計期間' })
  @ApiQuery({ name: 'entityId', required: true, description: '公司實體 ID' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: '期間狀態 (open/closed/locked)',
  })
  async getPeriods(
    @Query('entityId') entityId: string,
    @Query('status') status?: string,
  ) {
    const safeEntityId = this.ensureEntityId(entityId);
    return this.accountingService.getPeriods(safeEntityId, status);
  }

  @Get('journals')
  @ApiOperation({ summary: '查詢會計分錄' })
  @ApiQuery({ name: 'entityId', required: true, description: '公司實體 ID' })
  @ApiQuery({ name: 'periodId', required: false, description: '會計期間 ID' })
  async getJournalEntries(
    @Query('entityId') entityId: string,
    @Query('periodId') periodId?: string,
  ) {
    const safeEntityId = this.ensureEntityId(entityId);
    return this.journalService.getJournalEntriesByPeriod(safeEntityId, periodId);
  }

  /**
   * 產生損益表
   */
  @Get('reports/income-statement')
  @ApiOperation({ summary: '產生損益表' })
  @ApiQuery({ name: 'entityId', required: true, description: '公司實體 ID' })
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
    const safeEntityId = this.ensureEntityId(entityId);
    return this.reportService.getIncomeStatement(
      safeEntityId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  /**
   * 產生資產負債表
   */
  @Get('reports/balance-sheet')
  @ApiOperation({ summary: '產生資產負債表' })
  @ApiQuery({ name: 'entityId', required: true, description: '公司實體 ID' })
  @ApiQuery({
    name: 'asOfDate',
    required: true,
    description: '截止日期 (YYYY-MM-DD)',
  })
  async getBalanceSheet(
    @Query('entityId') entityId: string,
    @Query('asOfDate') asOfDate: string,
  ) {
    const safeEntityId = this.ensureEntityId(entityId);
    return this.reportService.getBalanceSheet(safeEntityId, new Date(asOfDate));
  }
}
