import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, Query } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Prisma } from '@prisma/client';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { resolveCompanyRead } from '../../common/entity-access/resolve-company-read';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly entityAccessService: EntityAccessService,
  ) {}

  @Post()
  create(@Request() req, @Body() data: Prisma.CustomerCreateInput) {
    return this.customerService.create(req.user.entityId, data);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'sales_orders', action: 'read' })
  async findAll(@Request() req, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'sales', requestedEntityId);
    return this.customerService.findAll(entityId);
  }

  @Get('business-records')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'sales_orders', action: 'read' })
  async businessRecords(@Request() req, @Query('entityId') requestedEntityId?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'sales', requestedEntityId);
    return this.customerService.businessRecords(entityId, limit, offset);
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'sales_orders', action: 'read' })
  async findOne(@Request() req, @Param('id') id: string, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'sales', requestedEntityId);
    return this.customerService.findOne(entityId, id);
  }

  @Patch(':id')
  update(@Request() req, @Param('id') id: string, @Body() data: Prisma.CustomerUpdateInput) {
    return this.customerService.update(req.user.entityId, id, data);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.customerService.remove(req.user.entityId, id);
  }
}
