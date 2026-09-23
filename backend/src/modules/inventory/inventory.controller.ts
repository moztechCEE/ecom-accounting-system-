import {
  Controller,
  Get,
  Query,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { EntityAccessGuard } from '../../common/guards/entity-access.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireEntityAccess } from '../../common/decorators/entity-access.decorator';
import {
  CreateInventoryWarehouseDto,
  InventoryCompanyQueryDto,
  InventoryImportBodyDto,
  InventoryImportQueryDto,
  InventorySnapshotsQueryDto,
} from './dto/inventory-http.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, EntityAccessGuard)
@RequireEntityAccess('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('warehouses')
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  @ApiOperation({ summary: '查詢倉庫列表' })
  getWarehouses(@Query() query: InventoryCompanyQueryDto) {
    return this.inventoryService.getWarehouses(query.entityId);
  }

  @Post('warehouses')
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  @ApiOperation({ summary: '建立倉庫（多倉）' })
  createWarehouse(@Body() body: CreateInventoryWarehouseDto) {
    return this.inventoryService.createWarehouse(body);
  }

  @Get('snapshots')
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  @ApiOperation({ summary: '取得指定商品在各倉庫的庫存快照' })
  getSnapshots(@Query() query: InventorySnapshotsQueryDto) {
    return this.inventoryService.getSnapshotsForProduct(query.entityId, query.productId);
  }

  @Post('import/erp')
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
    }),
  )
  @ApiOperation({ summary: '批次匯入舊 ERP 庫存（Excel/CSV）' })
  importErpInventory(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: InventoryImportQueryDto,
    @Body() _body: InventoryImportBodyDto,
  ) {
    return this.inventoryService.importLegacyErpInventory({
      entityId: query.entityId,
      file,
      sheet: query.sheet,
      dryRun: query.dryRun === 'true',
      force: query.force === 'true',
    });
  }
}
