import { Controller, Get, Header, Module, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { EntityAccessGuard } from '../../../common/guards/entity-access.guard';
import { RequireEntityAccess } from '../../../common/decorators/entity-access.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';

export class WmsWorkbenchQuery {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsIn(['all','pending','picking','packing','completed','logistics','returns']) view?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
@Controller('wms/workbench')
@UseGuards(JwtAuthGuard, PermissionsGuard, EntityAccessGuard)
@RequireEntityAccess('inventory')
@RequirePermissions({resource:'inventory',action:'read'})
export class WmsWorkbenchController {
  @Get('orders') @Header('Cache-Control','private, no-store')
  orders(@Query() _query: WmsWorkbenchQuery) {
    // Never tunnel requests to legacy side-effecting GETs. No source access
    // until service identity and employee/company/brand mapping are approved.
    throw new ServiceUnavailableException({code:'WMS_SOURCE_NOT_APPROVED',message:'WMS 安全連線與員工對照尚未開通'});
  }
}
@Module({controllers:[WmsWorkbenchController]})
export class WmsWorkbenchModule {}
