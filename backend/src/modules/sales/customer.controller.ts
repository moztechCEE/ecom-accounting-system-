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

  // The existing sales_orders:create grant covers customer-master writes; no
  // separate update/delete grants exist in the current permission catalogue.
  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  async create(@Request() req, @Body() data: Prisma.CustomerCreateInput,
    @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'sales', requestedEntityId);
    return this.customerService.create(entityId, this.withoutCompanyOverride(data));
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'sales_orders', action: 'read' })
  async findAll(@Request() req, @Query('entityId') requestedEntityId?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string, @Query('search') search?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'sales', requestedEntityId);
    return this.customerService.findAll(entityId, { limit, offset, search });
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
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  async update(@Request() req, @Param('id') id: string, @Body() data: Prisma.CustomerUpdateInput,
    @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'sales', requestedEntityId);
    return this.customerService.update(entityId, id, this.withoutCompanyOverride(data));
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  async remove(@Request() req, @Param('id') id: string, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'sales', requestedEntityId);
    return this.customerService.remove(entityId, id);
  }

  private withoutCompanyOverride<T extends Prisma.CustomerCreateInput | Prisma.CustomerUpdateInput>(data: T): T {
    // Company comes only from verified actor membership/query scope. Prisma
    // relation input and scalar entityId in a request body cannot override it.
    return Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'entity' && key !== 'entityId')) as T;
  }
}
