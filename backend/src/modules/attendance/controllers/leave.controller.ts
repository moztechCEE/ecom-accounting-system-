import { Controller, Post, Get, Body, UseGuards, Request, Patch, Param, Query } from '@nestjs/common';
import { LeaveService } from '../services/leave.service';
import { CreateLeaveRequestDto } from '../dto/create-leave-request.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UpdateLeaveStatusDto } from '../dto/update-leave-status.dto';

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
  async createLeaveRequest(@Request() req: any, @Body() dto: CreateLeaveRequestDto) {
    return this.leaveService.createLeaveRequest(req.user.id, dto);
  }

  @Get()
  async getLeaveRequests(@Request() req: any) {
    return this.leaveService.getLeaveRequests(req.user.id);
  }

  @Patch(':id/status')
  async updateLeaveStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateLeaveStatusDto,
  ) {
    return this.leaveService.updateLeaveStatus(id, dto.status, req.user.id);
  }
}
