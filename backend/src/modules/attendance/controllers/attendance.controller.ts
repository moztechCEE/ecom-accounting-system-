import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Request,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { AttendanceService } from '../services/attendance.service';
import { ClockInDto } from '../dto/clock-in.dto';
import { ClockOutDto } from '../dto/clock-out.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PolicyService } from '../services/policy.service';
import { UpsertAttendancePolicyDto } from '../dto/upsert-attendance-policy.dto';
import { DisasterClosureService } from '../services/disaster-closure.service';
import { UpsertDisasterClosureDto } from '../dto/upsert-disaster-closure.dto';
import { OvertimeService } from '../services/overtime.service';
import { CreateOvertimeRequestDto } from '../dto/create-overtime-request.dto';
import { ReviewOvertimeRequestDto } from '../dto/review-overtime-request.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly policyService: PolicyService,
    private readonly disasterClosureService: DisasterClosureService,
    private readonly overtimeService: OvertimeService,
  ) {}

  @Post('clock-in')
  async clockIn(@Request() req: any, @Body() dto: ClockInDto) {
    return this.attendanceService.clockIn(req.user.id, dto);
  }

  @Post('clock-out')
  async clockOut(@Request() req: any, @Body() dto: ClockOutDto) {
    return this.attendanceService.clockOut(req.user.id, dto);
  }

  @Get('overtime-requests')
  async getMyOvertimeRequests(@Request() req: any) {
    return this.overtimeService.getMyRequests(req.user.id);
  }

  @Post('overtime-requests')
  async createOvertimeRequest(
    @Request() req: any,
    @Body() dto: CreateOvertimeRequestDto,
  ) {
    return this.overtimeService.createRequest(req.user.id, dto);
  }

  @Get('admin/daily-summary')
  async getDailySummary(@Query('date') dateString: string) {
    const date = dateString ? new Date(dateString) : new Date();
    return this.attendanceService.getDailySummaries(date);
  }

  @Get('admin/policies')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  async getAdminPolicies(
    @Request() req: any,
    @Query('entityId') entityId?: string,
  ) {
    return this.policyService.getAdminPolicies(req.user.id, entityId);
  }

  @Post('admin/policies')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  async createAdminPolicy(
    @Request() req: any,
    @Body() dto: UpsertAttendancePolicyDto,
  ) {
    return this.policyService.createPolicy(req.user.id, dto);
  }

  @Patch('admin/policies/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  async updateAdminPolicy(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpsertAttendancePolicyDto,
  ) {
    return this.policyService.updatePolicy(req.user.id, id, dto);
  }

  @Delete('admin/policies/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  async deleteAdminPolicy(@Request() req: any, @Param('id') id: string) {
    return this.policyService.deletePolicy(req.user.id, id);
  }

  @Get('admin/disaster-closures')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  async getDisasterClosures(
    @Request() req: any,
    @Query('year') year?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.disasterClosureService.getAdminClosures(req.user.id, {
      year: year ? Number(year) : undefined,
      entityId,
    });
  }

  @Post('admin/disaster-closures')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  async createDisasterClosure(
    @Request() req: any,
    @Body() dto: UpsertDisasterClosureDto,
  ) {
    return this.disasterClosureService.createClosure(req.user.id, dto);
  }

  @Patch('admin/disaster-closures/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  async updateDisasterClosure(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpsertDisasterClosureDto,
  ) {
    return this.disasterClosureService.updateClosure(req.user.id, id, dto);
  }

  @Delete('admin/disaster-closures/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseGuards(RolesGuard)
  async deleteDisasterClosure(@Request() req: any, @Param('id') id: string) {
    return this.disasterClosureService.deactivateClosure(req.user.id, id);
  }

  @Get('admin/overtime-requests')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  async getAdminOvertimeRequests(
    @Query('status') status?: string,
    @Query('employeeId') employeeId?: string,
    @Query('year') year?: string,
  ) {
    return this.overtimeService.getAdminRequests({
      status,
      employeeId,
      year: year ? Number(year) : undefined,
    });
  }

  @Patch('admin/overtime-requests/:id/review')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  async reviewOvertimeRequest(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewOvertimeRequestDto,
  ) {
    return this.overtimeService.reviewRequest(req.user.id, id, dto);
  }
}
