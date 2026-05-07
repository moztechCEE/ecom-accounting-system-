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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PayrollService } from './payroll.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PayPayrollRunDto } from './dto/pay-payroll-run.dto';
import { PayrollRunPrecheckDto } from './dto/payroll-run-precheck.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { UpsertPayrollPolicyDto } from './dto/upsert-payroll-policy.dto';
import { CreateEmployeeLoginAccountDto } from './dto/create-employee-login-account.dto';
import type { Response } from 'express';
import * as multer from 'multer';

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
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'read' })
  @ApiOperation({ summary: '查詢部門列表' })
  @ApiResponse({ status: 200, description: '成功取得部門列表' })
  async getDepartments(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getDepartments(req.user.id, entityId);
  }

  @Post('departments')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'update' })
  @ApiOperation({ summary: '建立部門' })
  @ApiResponse({ status: 201, description: '成功建立部門' })
  async createDepartment(@Request() req: any, @Body() data: any) {
    return this.payrollService.createDepartment(req.user.id, data);
  }

  @Patch('departments/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'update' })
  @ApiOperation({ summary: '更新部門' })
  @ApiResponse({ status: 200, description: '成功更新部門' })
  async updateDepartment(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.payrollService.updateDepartment(id, req.user.id, dto);
  }

  @Get('bank-accounts')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'read' })
  @ApiOperation({ summary: '查詢可用發薪帳戶' })
  @ApiResponse({ status: 200, description: '成功取得銀行帳戶列表' })
  async getBankAccounts(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getBankAccounts(req.user.id, entityId);
  }

  @Get('settings')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'read' })
  @ApiOperation({ summary: '查詢薪資規則設定' })
  @ApiResponse({ status: 200, description: '成功取得薪資規則設定' })
  async getPayrollSettings(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getPayrollSettings(req.user.id, entityId);
  }

  @Patch('settings')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'update' })
  @ApiOperation({ summary: '更新薪資規則設定' })
  @ApiResponse({ status: 200, description: '成功更新薪資規則設定' })
  async upsertPayrollSettings(
    @Request() req: any,
    @Body() dto: UpsertPayrollPolicyDto,
  ) {
    return this.payrollService.upsertPayrollSettings(req.user.id, dto);
  }

  @Get('employees')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'read' })
  @ApiOperation({ summary: '查詢員工列表' })
  @ApiResponse({ status: 200, description: '成功取得員工列表' })
  async getEmployees(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getEmployees(req.user.id, entityId);
  }

  @Get('employees/next-no')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'read' })
  @ApiOperation({ summary: '取得下一個員工編號' })
  @ApiResponse({ status: 200, description: '成功取得下一個員工編號' })
  async getNextEmployeeNo() {
    return this.payrollService.getNextEmployeeNo();
  }

  @Get('employees/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'read' })
  @ApiOperation({ summary: '查詢單一員工' })
  @ApiResponse({ status: 200, description: '成功取得員工詳情' })
  async getEmployee(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.getEmployeeById(req.user.id, id);
  }

  @Post('employees')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'update' })
  @ApiOperation({ summary: '建立員工資料' })
  @ApiResponse({ status: 201, description: '成功建立員工' })
  async createEmployee(@Request() req: any, @Body() data: any) {
    return this.payrollService.createEmployee(req.user.id, data);
  }

  @Patch('employees/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'update' })
  @ApiOperation({ summary: '更新員工資料' })
  @ApiResponse({ status: 200, description: '成功更新員工' })
  async updateEmployee(
    @Request() req: any,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.payrollService.updateEmployee(id, req.user.id, data);
  }

  @Post('employees/:id/login-account')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'update' })
  @ApiOperation({ summary: '為員工產生登入憑證' })
  @ApiResponse({ status: 201, description: '成功產生登入憑證' })
  async createEmployeeLoginAccount(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateEmployeeLoginAccountDto,
  ) {
    return this.payrollService.createEmployeeLoginAccount(id, req.user.id, dto);
  }

  @Post('employees/:id/onboarding-documents/:docType/upload')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'update' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  @ApiOperation({ summary: '上傳員工入職文件' })
  @ApiResponse({ status: 201, description: '成功上傳員工入職文件' })
  async uploadEmployeeOnboardingDocument(
    @Request() req: any,
    @Param('id') id: string,
    @Param('docType') docType: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.payrollService.uploadEmployeeOnboardingDocument(
      req.user.id,
      id,
      docType,
      file,
    );
  }

  @Patch('employees/:id/onboarding-documents/:docType/status')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'update' })
  @ApiOperation({ summary: '更新員工入職文件狀態' })
  @ApiResponse({ status: 200, description: '成功更新員工入職文件狀態' })
  async updateEmployeeOnboardingDocumentStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Param('docType') docType: string,
    @Body()
    body: {
      status: 'PENDING' | 'UPLOADED' | 'VERIFIED';
      clearFile?: boolean;
    },
  ) {
    return this.payrollService.updateEmployeeOnboardingDocumentStatus(
      req.user.id,
      id,
      docType,
      body,
    );
  }

  @Get('employees/:id/onboarding-documents/:docType/download')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'read' })
  @ApiOperation({ summary: '下載員工入職文件' })
  @ApiResponse({ status: 200, description: '成功下載員工入職文件' })
  async downloadEmployeeOnboardingDocument(
    @Request() req: any,
    @Param('id') id: string,
    @Param('docType') docType: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.payrollService.downloadEmployeeOnboardingDocument(
      req.user.id,
      id,
      docType,
    );
    response.setHeader('Content-Type', result.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return new StreamableFile(result.buffer);
  }

  @Get('my/employee')
  @ApiOperation({ summary: '查詢我的員工入職資料' })
  @ApiResponse({ status: 200, description: '成功取得我的員工入職資料' })
  async getMyEmployeeProfile(@Request() req: any) {
    return this.payrollService.getMyEmployeeProfile(req.user.id);
  }

  @Patch('my/employee')
  @ApiOperation({ summary: '更新我的員工入職資料' })
  @ApiResponse({ status: 200, description: '成功更新我的員工入職資料' })
  async updateMyEmployeeProfile(
    @Request() req: any,
    @Body()
    body: {
      nationalId?: string | null;
      mailingAddress?: string | null;
    },
  ) {
    return this.payrollService.updateMyEmployeeProfile(req.user.id, body);
  }

  @Post('my/onboarding-documents/:docType/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  @ApiOperation({ summary: '上傳我的入職文件' })
  @ApiResponse({ status: 201, description: '成功上傳我的入職文件' })
  async uploadMyOnboardingDocument(
    @Request() req: any,
    @Param('docType') docType: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.payrollService.uploadMyOnboardingDocument(
      req.user.id,
      docType,
      file,
    );
  }

  @Get('my/onboarding-documents/:docType/download')
  @ApiOperation({ summary: '下載我的入職文件' })
  @ApiResponse({ status: 200, description: '成功下載我的入職文件' })
  async downloadMyOnboardingDocument(
    @Request() req: any,
    @Param('docType') docType: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.payrollService.downloadMyOnboardingDocument(
      req.user.id,
      docType,
    );
    response.setHeader('Content-Type', result.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return new StreamableFile(result.buffer);
  }

  @Get('onboarding-review-queue')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'employees_admin', action: 'read' })
  @ApiOperation({ summary: '查詢員工入職文件待核實清單' })
  @ApiResponse({ status: 200, description: '成功取得員工入職文件待核實清單' })
  async getOnboardingReviewQueue(@Request() req: any) {
    return this.payrollService.getOnboardingReviewQueue(req.user.id);
  }

  @Get('runs')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'read' })
  @ApiOperation({ summary: '查詢薪資計算批次' })
  @ApiResponse({ status: 200, description: '成功取得薪資計算批次' })
  async getPayrollRuns(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.payrollService.getPayrollRuns(req.user.id, entityId);
  }

  @Get('runs/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'read' })
  @ApiOperation({ summary: '查詢單一薪資批次' })
  @ApiResponse({ status: 200, description: '成功取得薪資批次詳情' })
  async getPayrollRun(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.getPayrollRunById(req.user.id, id);
  }

  @Get('runs/:id/audit-logs')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'read' })
  @ApiOperation({ summary: '查詢薪資批次操作紀錄' })
  @ApiResponse({ status: 200, description: '成功取得薪資批次操作紀錄' })
  async getPayrollRunAuditLogs(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.getPayrollRunAuditLogs(req.user.id, id);
  }

  @Get('runs/:id/pdf')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'read' })
  @ApiOperation({ summary: '下載指定員工薪資單 PDF' })
  @ApiResponse({ status: 200, description: '成功下載薪資單 PDF' })
  async downloadPayrollRunPdf(
    @Request() req: any,
    @Param('id') id: string,
    @Query('employeeId') employeeId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.payrollService.getPayrollRunPdf(
      req.user.id,
      id,
      employeeId,
    );
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
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'update' })
  @ApiOperation({ summary: '建立薪資計算批次' })
  @ApiResponse({ status: 201, description: '成功建立薪資計算批次' })
  async createPayrollRun(@Request() req: any, @Body() data: any) {
    return this.payrollService.createPayrollRun(data, req.user.id);
  }

  @Post('runs/precheck')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'update' })
  @ApiOperation({ summary: '薪資結算前檢查出勤與請假異常' })
  @ApiResponse({ status: 200, description: '成功取得薪資前檢查結果' })
  async previewPayrollRunWarnings(
    @Request() req: any,
    @Body() dto: PayrollRunPrecheckDto,
  ) {
    return this.payrollService.previewPayrollRunWarnings(dto, req.user.id);
  }

  @Post('runs/:id/submit')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'update' })
  @ApiOperation({ summary: '送審薪資批次' })
  @ApiResponse({ status: 200, description: '成功送審薪資批次' })
  async submitPayrollRun(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.submitPayrollRun(id, req.user.id);
  }

  @Post('runs/:id/approve')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'update' })
  @ApiOperation({ summary: '批准並封存薪資批次' })
  @ApiResponse({ status: 200, description: '成功批准薪資批次' })
  async approvePayrollRun(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.approvePayrollRun(id, req.user.id);
  }

  @Post('runs/:id/post')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'update' })
  @ApiOperation({ summary: '過帳薪資批次至會計' })
  @ApiResponse({ status: 200, description: '成功過帳薪資批次' })
  async postPayrollRun(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.postPayrollRun(id, req.user.id);
  }

  @Post('runs/:id/pay')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'update' })
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
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'read' })
  @ApiOperation({ summary: '查詢薪資記錄列表' })
  @ApiResponse({ status: 200, description: '成功取得薪資記錄' })
  async getPayrolls(
    @Request() req: any,
    @Query('entityId') entityId?: string,
    @Query('year') year?: number,
    @Query('month') month?: number,
  ) {
    return this.payrollService.getLegacyPayrolls(
      req.user.id,
      entityId,
      year,
      month,
    );
  }

  @Get('payrolls/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'read' })
  @ApiOperation({ summary: '查詢單一薪資記錄' })
  @ApiResponse({ status: 200, description: '成功取得薪資記錄詳情' })
  async getPayroll(@Request() req: any, @Param('id') id: string) {
    return this.payrollService.getPayrollRunById(req.user.id, id);
  }

  @Post('payrolls')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'update' })
  @ApiOperation({ summary: '建立薪資記錄' })
  @ApiResponse({ status: 201, description: '成功建立薪資記錄' })
  async createPayroll(@Request() req: any, @Body() data: any) {
    return this.payrollService.createPayrollRun(data, req.user.id);
  }

  @Post('payrolls/:id/process')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'payroll_admin', action: 'update' })
  @ApiOperation({ summary: '處理薪資發放' })
  @ApiResponse({ status: 200, description: '成功處理薪資發放' })
  async processPayroll(
    @Request() req: any,
    @Param('id') id: string,
    @Body() data?: Partial<PayPayrollRunDto>,
  ) {
    return this.payrollService.processLegacyPayroll(id, req.user.id, data);
  }
}
