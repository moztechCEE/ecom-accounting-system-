import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MailroomSourceMediaService } from './mailroom-source-media.service';
import { MailroomQuery } from './mailroom.dto';

type StaffRequest = { user: { id: string } };
@Controller('mailroom')
export class MailroomSourceMediaController {
  constructor(private readonly mediaService: MailroomSourceMediaService) {}
  @Get('source-summary') summary(
    @Req() req: StaffRequest,
    @Query() query: MailroomQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.mediaService.summary(req.user.id, query.entityId);
  }
  @Get('source-cases/:id/attachments') attachments(
    @Req() req: StaffRequest,
    @Query() query: MailroomQuery,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.mediaService.attachments(req.user.id, query.entityId, id);
  }
  @Get('source-cases/:id/attachments/:attachmentId/media') async media(
    @Req() req: StaffRequest,
    @Query() query: MailroomQuery,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const image = await this.mediaService.media(
      req.user.id,
      query.entityId,
      id,
      attachmentId,
    );
    response.setHeader('Content-Type', image.contentType);
    response.send(image.contents);
  }
}
