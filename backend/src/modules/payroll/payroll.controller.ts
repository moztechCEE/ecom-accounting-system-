import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  Request,
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
  async getDepartments(@Request() req: any, @Query('entityId') entityId?: string) {
    return this.payrollService.getDepartments(req.user.id, entityId);
  }

  @Get('employees')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢員工列表' })
  @ApiResponse({ status: 200, description: '成功取得員工列表' })
  async getEmployees(@Request() req: any, @Query('entityId') entityId?: string) {
    return this.payrollService.getEmployees(req.user.id, entityId);
  }

  @Get('employees/:id')
  @ApiOperation({ summary: '查詢單一員工' })
  @ApiResponse({ status: 200, description: '成功取得員工詳情' })
  async getEmployee(@Param('id') id: string) {
    throw new Error('Not implemented');
  }

  @Post('employees')
  @ApiOperation({ summary: '建立員工資料' })
  @ApiResponse({ status: 201, description: '成功建立員工' })
  async createEmployee(@Body() data: any) {
    throw new Error('Not implemented');
  }

  @Get('runs')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '查詢薪資計算批次' })
  @ApiResponse({ status: 200, description: '成功取得薪資計算批次' })
  async getPayrollRuns(@Request() req: any, @Query('entityId') entityId?: string) {
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
