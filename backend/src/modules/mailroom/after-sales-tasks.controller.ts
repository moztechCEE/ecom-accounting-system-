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
  AfterSalesCaseCommandDto,
  AfterSalesCasePhotoParams,
  AfterSalesApplicationsQuery,
  AfterSalesApplicationPhotoParams,
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
  @Get('cases/:id/communications/:confirmationId/photos/:index')
  @Header('Cache-Control', 'private, no-store')
  photo(@Req() req: { user: { id: string } }, @Param() params: AfterSalesCasePhotoParams, @Query() query: AfterSalesTaskEntityDto) {
    return this.service.photo(req.user.id, query.entityId, params.id, params.confirmationId, params.index);
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
  private assertCommandActor(userId: string, expectedActorId: string | undefined) {
    if (!expectedActorId || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedActorId)) throw new BadRequestException('售後作業需要操作人員識別');
    if (expectedActorId !== userId) throw new ForbiddenException('登入帳號已變更，請重新確認案件');
  }
  @Get('applications')
  @Header('Cache-Control', 'private, no-store')
  applications(@Req() req: { user: { id: string } }, @Query() query: AfterSalesApplicationsQuery) {
    return this.service.applications(req.user.id, query.entityId, query.status, query.cursor);
  }
  @Get('applications/:id')
  @Header('Cache-Control', 'private, no-store')
  application(@Req() req: { user: { id: string } }, @Param() params: AfterSalesTaskCaseParams, @Query() query: AfterSalesTaskEntityDto) {
    return this.service.application(req.user.id, query.entityId, params.id);
  }
  @Get('applications/:id/photos/:index')
  @Header('Cache-Control', 'private, no-store')
  applicationPhoto(@Req() req: { user: { id: string } }, @Param() params: AfterSalesApplicationPhotoParams, @Query() query: AfterSalesTaskEntityDto) {
    return this.service.application(req.user.id, query.entityId, params.id, params.index);
  }
  @Post('applications')
  @Header('Cache-Control', 'private, no-store')
  invite(@Req() req: { user: { id: string } }, @Body() body: AfterSalesCaseCommandDto, @Headers('x-doa-actor') actor: string | undefined) {
    this.assertCommandActor(req.user.id, actor);
    return this.service.applicationCommand(req.user.id, body.entityId, body.command);
  }
  @Post('applications/:id')
  @Header('Cache-Control', 'private, no-store')
  reviewApplication(@Req() req: { user: { id: string } }, @Param() params: AfterSalesTaskCaseParams, @Body() body: AfterSalesCaseCommandDto, @Headers('x-doa-actor') actor: string | undefined) {
    this.assertCommandActor(req.user.id, actor);
    return this.service.applicationCommand(req.user.id, body.entityId, body.command, params.id);
  }
  @Post('cases/:id/communications')
  @Header('Cache-Control', 'private, no-store')
  communicate(@Req() req: { user: { id: string } }, @Param() params: AfterSalesTaskCaseParams, @Body() body: AfterSalesCaseCommandDto, @Headers('x-doa-actor') actor: string | undefined) {
    this.assertCommandActor(req.user.id, actor);
    return this.service.command(req.user.id, body.entityId, params.id, 'communications', body.command);
  }
  @Post('cases/:id/repair-proposals/adopt')
  @Header('Cache-Control', 'private, no-store')
  adoptProposal(@Req() req: { user: { id: string } }, @Param() params: AfterSalesTaskCaseParams, @Body() body: AfterSalesCaseCommandDto, @Headers('x-doa-actor') actor: string | undefined) {
    this.assertCommandActor(req.user.id, actor);
    return this.service.command(req.user.id, body.entityId, params.id, 'repair-proposals/adopt', body.command);
  }
  @Post('cases/:id/factory-actions')
  @Header('Cache-Control', 'private, no-store')
  factory(@Req() req: { user: { id: string } }, @Param() params: AfterSalesTaskCaseParams, @Body() body: AfterSalesCaseCommandDto, @Headers('x-doa-actor') actor: string | undefined) {
    this.assertCommandActor(req.user.id, actor);
    return this.service.command(req.user.id, body.entityId, params.id, 'factory-actions', body.command);
  }
  @Post('cases/:id/brand-review')
  @Header('Cache-Control', 'private, no-store')
  brandReview(@Req() req: { user: { id: string } }, @Param() params: AfterSalesTaskCaseParams, @Body() body: AfterSalesCaseCommandDto, @Headers('x-doa-actor') actor: string | undefined) {
    this.assertCommandActor(req.user.id, actor);
    return this.service.command(req.user.id, body.entityId, params.id, 'brand-review', body.command);
  }
}
