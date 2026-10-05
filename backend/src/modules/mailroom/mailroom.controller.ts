import { MailroomIntakeService } from './mailroom-intake.service';
import { INTAKE_ACTIONS } from './mailroom-intake.contract';
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { MailroomService } from './mailroom.service';
import {
  CreateReceiptDto,
  MailroomCommandDto,
  MailroomQuery,
} from './mailroom.dto';
import { MailroomServiceAuth } from './mailroom.auth';
type MailroomRequest = { user: { id: string }; mailroomEntityId: string };
@Controller('mailroom')
export class MailroomController {
  constructor(
    private readonly service: MailroomService,
    private readonly intake: MailroomIntakeService,
  ) {}
  @Get('people') people(
    @Req() req: MailroomRequest,
    @Query() q: MailroomQuery,
  ) {
    return this.service.people(req.user.id, q.entityId);
  }
  @Get('source-cases') sources(
    @Req() req: MailroomRequest,
    @Query() q: MailroomQuery,
  ) {
    return this.service.sourceCases(req.user.id, q.entityId, q.search, {
      awaiting: q.awaiting === 'true',
      cursor: q.cursor,
    });
  }
  @Get('intake-queue') intakeQueue(
    @Req() req: MailroomRequest,
    @Query() q: MailroomQuery,
  ) {
    return this.intake.queue(req.user.id, q);
  }
  @Get('tasks') tasks(@Req() req: MailroomRequest, @Query() q: MailroomQuery) {
    return this.service.tasks(req.user.id, q.entityId);
  }
  @Get('items') list(@Req() req: MailroomRequest, @Query() q: MailroomQuery) {
    return this.service.list(req.user.id, q);
  }
  @Get('items/:id') detail(
    @Req() req: MailroomRequest,
    @Query() q: MailroomQuery,
    @Param('id') id: string,
  ) {
    return this.service.detail(req.user.id, q.entityId, id);
  }
  @Post('receipts') create(
    @Req() req: MailroomRequest,
    @Body() body: CreateReceiptDto,
  ) {
    return this.service.create(req.user.id, body);
  }
  @Post('items/:id/actions') action(
    @Req() req: MailroomRequest,
    @Param('id') id: string,
    @Body() body: MailroomCommandDto,
  ) {
    if ((INTAKE_ACTIONS as readonly string[]).includes(body.action))
      return this.intake.command(req.user.id, id, body);
    return this.service.command(req.user.id, id, body);
  }
  @MailroomServiceAuth()
  @Get('integration/cases/:id')
  progress(@Req() req: MailroomRequest, @Param('id') id: string) {
    return this.service.caseProgress(req.mailroomEntityId, id);
  }
}
