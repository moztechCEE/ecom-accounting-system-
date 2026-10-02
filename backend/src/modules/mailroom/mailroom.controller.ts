import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { MailroomService } from './mailroom.service';
import {
  CreateReceiptDto,
  MailroomCommandDto,
  MailroomQuery,
} from './mailroom.dto';
import { MailroomServiceAuth } from './mailroom.auth';
@Controller('mailroom')
export class MailroomController {
  constructor(private readonly service: MailroomService) {}
  @Get('people') people(@Req() req: any, @Query() q: MailroomQuery) {
    return this.service.people(req.user.id, q.entityId);
  }
  @Get('source-cases') sources(@Req() req: any, @Query() q: MailroomQuery) {
    return this.service.sourceCases(req.user.id, q.entityId, q.search, {
      awaiting: q.awaiting === 'true',
      cursor: q.cursor,
    });
  }
  @Get('tasks') tasks(@Req() req: any, @Query() q: MailroomQuery) {
    return this.service.tasks(req.user.id, q.entityId);
  }
  @Get('items') list(@Req() req: any, @Query() q: MailroomQuery) {
    return this.service.list(req.user.id, q);
  }
  @Get('items/:id') detail(
    @Req() req: any,
    @Query() q: MailroomQuery,
    @Param('id') id: string,
  ) {
    return this.service.detail(req.user.id, q.entityId, id);
  }
  @Post('receipts') create(@Req() req: any, @Body() body: CreateReceiptDto) {
    return this.service.create(req.user.id, body);
  }
  @Post('items/:id/actions') action(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: MailroomCommandDto,
  ) {
    return this.service.command(req.user.id, id, body);
  }
  @MailroomServiceAuth()
  @Get('integration/cases/:id')
  progress(@Req() req: any, @Param('id') id: string) {
    return this.service.caseProgress(req.mailroomEntityId, id);
  }
}
