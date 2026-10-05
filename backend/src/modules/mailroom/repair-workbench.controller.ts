import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { MailroomQuery } from './mailroom.dto';
import { SaveInspectionDto, SaveRepairDto } from './repair-document.dto';
import { RepairWorkbenchService } from './repair-workbench.service';
import {
  RepairCustomerQueueQuery,
  RepairWorkflowDto,
} from './repair-workflow.dto';
@Controller('repair-workbench')
export class RepairWorkbenchController {
  constructor(private readonly service: RepairWorkbenchService) {}
  @Get('csr-queue') customerQueue(
    @Req() req: { user: { id: string } },
    @Query() q: RepairCustomerQueueQuery,
  ) {
    return this.service.customerQueue(req.user.id, q);
  }
  @Post('items/:id/workflow') workflow(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: RepairWorkflowDto,
  ) {
    return this.service.workflow(req.user.id, id, body);
  }
  @Get('items/:id/documents') documents(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Query() q: MailroomQuery,
  ) {
    return this.service.documents(req.user.id, q.entityId, id);
  }
  @Post('items/:id/inspection') inspection(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: SaveInspectionDto,
  ) {
    return this.service.save(req.user.id, id, 'inspection', body);
  }
  @Post('items/:id/repair-report') report(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: SaveRepairDto,
  ) {
    return this.service.save(req.user.id, id, 'repair', body);
  }
}
