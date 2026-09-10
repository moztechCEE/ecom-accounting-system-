import { Body, Controller, Get, Header, Module, Param, Post, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { EntityAccessGuard } from '../../../common/guards/entity-access.guard';
import { RequireEntityAccess } from '../../../common/decorators/entity-access.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WmsWorkspaceBridge } from './wms-workspace-bridge';
import { WmsDispatchService } from './wms-dispatch.service';
import type { ManagementSection } from './wms-management.contract';

export class WmsWorkbenchQuery {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsOptional() @IsIn(['all','pending','picking','packing','completed','logistics','returns']) view?: string;
  @IsOptional() @IsIn(['overview','dispatch','pick','pack','shipping']) area?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
export class WmsCommandDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(64) requestId!: string;
}
export class WmsManagementQuery {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!:string;
  @IsOptional() @IsString() @MaxLength(120) search?:string;
  @IsOptional() @Type(()=>Number) @IsIn([0,1,7,30,90]) days?:number;
  @IsOptional() @IsIn(['all','open','ack','resolved','rejected','unresolved']) status?:string;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page?:number;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) pickPage?:number;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) packPage?:number;
}
export class WmsScanDto extends WmsCommandDto {
  @IsString() @IsNotEmpty() @MaxLength(256) scanValue!: string;
}
export class WmsDispatchDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!:string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) sourceHash!:string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/) requestId!:string;
}
@Controller('wms/workbench')
@UseGuards(JwtAuthGuard, PermissionsGuard, EntityAccessGuard)
@RequireEntityAccess('inventory')
@RequirePermissions({resource:'wms_tasks',action:'read'})
export class WmsWorkbenchController {
  constructor(private readonly bridge:WmsWorkspaceBridge,private readonly dispatchService?:WmsDispatchService) {}
  @Get('management/:section') @Header('Cache-Control','private, no-store')
  management(@Query() q:WmsManagementQuery,@Param('section') section:ManagementSection,@Req() req:{user:{id:string}}){
    // Bridge rechecks the selected report's permission on every request, in addition to entity/task guards.
    return this.bridge.readManagement(req.user.id,q,section);
  }
  @Get('orders') @Header('Cache-Control','private, no-store')
  orders(@Query() query: WmsWorkbenchQuery,@Req() request:{user:{id:string}}) {
    return this.bridge.read(request.user.id,query);
  }
  @Get('orders/:id') @Header('Cache-Control','private, no-store')
  detail(@Query() query: WmsWorkbenchQuery,@Req() request:{user:{id:string}},@Param('id') id:string) { return this.bridge.read(request.user.id,query,id); }

  @Get('stations') @Header('Cache-Control','private, no-store')
  stations(@Query() _query: WmsWorkbenchQuery,@Req() request:{user:{id:string}}) { return this.bridge.stations(request.user.id); }

  @Get('dispatch/:id') @Header('Cache-Control','private, no-store')
  @RequirePermissions({resource:'wms_tasks',action:'read'},{resource:'wms_orders',action:'create'})
  previewDispatch(@Query() q:WmsWorkbenchQuery,@Param('id') id:string,@Req() req:{user:{id:string}}){return this.dispatchService!.preview(req.user.id,q.entityId,id);}
  @Get('dispatch-orders') @Header('Cache-Control','private, no-store')
  @RequirePermissions({resource:'wms_tasks',action:'read'},{resource:'wms_orders',action:'create'})
  dispatchOrders(@Query() q:WmsWorkbenchQuery,@Req() req:{user:{id:string}}){return this.dispatchService!.candidates(req.user.id,q.entityId,q.search);}
  @Post('dispatch/:id')
  @RequirePermissions({resource:'wms_tasks',action:'read'},{resource:'wms_orders',action:'create'})
  dispatch(@Body() body:WmsDispatchDto,@Param('id') id:string,@Req() req:{user:{id:string}}){return this.dispatchService!.dispatch(req.user.id,body.entityId,id,body.sourceHash,body.requestId);}

  @Post('orders/:id/pick/claim')
  @RequirePermissions({resource:'wms_tasks',action:'read'},{resource:'wms_picking',action:'execute'})
  claimPick(@Body() body: WmsCommandDto,@Param('id') id:string,@Req() req:{user:{id:string}}) { return this.bridge.command(req.user.id,body.entityId,id,'pick','claim',body as any); }

  @Post('orders/:id/pick/scan')
  @RequirePermissions({resource:'wms_tasks',action:'read'},{resource:'wms_picking',action:'execute'})
  scanPick(@Body() body: WmsScanDto,@Param('id') id:string,@Req() req:{user:{id:string}}) { return this.bridge.command(req.user.id,body.entityId,id,'pick','scan',body as any); }

  @Post('orders/:id/pack/claim')
  @RequirePermissions({resource:'wms_tasks',action:'read'},{resource:'wms_packing',action:'execute'})
  claimPack(@Body() body: WmsCommandDto,@Param('id') id:string,@Req() req:{user:{id:string}}) { return this.bridge.command(req.user.id,body.entityId,id,'pack','claim',body as any); }

  @Post('orders/:id/pack/scan')
  @RequirePermissions({resource:'wms_tasks',action:'read'},{resource:'wms_packing',action:'execute'})
  scanPack(@Body() body: WmsScanDto,@Param('id') id:string,@Req() req:{user:{id:string}}) { return this.bridge.command(req.user.id,body.entityId,id,'pack','scan',body as any); }

  private unavailable(): never {
    throw new ServiceUnavailableException({code:'WMS_SOURCE_NOT_APPROVED',message:'WMS 安全連線與員工對照尚未開通'});
  }
}
@Module({controllers:[WmsWorkbenchController],providers:[{provide:WmsWorkspaceBridge,useFactory:(prisma:PrismaService)=>new WmsWorkspaceBridge(prisma),inject:[PrismaService]},
 {provide:WmsDispatchService,useFactory:(prisma:PrismaService,bridge:WmsWorkspaceBridge)=>new WmsDispatchService(prisma,bridge),inject:[PrismaService,WmsWorkspaceBridge]}]})
export class WmsWorkbenchModule {}
