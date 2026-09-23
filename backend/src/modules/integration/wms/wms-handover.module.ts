import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Module,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { WmsHandoverAuth } from './wms-handover.auth';
import { WmsHandoverService } from './wms-handover.service';
import {
  PostShipmentLineDto,
  ReconciliationQueryDto,
  WmsHandoverDto,
} from './wms-handover.dto';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { EntityAccessGuard } from '../../../common/guards/entity-access.guard';
import { RequireEntityAccess } from '../../../common/decorators/entity-access.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';

@Controller('integration/wms')
export class WmsHandoverController {
  constructor(private readonly service: WmsHandoverService) {}
  @Post('events')
  @HttpCode(200)
  @WmsHandoverAuth()
  receive(
    @Body() body: WmsHandoverDto,
    @Req() req: { wmsHandover: { bodyHash: string } },
  ) {
    return this.service.receive(body, req.wmsHandover.bodyHash);
  }
}
@Controller('wms/reconciliation')
@UseGuards(PermissionsGuard, EntityAccessGuard)
@RequireEntityAccess('inventory')
@RequirePermissions({ resource: 'inventory', action: 'read' })
export class WmsReconciliationController {
  constructor(private readonly service: WmsHandoverService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() q: ReconciliationQueryDto) {
    return this.service.list(
      q.entityId,
      q.status,
      q.page,
      q.pageSize,
      q.occurredOn,
      q.search,
    );
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  detail(@Param('id') id: string, @Query() q: ReconciliationQueryDto) {
    return this.service.detail(q.entityId, id);
  }
  @Post('lines/:id/post')
  @HttpCode(200)
  @RequirePermissions(
    { resource: 'inventory', action: 'read' },
    { resource: 'inventory', action: 'update' },
  )
  post(
    @Param('id') id: string,
    @Body() body: PostShipmentLineDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.service.post(body.entityId, id, req.user.id, body.note);
  }
}
@Module({
  controllers: [WmsHandoverController, WmsReconciliationController],
  providers: [WmsHandoverService],
})
export class WmsHandoverModule {}
