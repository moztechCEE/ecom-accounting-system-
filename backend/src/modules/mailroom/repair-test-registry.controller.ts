import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RepairTestRegistryService } from './repair-test-registry.service';
import {
  CreateRepairStandardDto,
  NewRepairStandardRevisionDto,
  RecordRepairCalibrationDto,
  RepairItemStandardQueryDto,
  RepairRegistryQueryDto,
  RepairRegistryRequestDto,
  ReviewRepairStandardDto,
  UpdateRepairStandardDraftDto,
  RepairRegistryProductsQueryDto,
} from './repair-test-registry.dto';
type StaffRequest = { user: { id: string } };
@Controller('repair-workbench/test-registry')
export class RepairTestRegistryController {
  constructor(private readonly service: RepairTestRegistryService) {}
  @Get() list(
    @Req() req: StaffRequest,
    @Query() query: RepairRegistryQueryDto,
  ) {
    return this.service.list(req.user.id, query);
  }
  @Get('products') products(
    @Req() req: StaffRequest,
    @Query() query: RepairRegistryProductsQueryDto,
  ) {
    return this.service.products(req.user.id, query);
  }
  @Get('items/:id') item(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Query() query: RepairItemStandardQueryDto,
  ) {
    return this.service.itemStandard(
      req.user.id,
      query.entityId,
      id,
      query.kind,
    );
  }
  @Post('standards') create(
    @Req() req: StaffRequest,
    @Body() input: CreateRepairStandardDto,
  ) {
    return this.service.createDraft(req.user.id, input);
  }
  @Post('standards/:id/draft') draft(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() input: UpdateRepairStandardDraftDto,
  ) {
    return this.service.updateDraft(req.user.id, id, input);
  }
  @Post('standards/:id/revisions') revision(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() input: NewRepairStandardRevisionDto,
  ) {
    return this.service.newRevision(req.user.id, id, input);
  }
  @Post('standards/:id/review') review(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() input: ReviewRepairStandardDto,
  ) {
    return this.service.review(req.user.id, id, input);
  }
  @Post('standards/:id/retire') retire(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() input: ReviewRepairStandardDto,
  ) {
    return this.service.retire(req.user.id, id, input);
  }
  @Post('calibrations') calibration(
    @Req() req: StaffRequest,
    @Body() input: RecordRepairCalibrationDto,
  ) {
    return this.service.recordCalibration(req.user.id, input);
  }
  @Post('calibrations/:id/revoke') revoke(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() input: RepairRegistryRequestDto,
  ) {
    return this.service.revokeCalibration(req.user.id, id, input);
  }
}
