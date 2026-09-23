import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { EntityAccessGuard } from '../../common/guards/entity-access.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireEntityAccess } from '../../common/decorators/entity-access.decorator';
import { B2bAccountUpdateDto, B2bEntityDto, B2bSupplierAccountDto } from './b2b.dto';
import { B2bService } from './b2b.service';
import { B2bSupplierAdminService } from './b2b-supplier-admin.service';

type StaffRequest = { user: { id: string } };

@Controller('b2b/purchasing/supplier-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard, EntityAccessGuard)
@RequireEntityAccess('purchasing')
@RequirePermissions({ resource: 'purchase_orders', action: 'read' })
export class B2bSupplierAdminController {
  constructor(
    private readonly supplierAdmin: B2bSupplierAdminService,
    private readonly b2b: B2bService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: B2bEntityDto) {
    return this.supplierAdmin.list(query.entityId);
  }

  @Post()
  @RequirePermissions({ resource: 'purchase_orders', action: 'create' })
  @Header('Cache-Control', 'no-store')
  create(@Body() dto: B2bSupplierAccountDto, @Req() req: StaffRequest) {
    return this.b2b.createSupplierAccount(dto, req.user.id);
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'purchase_orders', action: 'create' })
  @Header('Cache-Control', 'no-store')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: B2bAccountUpdateDto,
  ) {
    return this.b2b.updateAccount(id, dto, 'SUPPLIER');
  }
}
