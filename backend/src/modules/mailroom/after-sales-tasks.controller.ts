import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AfterSalesTasksService } from './after-sales-tasks.service';
import {
  AfterSalesOptionsQuery,
  AfterSalesTaskCaseParams,
  AfterSalesTaskEntityDto,
  AfterSalesTasksQuery,
  RegisterAfterSalesCaseDto,
} from './after-sales-tasks.dto';

@Controller('after-sales/tasks')
export class AfterSalesTasksController {
  constructor(private readonly service: AfterSalesTasksService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: { user: { id: string } },
    @Query() query: AfterSalesTasksQuery,
  ) {
    return this.service.list(req.user.id, query);
  }
  @Get('options')
  @Header('Cache-Control', 'private, no-store')
  options(
    @Req() req: { user: { id: string } },
    @Query() query: AfterSalesOptionsQuery,
  ) {
    return this.service.options(req.user.id, query);
  }
  @Get('cases/:id')
  @Header('Cache-Control', 'private, no-store')
  detail(
    @Req() req: { user: { id: string } },
    @Param() params: AfterSalesTaskCaseParams,
    @Query() query: AfterSalesTaskEntityDto,
  ) {
    return this.service.detail(req.user.id, query.entityId, params.id);
  }
  @Post('cases')
  @Header('Cache-Control', 'private, no-store')
  register(
    @Req() req: { user: { id: string } },
    @Body() body: RegisterAfterSalesCaseDto,
  ) {
    return this.service.register(req.user.id, body);
  }
}
