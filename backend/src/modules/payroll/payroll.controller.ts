import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Query,
  Request,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PayrollService } from './payroll.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PayPayrollRunDto } from './dto/pay-payroll-run.dto';
import { UpsertPayrollPolicyDto } from './dto/upsert-payroll-policy.dto';
import type { Response } from 'express';

/**
 * 薪資控制器
 * 管理員工薪資、薪資計算、薪資發放
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get('departments')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢部門列表' })
  @ApiResponse({ status: 200, description: '成功取得部門列表' })
  async getDepartments(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getDepartments(req.user.id, entityId);
  }

  @Post('departments')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '建立部門' })
  @ApiResponse({ status: 201, description: '成功建立部門' })
  async createDepartment(@Request() req: any, @Body() data: any) {
    return this.payrollService.createDepartment(req.user.id, data);
  }

  @Get('bank-accounts')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢可用發薪帳戶' })
  @ApiResponse({ status: 200, description: '成功取得銀行帳戶列表' })
  async getBankAccounts(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getBankAccounts(req.user.id, entityId);
  }

  @Get('settings')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢薪資規則設定' })
  @ApiResponse({ status: 200, description: '成功取得薪資規則設定' })
  async getPayrollSettings(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getPayrollSettings(req.user.id, entityId);
  }

  @Patch('settings')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '更新薪資規則設定' })
  @ApiResponse({ status: 200, description: '成功更新薪資規則設定' })
  async upsertPayrollSettings(
    @Request() req: any,
    @Body() dto: UpsertPayrollPolicyDto,
  ) {
    return this.payrollService.upsertPayrollSettings(req.user.id, dto);
  }

  @Get('employees')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢員工列表' })
  @ApiResponse({ status: 200, description: '成功取得員工列表' })
  async getEmployees(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getEmployees(req.user.id, entityId);
  }

  @Get('employees/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢單一員工' })
  @ApiResponse({ status: 200, description: '成功取得員工詳情' })
  async getEmployee(@Param('id') id: string) {
    return this.payrollService.getEmployeeById(id);
  }

  @Post('employees')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '建立員工資料' })
  @ApiResponse({ status: 201, description: '成功建立員工' })
  async createEmployee(@Request() req: any, @Body() data: any) {
    return this.payrollService.createEmployee(req.user.id, data);
  }

  @Patch('employees/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '更新員工資料' })
  @ApiResponse({ status: 200, description: '成功更新員工' })
  async updateEmployee(
    @Request() req: any,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.payrollService.updateEmployee(id, req.user.id, data);
  }

  @Get('runs')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢薪資計算批次' })
  @ApiResponse({ status: 200, description: '成功取得薪資計算批次' })
  async getPayrollRuns(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getPayrollRuns(req.user.id, entityId);
  }

  @Get('runs/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢單一薪資批次' })
  @ApiResponse({ status: 200, description: '成功取得薪資批次詳情' })
  async getPayrollRun(@Param('id') id: string) {
    return this.payrollService.getPayrollRunById(id);
  }

  @Get('runs/:id/audit-logs')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢薪資批次操作紀錄' })
  @ApiResponse({ status: 200, description: '成功取得薪資批次操作紀錄' })
  async getPayrollRunAuditLogs(@Param('id') id: string) {
    return this.payrollService.getPayrollRunAuditLogs(id);
  }

  @Get('runs/:id/pdf')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '下載指定員工薪資單 PDF' })
  @ApiResponse({ status: 200, description: '成功下載薪資單 PDF' })
  async downloadPayrollRunPdf(
    @Param('id') id: string,
    @Query('employeeId') employeeId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.payrollService.getPayrollRunPdf(id, employeeId);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return new StreamableFile(result.buffer);
  }

  @Get('my/runs')
  @ApiOperation({ summary: '查詢我的薪資單列表' })
  @ApiResponse({ status: 200, description: '成功取得個人薪資單列表' })
  async getMyPayrollRuns(@Request() req: any) {
    return this.payrollService.getMyPayrollRuns(req.user.id);
  }

  @Get('my/runs/:id')
  @ApiOperation({ summary: '查詢我的單張薪資單' })
  @ApiResponse({ status: 200, description: '成功取得個人薪資單明細' })
  async getMyPayrollRun(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.getMyPayrollRunById(req.user.id, id);
  }

  @Get('my/runs/:id/pdf')
  @ApiOperation({ summary: '下載我的薪資單 PDF' })
  @ApiResponse({ status: 200, description: '成功下載個人薪資單 PDF' })
  async downloadMyPayrollRunPdf(
    @Request() req: any,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.payrollService.getMyPayrollRunPdf(
      req.user.id,
      id,
    );
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return new StreamableFile(result.buffer);
  }

  @Post('runs')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '建立薪資計算批次' })
  @ApiResponse({ status: 201, description: '成功建立薪資計算批次' })
  async createPayrollRun(@Request() req: any, @Body() data: any) {
    return this.payrollService.createPayrollRun(data, req.user.id);
  }

  @Post('runs/:id/submit')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '送審薪資批次' })
  @ApiResponse({ status: 200, description: '成功送審薪資批次' })
  async submitPayrollRun(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.submitPayrollRun(id, req.user.id);
  }

  @Post('runs/:id/approve')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '批准並封存薪資批次' })
  @ApiResponse({ status: 200, description: '成功批准薪資批次' })
  async approvePayrollRun(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.approvePayrollRun(id, req.user.id);
  }

  @Post('runs/:id/post')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '過帳薪資批次至會計' })
  @ApiResponse({ status: 200, description: '成功過帳薪資批次' })
  async postPayrollRun(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.postPayrollRun(id, req.user.id);
  }

  @Post('runs/:id/pay')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '標記薪資批次已發薪' })
  @ApiResponse({ status: 200, description: '成功完成薪資發放' })
  async payPayrollRun(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: PayPayrollRunDto,
  ) {
    return this.payrollService.payPayrollRun(id, req.user.id, dto);
  }

  @Get('payrolls')
  @ApiOperation({ summary: '查詢薪資記錄列表' })
  @ApiResponse({ status: 200, description: '成功取得薪資記錄' })
  async getPayrolls(
    @Query('entityId') entityId?: string,
    @Query('year') year?: number,
    @Query('month') month?: number,
  ) {
    // This might be for individual payslips, keeping it for now but implementing basic return
    return [];
  }

  @Get('payrolls/:id')
  @ApiOperation({ summary: '查詢單一薪資記錄' })
  @ApiResponse({ status: 200, description: '成功取得薪資記錄詳情' })
  async getPayroll(@Param('id') id: string) {
    throw new Error('Not implemented');
  }

  @Post('payrolls')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '建立薪資記錄' })
  @ApiResponse({ status: 201, description: '成功建立薪資記錄' })
  async createPayroll(@Request() req: any, @Body() data: any) {
    return this.payrollService.createPayrollRun(data, req.user.id);
  }

  @Post('payrolls/:id/process')
  @ApiOperation({ summary: '處理薪資發放' })
  @ApiResponse({ status: 200, description: '成功處理薪資發放' })
  async processPayroll(@Param('id') id: string) {
    throw new Error('Not implemented');
  }
}
