import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Header,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { AfterSalesSourceGuard } from './after-sales-source.guard';
import {
  AFTER_SALES_CASE_STATUSES,
  AFTER_SALES_CASE_TYPES,
} from './after-sales-workflow.contract';
import { RequireEntityAccess } from '../../../common/decorators/entity-access.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { EntityAccessGuard } from '../../../common/guards/entity-access.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AfterSalesLegacyAdapter } from './after-sales-legacy.adapter';
import { AfterSalesMigrationService } from './after-sales-migration.service';

class LegacyCaseListQueryDto {
  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsDateString()
  updatedAfter?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  includeDeleted?: 'true' | 'false';
}

class EntityQueryDto {
  @IsString()
  @IsNotEmpty()
  entityId!: string;
}

class WorkbenchQueryDto extends EntityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
  @IsOptional()
  @IsIn(['all', 'active', 'urgent', 'closed'])
  view?: string;
  @IsOptional()
  @IsIn(AFTER_SALES_CASE_TYPES)
  type?: string;
  @IsOptional()
  @IsIn(AFTER_SALES_CASE_STATUSES)
  status?: string;
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

class MigrationPageDto {
  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsDateString()
  updatedAfter?: string;
}

@ApiTags('After Sales')
@ApiBearerAuth()
@Controller('after-sales')
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
  PermissionsGuard,
  EntityAccessGuard,
  AfterSalesSourceGuard,
)
@RequireEntityAccess('sales')
@RequirePermissions({ resource: 'after_sales_cases', action: 'read' })
export class AfterSalesController {
  constructor(
    private readonly legacyAdapter: AfterSalesLegacyAdapter,
    private readonly migrationService: AfterSalesMigrationService,
  ) {}

  @Get('workbench/cases')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '售後工作台分頁查詢（唯讀）' })
  workbench(@Query() query: WorkbenchQueryDto) {
    const { page, pageSize, view, type, status, search } = query;
    return this.legacyAdapter.getWorkbench({
      page,
      pageSize,
      view,
      type,
      status,
      search,
    });
  }

  @Get('workbench/cases/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '售後工作台案件詳情（唯讀）' })
  workbenchCase(@Param('id') id: string, @Query() query: EntityQueryDto) {
    void query.entityId;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw new BadRequestException('案件 ID 格式不正確');
    return this.legacyAdapter.getWorkbenchCase(id);
  }

  @Get('readiness')
  @ApiOperation({ summary: '檢查售後舊系統唯讀連線' })
  readiness(@Query() query: EntityQueryDto) {
    void query.entityId;
    return this.legacyAdapter.getReadiness();
  }

  @Get('legacy/cases')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '讀取售後舊系統案件清單' })
  listLegacyCases(@Query() query: LegacyCaseListQueryDto) {
    return this.legacyAdapter.listCases({
      limit: query.limit,
      cursor: query.cursor,
      updatedAfter: query.updatedAfter,
      includeDeleted: query.includeDeleted === 'true',
    });
  }

  @Get('legacy/cases/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '讀取售後舊系統案件完整資料' })
  getLegacyCase(@Param('id') id: string, @Query() query: EntityQueryDto) {
    void query.entityId;
    return this.legacyAdapter.getCase(id);
  }

  @Get('migration/preview/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '預覽單筆售後案件遷移結果（不寫入）' })
  previewMigration(@Param('id') id: string, @Query() query: EntityQueryDto) {
    void query.entityId;
    return this.migrationService.previewCase(id);
  }

  @Get('migration/preview-page')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '預覽一頁售後案件遷移結果（不寫入）' })
  previewMigrationPage(@Query() query: MigrationPageDto) {
    return this.migrationService.previewPage(query);
  }

  @Post('migration/stage-page')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '寫入一頁售後遷移 staging（不寫正式售後資料）' })
  stageMigrationPage(@Body() body: MigrationPageDto) {
    return this.migrationService.stagePage(body.entityId, body);
  }
}
