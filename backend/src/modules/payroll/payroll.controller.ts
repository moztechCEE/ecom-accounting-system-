import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PayrollService } from './payroll.service';

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
  @ApiOperation({ summary: '查詢部門列表' })
  @ApiResponse({ status: 200, description: '成功取得部門列表' })
  async getDepartments(@Query('entityId') entityId?: string) {
    return this.payrollService.getDepartments(entityId);
  }

  @Get('employees')
  @ApiOperation({ summary: '查詢員工列表' })
  @ApiResponse({ status: 200, description: '成功取得員工列表' })
  async getEmployees(@Query('entityId') entityId?: string) {
    return this.payrollService.getEmployees(entityId);
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
  @ApiOperation({ summary: '查詢薪資計算批次' })
  @ApiResponse({ status: 200, description: '成功取得薪資計算批次' })
  async getPayrollRuns(@Query('entityId') entityId?: string) {
    return this.payrollService.getPayrollRuns(entityId);
  }

  @Post('runs')
  @ApiOperation({ summary: '建立薪資計算批次' })
  @ApiResponse({ status: 201, description: '成功建立薪資計算批次' })
  async createPayrollRun(@Body() data: any) {
    return this.payrollService.createPayrollRun(data);
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
  @ApiOperation({ summary: '建立薪資記錄' })
  @ApiResponse({ status: 201, description: '成功建立薪資記錄' })
  async createPayroll(@Body() data: any) {
    return this.payrollService.createPayrollRun(data);
  }

  @Post('payrolls/:id/process')
  @ApiOperation({ summary: '處理薪資發放' })
  @ApiResponse({ status: 200, description: '成功處理薪資發放' })
  async processPayroll(@Param('id') id: string) {
    throw new Error('Not implemented');
  }
}
