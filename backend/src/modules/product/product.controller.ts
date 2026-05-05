import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { CreateBomDto } from './dto/create-bom.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ProductType } from '@prisma/client';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  create(@Request() req, @Body() createProductDto: CreateProductDto) {
    const entityId = req.user.entityId || 'default-entity-id'; // Fallback for dev
    return this.productService.create(entityId, createProductDto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  findAll(
    @Request() req,
    @Query('type') type?: ProductType,
    @Query('category') category?: string,
  ) {
    const entityId = req.user.entityId || 'default-entity-id';
    return this.productService.findAll(entityId, { type, category });
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  findOne(@Request() req, @Param('id') id: string) {
    const entityId = req.user.entityId || 'default-entity-id';
    return this.productService.findOne(entityId, id);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  update(@Request() req, @Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    const entityId = req.user.entityId || 'default-entity-id';
    return this.productService.update(entityId, id, updateProductDto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  remove(@Request() req, @Param('id') id: string) {
    const entityId = req.user.entityId || 'default-entity-id';
    return this.productService.remove(entityId, id);
  }

  // BOM Endpoints
  @Post(':id/bom')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  addBomComponent(
    @Request() req,
    @Param('id') id: string,
    @Body() createBomDto: CreateBomDto,
  ) {
    const entityId = req.user.entityId || 'default-entity-id';
    return this.productService.addBomComponent(entityId, id, createBomDto);
  }

  @Delete(':id/bom/:childId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  removeBomComponent(
    @Request() req,
    @Param('id') id: string,
    @Param('childId') childId: string,
  ) {
    const entityId = req.user.entityId || 'default-entity-id';
    return this.productService.removeBomComponent(entityId, id, childId);
  }
}
