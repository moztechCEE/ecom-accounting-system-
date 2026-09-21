import { BadRequestException, Controller, Get, Post, Body, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { EntityAccessGuard } from '../../common/guards/entity-access.guard';
import { RequireEntityAccess } from '../../common/decorators/entity-access.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard, EntityAccessGuard)
@RequireEntityAccess('purchasing')
@ApiQuery({ name: 'entityId', required: true })
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  private requireEntityId(entityId?: string) {
    const normalized = entityId?.trim();
    if (!normalized) throw new BadRequestException('entityId is required');
    return normalized;
  }

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  create(@Query('entityId') entityId: string, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseService.create(this.requireEntityId(entityId), dto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'purchase_orders', action: 'read' })
  findAll(@Query('entityId') entityId: string) {
    return this.purchaseService.findAll(this.requireEntityId(entityId));
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'purchase_orders', action: 'read' })
  findOne(@Query('entityId') entityId: string, @Param('id') id: string) {
    return this.purchaseService.findOne(this.requireEntityId(entityId), id);
  }

  @Put(':id/receive')
  @Roles('ADMIN', 'OPERATOR')
  receive(@Query('entityId') entityId: string, @Param('id') id: string, @Body() dto: ReceivePurchaseOrderDto) {
    return this.purchaseService.receiveOrder(this.requireEntityId(entityId), id, dto);
  }
}
