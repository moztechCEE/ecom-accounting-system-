import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { MailroomQuery } from './mailroom.dto';
import {
  RepairEvidenceCommand,
  RepairMediaUploadDto,
  RepairReportPublishDto,
} from './repair-evidence.dto';
import { RepairMediaService } from './repair-media.service';
import { RepairCustomerReportService } from './repair-customer-report.service';
type Staff = { user: { id: string } };
const fileResponse = (
  result: Awaited<ReturnType<RepairMediaService['scopedFile']>>,
  res: Response,
) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  return new StreamableFile(result.stream, {
    type: result.asset.contentType,
    length: Number(result.asset.sizeBytes),
  });
};
@Controller('repair-workbench/items/:id')
export class RepairEvidenceController {
  constructor(
    private readonly media: RepairMediaService,
    private readonly reports: RepairCustomerReportService,
  ) {}
  @Post('media/uploads') upload(
    @Req() req: Staff,
    @Param('id') id: string,
    @Body() body: RepairMediaUploadDto,
  ) {
    return this.media.upload(req.user.id, id, body);
  }
  @Post('media/:mediaId/finalize') finalize(
    @Req() req: Staff,
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Body() body: RepairEvidenceCommand,
  ) {
    return this.media.finalize(req.user.id, id, mediaId, body);
  }
  @Post('media/:mediaId/revoke') revokeMedia(
    @Req() req: Staff,
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Body() body: RepairEvidenceCommand,
  ) {
    return this.media.revoke(req.user.id, id, mediaId, body);
  }
  @Get('media') list(
    @Req() req: Staff,
    @Param('id') id: string,
    @Query() query: MailroomQuery,
  ) {
    return this.media.list(req.user.id, query.entityId, id);
  }
  @Get('media/:mediaId/file') async file(
    @Req() req: Staff,
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Query() query: MailroomQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return fileResponse(
      await this.media.privateFile(req.user.id, query.entityId, id, mediaId),
      res,
    );
  }
  @Post('reports/publish') publish(
    @Req() req: Staff,
    @Param('id') id: string,
    @Body() body: RepairReportPublishDto,
  ) {
    return this.reports.publish(req.user.id, id, body);
  }
  @Post('reports/:reportId/revoke') revokeReport(
    @Req() req: Staff,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Body() body: RepairEvidenceCommand,
  ) {
    return this.reports.revoke(req.user.id, id, reportId, body);
  }
  @Get('reports') reportsList(
    @Req() req: Staff,
    @Param('id') id: string,
    @Query() query: MailroomQuery,
  ) {
    return this.reports.list(req.user.id, query.entityId, id);
  }
}
@Controller('public/repair-reports')
export class RepairPublicReportController {
  constructor(private readonly reports: RepairCustomerReportService) {}
  @Public() @Get(':reportId') view(
    @Param('reportId') id: string,
    @Headers('x-repair-report-token') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    return this.reports.publicView(id, token);
  }
  @Public() @Get(':reportId/media/:mediaId') async media(
    @Param('reportId') id: string,
    @Param('mediaId') mediaId: string,
    @Headers('x-repair-report-token') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return fileResponse(
      await this.reports.publicMedia(id, mediaId, token),
      res,
    );
  }
}
