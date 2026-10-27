import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { MailroomLabelQuery } from './mailroom-label.dto';
import { MailroomLabelService } from './mailroom-label.service';
import { MailroomLabelExport } from './mailroom-label.export';

type StaffRequest = { user: { id: string } };

@Controller('mailroom/items')
export class MailroomLabelController {
  constructor(
    private readonly labels: MailroomLabelService,
    private readonly exporter: MailroomLabelExport,
  ) {}

  @Get(':id/label')
  @Header('Cache-Control', 'private, no-store')
  read(
    @Req() req: StaffRequest,
    @Query() query: MailroomLabelQuery,
    @Param('id') id: string,
  ) {
    return this.labels.read(req.user.id, query.entityId, id);
  }

  @Get(':id/label.pdf')
  @Header('Cache-Control', 'private, no-store')
  async pdf(
    @Req() req: StaffRequest,
    @Query() query: MailroomLabelQuery,
    @Param('id') id: string,
  ) {
    const label = await this.labels.read(req.user.id, query.entityId, id);
    const buffer = await this.exporter.pdf(label);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      length: buffer.length,
      disposition: `inline; filename="mailroom-label-${label.id}.pdf"`,
    });
  }
}
