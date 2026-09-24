import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PerformanceService } from './performance.service';

@ApiTags('performance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('cycles')
  @RequirePermissions({ resource: 'performance_reviews', action: 'read' })
  listCycles(@Request() req: any, @Query('entityId') entityId?: string) {
    return this.performance.listCycles(req.user.id, entityId);
  }

  @Post('cycles')
  @RequirePermissions({ resource: 'performance_reviews', action: 'manage' })
  createCycle(
    @Request() req: any,
    @Body() body: { entityId: string; title: string; periodStart: string; periodEnd: string },
  ) {
    return this.performance.createCycle(req.user.id, body);
  }

  @Get('roster')
  @RequirePermissions({ resource: 'performance_reviews', action: 'read' })
  getRoster(@Request() req: any, @Query('entityId') entityId: string) {
    return this.performance.getRoster(req.user.id, entityId);
  }

  @Post('cycles/:cycleId/reviews')
  @RequirePermissions({ resource: 'performance_reviews', action: 'manage' })
  assignReview(
    @Request() req: any,
    @Param('cycleId') cycleId: string,
    @Body() body: { subjectEmployeeId: string; reviewerEmployeeId?: string },
  ) {
    return this.performance.assignReview(req.user.id, cycleId, body);
  }

  @Get('reviews')
  @RequirePermissions({ resource: 'performance_reviews', action: 'read' })
  listReviews(
    @Request() req: any,
    @Query('cycleId') cycleId?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.performance.listReviews(req.user.id, cycleId, entityId);
  }

  @Get('reviews/:id')
  @RequirePermissions({ resource: 'performance_reviews', action: 'read' })
  getReview(@Request() req: any, @Param('id') id: string) {
    return this.performance.getReview(req.user.id, id);
  }

  @Patch('reviews/:id')
  @RequirePermissions({ resource: 'performance_reviews', action: 'write' })
  updateReview(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { score?: number | null; goals?: string | null; comment?: string | null },
  ) {
    return this.performance.updateReview(req.user.id, id, body);
  }

  @Post('reviews/:id/submit')
  @RequirePermissions({ resource: 'performance_reviews', action: 'write' })
  submitReview(@Request() req: any, @Param('id') id: string) {
    return this.performance.submitReview(req.user.id, id);
  }
}
