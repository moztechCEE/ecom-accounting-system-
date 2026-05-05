import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Patch,
  Param,
  Query,
} from '@nestjs/common';
import { LeaveService } from '../services/leave.service';
import { CreateLeaveRequestDto } from '../dto/create-leave-request.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { UpdateLeaveStatusDto } from '../dto/update-leave-status.dto';
import { UpsertLeaveTypeDto } from '../dto/upsert-leave-type.dto';
import { AdjustLeaveBalanceDto } from '../dto/adjust-leave-balance.dto';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';

@Controller('attendance/leaves')
@UseGuards(JwtAuthGuard)
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Get('types')
  async getLeaveTypes(@Request() req: any) {
    return this.leaveService.getLeaveTypes(req.user.id);
  }

  @Get('balances')
  async getLeaveBalances(@Request() req: any, @Query('year') year?: string) {
    return this.leaveService.getLeaveBalances(
      req.user.id,
      year ? Number(year) : undefined,
    );
  }

  @Post()
  async createLeaveRequest(
    @Request() req: any,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.leaveService.createLeaveRequest(req.user.id, dto);
  }

  @Get()
  async getLeaveRequests(@Request() req: any) {
    return this.leaveService.getLeaveRequests(req.user.id);
  }

  @Patch(':id/status')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'attendance_admin', action: 'update' })
  async updateLeaveStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateLeaveStatusDto,
  ) {
    return this.leaveService.updateLeaveStatus(
      id,
      dto.status,
      req.user.id,
      dto.note,
    );
  }

  @Get('admin/requests')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'attendance_admin', action: 'read' })
  async getAdminLeaveRequests(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('employeeId') employeeId?: string,
    @Query('leaveTypeId') leaveTypeId?: string,
    @Query('year') year?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.leaveService.getAdminLeaveRequests(req.user.id, {
      status,
      employeeId,
      leaveTypeId,
      year: year ? Number(year) : undefined,
      entityId,
    });
  }

  @Get('admin/types')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'attendance_admin', action: 'read' })
  async getAdminLeaveTypes(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.leaveService.getAdminLeaveTypes(req.user.id, entityId);
  }

  @Post('admin/types')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'attendance_admin', action: 'update' })
  async createLeaveType(@Request() req: any, @Body() dto: UpsertLeaveTypeDto) {
    return this.leaveService.createLeaveType(req.user.id, dto);
  }

  @Patch('admin/types/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'attendance_admin', action: 'update' })
  async updateLeaveType(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpsertLeaveTypeDto,
  ) {
    return this.leaveService.updateLeaveType(req.user.id, id, dto);
  }

  @Get('admin/balances')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'attendance_admin', action: 'read' })
  async getAdminLeaveBalances(
    @Request() req: any,
    @Query('year') year?: string,
    @Query('employeeId') employeeId?: string,
    @Query('leaveTypeId') leaveTypeId?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.leaveService.getAdminLeaveBalances(req.user.id, {
      year: year ? Number(year) : undefined,
      employeeId,
      leaveTypeId,
      entityId,
    });
  }

  @Patch('admin/balances/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'attendance_admin', action: 'update' })
  async adjustLeaveBalance(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AdjustLeaveBalanceDto,
  ) {
    return this.leaveService.adjustLeaveBalance(req.user.id, id, dto);
  }
}
