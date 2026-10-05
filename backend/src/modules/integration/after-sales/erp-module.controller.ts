import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  SetMetadata,
} from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import {
  ERP_AFTER_SALES_SERVICE_AUTH,
  SOURCE_SECTIONS,
} from './erp-module.contract';
import { ErpAfterSalesModuleService } from './erp-module.service';
class LaunchDto {
  @IsString() @IsNotEmpty() entityId!: string;
  @IsIn(Object.keys(SOURCE_SECTIONS)) section!: string;
}
@Controller('after-sales/module')
export class ErpAfterSalesModuleController {
  constructor(private readonly service: ErpAfterSalesModuleService) {}
  @Post('launch')
  @Header('Cache-Control', 'no-store')
  launch(
    @Req()
    req: {
      user: { id: string };
      headers: Record<string, string>;
      method: string;
      originalUrl: string;
    },
    @Body() body: LaunchDto,
  ) {
    return this.service.launch(
      req.user.id,
      body.entityId,
      body.section,
      req.headers.origin || '',
    );
  }
  @Get('actors/:id')
  @SetMetadata(ERP_AFTER_SALES_SERVICE_AUTH, true)
  @Header('Cache-Control', 'no-store')
  inspect(
    @Req()
    req: {
      user: { id: string };
      headers: Record<string, string>;
      method: string;
      originalUrl: string;
    },
    @Param('id') id: string,
    @Query('entityId') entity: string,
  ) {
    return this.service.inspect(req, id, entity);
  }
}
