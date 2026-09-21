import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { CreateBomDto } from './dto/create-bom.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ProductType } from '@prisma/client';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { resolveCompanyRead } from '../../common/entity-access/resolve-company-read';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly entityAccessService: EntityAccessService,
  ) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async create(@Request() req, @Body() createProductDto: CreateProductDto, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.create(entityId, createProductDto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  async findAll(
    @Request() req,
    @Query('type') type?: ProductType,
    @Query('category') category?: string,
    @Query('entityId') requestedEntityId?: string,
  ) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.findAll(entityId, { type, category });
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  async findOne(@Request() req, @Param('id') id: string, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.findOne(entityId, id);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async update(@Request() req, @Param('id') id: string, @Body() updateProductDto: UpdateProductDto, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.update(entityId, id, updateProductDto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async remove(@Request() req, @Param('id') id: string, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.remove(entityId, id);
  }

  // BOM Endpoints
  @Post(':id/bom')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async addBomComponent(
    @Request() req,
    @Param('id') id: string,
    @Body() createBomDto: CreateBomDto,
    @Query('entityId') requestedEntityId?: string,
  ) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.addBomComponent(entityId, id, createBomDto);
  }

  @Delete(':id/bom/:childId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async removeBomComponent(
    @Request() req,
    @Param('id') id: string,
    @Param('childId') childId: string,
    @Query('entityId') requestedEntityId?: string,
  ) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.removeBomComponent(entityId, id, childId);
  }
}
