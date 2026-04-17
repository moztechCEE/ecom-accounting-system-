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

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly policyService: PolicyService,
  ) {}

  @Post('clock-in')
  async clockIn(@Request() req: any, @Body() dto: ClockInDto) {
    return this.attendanceService.clockIn(req.user.id, dto);
  }

  @Post('clock-out')
  async clockOut(@Request() req: any, @Body() dto: ClockOutDto) {
    return this.attendanceService.clockOut(req.user.id, dto);
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
}
