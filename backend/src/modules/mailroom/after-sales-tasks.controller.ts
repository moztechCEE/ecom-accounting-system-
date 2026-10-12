import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
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
    @Headers('x-doa-actor') expectedActorId: string | undefined,
  ) {
    if (
      typeof expectedActorId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(expectedActorId)
    ) {
      throw new BadRequestException('售後建單需要有效的操作人員識別');
    }
    if (expectedActorId !== req.user.id) {
      throw new ForbiddenException('登入帳號已變更，請重新確認售後案件');
    }
    return this.service.register(req.user.id, body);
  }
}
