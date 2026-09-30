import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, UseInterceptors, Request, ForbiddenException } from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { CreateBomDto } from './dto/create-bom.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ProductType } from '@prisma/client';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { resolveCompanyRead } from '../../common/entity-access/resolve-company-read';
import { SensitiveResponseInterceptor, containsCostInput } from './sensitive-response.interceptor';

type ProductRequest = { user?: { id?: string; effectivePermissions?: string[] } };

@Controller('products')
@UseGuards(JwtAuthGuard)
@UseInterceptors(new SensitiveResponseInterceptor())
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly entityAccessService: EntityAccessService,
  ) {}

  private assertCostWrite(req: ProductRequest, input: unknown) {
    if (containsCostInput(input) && !req.user?.effectivePermissions?.includes('product_cost:update')) {
      throw new ForbiddenException('Missing permission: product_cost:update');
    }
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async create(@Request() req: ProductRequest, @Body() createProductDto: CreateProductDto, @Query('entityId') requestedEntityId?: string) {
    this.assertCostWrite(req, createProductDto);
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.create(entityId, createProductDto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  async findAll(
    @Request() req: ProductRequest,
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
  async findOne(@Request() req: ProductRequest, @Param('id') id: string, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.findOne(entityId, id);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async update(@Request() req: ProductRequest, @Param('id') id: string, @Body() updateProductDto: UpdateProductDto, @Query('entityId') requestedEntityId?: string) {
    this.assertCostWrite(req, updateProductDto);
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.update(entityId, id, updateProductDto);
  }

  @Patch(':id/sn-profile')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async updateSnProfile(@Request() req: ProductRequest, @Param('id') id: string, @Body() body: any, @Query('entityId') entity?: string) {
    const company = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', entity);
    return this.productService.updateSnProfile(company, id, body);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async remove(@Request() req: ProductRequest, @Param('id') id: string, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.remove(entityId, id);
  }

  // BOM Endpoints
  @Post(':id/bom')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async addBomComponent(
    @Request() req: ProductRequest,
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
    @Request() req: ProductRequest,
    @Param('id') id: string,
    @Param('childId') childId: string,
    @Query('entityId') requestedEntityId?: string,
  ) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'inventory', requestedEntityId);
    return this.productService.removeBomComponent(entityId, id, childId);
  }
}
