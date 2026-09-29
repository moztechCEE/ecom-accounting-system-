import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequireEntityAccess } from '../../common/decorators/entity-access.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { EntityAccessGuard } from '../../common/guards/entity-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  B2bGuestEntityDto,
  B2bGuestListDto,
  B2bGuestMatchDto,
  B2bGuestRejectDto,
  B2bGuestSubmitDto,
} from './b2b-guest.dto';
import { B2bGuestService } from './b2b-guest.service';

@Public()
@Controller('b2b/public')
export class B2bGuestPublicController {
  constructor(private readonly service: B2bGuestService) {}

  @Post('requests')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  submit(@Body() dto: B2bGuestSubmitDto, @Req() req: { ip?: string }) {
    return this.service.submit(dto, req.ip);
  }
}

@Controller('b2b/admin/guest-requests')
@UseGuards(PermissionsGuard, EntityAccessGuard)
@RequireEntityAccess('sales')
@RequirePermissions({ resource: 'sales_orders', action: 'read' })
export class B2bGuestAdminController {
  constructor(private readonly service: B2bGuestService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: B2bGuestListDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: B2bGuestEntityDto,
  ) {
    return this.service.detail(query.entityId, id);
  }

  @Post(':id/match')
  @RequirePermissions(
    { resource: 'sales_orders', action: 'read' },
    { resource: 'sales_orders', action: 'create' },
  )
  @Header('Cache-Control', 'no-store')
  match(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: B2bGuestMatchDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.service.match(id, dto, req.user.id);
  }

  @Post(':id/reject')
  @RequirePermissions(
    { resource: 'sales_orders', action: 'read' },
    { resource: 'sales_orders', action: 'create' },
  )
  @Header('Cache-Control', 'no-store')
  reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: B2bGuestRejectDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.service.reject(id, dto, req.user.id);
  }
}
