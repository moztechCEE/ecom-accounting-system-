import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { VendorService } from './vendor.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { EntityAccessService, DataAccessModule } from '../../common/entity-access/entity-access.service';
import { resolveCompanyRead } from '../../common/entity-access/resolve-company-read';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

type StaffRequest = { user?: { id?: string; effectivePermissions?: string[] } };

@ApiTags('vendors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vendors')
export class VendorController {
  constructor(
    private readonly vendorService: VendorService,
    private readonly entityAccessService: EntityAccessService,
    private readonly prisma: PrismaService,
  ) {}

  // Vendor names are also needed when accounting staff select an AP payee.
  // A read requires the matching permission AND company scope for that module.
  private async readCompany(req: StaffRequest, requestedEntityId?: string) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('Authenticated user is required');
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const admin = userRoles.some(({ role }) => ['ADMIN', 'SUPER_ADMIN'].includes(role.code));
    const permissions = new Set([
      ...(req.user?.effectivePermissions || []),
      ...userRoles.flatMap(({ role }) => role.permissions.map(({ permission }) => `${permission.resource}:${permission.action}`)),
    ]);
    const modules: DataAccessModule[] = [];
    if (admin || permissions.has('purchase_orders:read') || permissions.has('purchase_orders:create')) modules.push('purchasing');
    if (admin || permissions.has('accounts:read')) modules.push('accounting');
    for (const module of modules) {
      try {
        return await resolveCompanyRead(this.entityAccessService, userId, module, requestedEntityId);
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    throw new ForbiddenException('Vendor read permission and company access are required');
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'purchase_orders', action: 'create' })
  @ApiOperation({ summary: 'Create a new vendor' })
  async create(@Request() req: StaffRequest, @Body() createVendorDto: CreateVendorDto, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'purchasing', requestedEntityId);
    return this.vendorService.create(entityId, createVendorDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all vendors' })
  async findAll(@Request() req: StaffRequest, @Query('entityId') requestedEntityId?: string) {
    const entityId = await this.readCompany(req, requestedEntityId);
    return this.vendorService.findAll(entityId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a vendor by ID' })
  async findOne(@Request() req: StaffRequest, @Param('id') id: string, @Query('entityId') requestedEntityId?: string) {
    const entityId = await this.readCompany(req, requestedEntityId);
    return this.vendorService.findOne(entityId, id);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'purchase_orders', action: 'create' })
  @ApiOperation({ summary: 'Update a vendor' })
  async update(
    @Request() req: StaffRequest,
    @Param('id') id: string,
    @Body() updateVendorDto: UpdateVendorDto,
    @Query('entityId') requestedEntityId?: string,
  ) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'purchasing', requestedEntityId);
    return this.vendorService.update(entityId, id, updateVendorDto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'purchase_orders', action: 'create' })
  @ApiOperation({ summary: 'Delete a vendor' })
  async remove(@Request() req: StaffRequest, @Param('id') id: string, @Query('entityId') requestedEntityId?: string) {
    const entityId = await resolveCompanyRead(this.entityAccessService, req.user?.id, 'purchasing', requestedEntityId);
    return this.vendorService.remove(entityId, id);
  }
}
