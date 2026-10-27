import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { MailroomPrintDeviceAuth } from './mailroom-print.auth';
import type { PrintIdentity, RedeemIdentity } from './mailroom-print.contract';
import { requireBrowserOrigin } from './mailroom-print.contract';
import {
  CreatePrintJobDto,
  PairPrintDeviceDto,
  PrintDevicePollDto,
  PrintEntityDto,
  PrintReceiptDto,
  PreviewPrintLabelDto,
  RedeemPrintDeviceDto,
} from './mailroom-print.dto';
import { MailroomPrintService } from './mailroom-print.service';
type BrowserRequest = { user: { id: string }; headers: { origin?: string } };
type DeviceRequest = {
  printDevice: PrintIdentity;
  printRedeem: RedeemIdentity;
};

@Controller('mailroom')
export class MailroomPrintController {
  constructor(private readonly service: MailroomPrintService) {}
  @Get('print-devices')
  @Header('Cache-Control', 'private, no-store')
  devices(@Req() req: BrowserRequest, @Query() q: PrintEntityDto) {
    return this.service.devices(req.user.id, q.entityId);
  }
  @Post('print-devices/pair')
  @Header('Cache-Control', 'private, no-store')
  pair(@Req() req: BrowserRequest, @Body() body: PairPrintDeviceDto) {
    requireBrowserOrigin(req.headers.origin);
    return this.service.pair(req.user.id, body);
  }
  @Post('print-devices/:id/revoke')
  @Header('Cache-Control', 'private, no-store')
  revoke(
    @Req() req: BrowserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PrintEntityDto,
  ) {
    requireBrowserOrigin(req.headers.origin);
    return this.service.revoke(req.user.id, body.entityId, id);
  }
  @Post('print-jobs')
  @Header('Cache-Control', 'private, no-store')
  create(@Req() req: BrowserRequest, @Body() body: CreatePrintJobDto) {
    requireBrowserOrigin(req.headers.origin);
    return this.service.create(req.user.id, body);
  }
  @Post('print-label-preview')
  @Header('Cache-Control', 'private, no-store')
  async preview(
    @Req() req: BrowserRequest,
    @Body() body: PreviewPrintLabelDto,
  ) {
    requireBrowserOrigin(req.headers.origin);
    const pdf = await this.service.preview(req.user.id, body);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      length: pdf.length,
      disposition: 'inline; filename="label-preview.pdf"',
    });
  }
  @Get('print-jobs/by-request/:requestId')
  @Header('Cache-Control', 'private, no-store')
  byRequest(
    @Req() req: BrowserRequest,
    @Param('requestId', ParseUUIDPipe) id: string,
    @Query() q: PrintEntityDto,
  ) {
    return this.service.byRequest(req.user.id, q.entityId, id);
  }
  @Get('print-jobs/:id')
  @Header('Cache-Control', 'private, no-store')
  status(
    @Req() req: BrowserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PrintEntityDto,
  ) {
    return this.service.status(req.user.id, q.entityId, id);
  }

  @MailroomPrintDeviceAuth('redeem')
  @Post('print-device/redeem')
  @Header('Cache-Control', 'private, no-store')
  redeem(@Req() req: DeviceRequest, @Body() body: RedeemPrintDeviceDto) {
    return this.service.redeem(req.printRedeem, body);
  }
  @MailroomPrintDeviceAuth()
  @Post('print-device/claim')
  @Header('Cache-Control', 'private, no-store')
  claim(@Req() req: DeviceRequest, @Body() _body: PrintDevicePollDto) {
    void _body; // Keep the empty DTO's whitelist/unknown-field validation active.
    return this.service.claim(req.printDevice);
  }
  @MailroomPrintDeviceAuth()
  @Get('print-device/jobs/:id/document')
  @Header('Cache-Control', 'private, no-store')
  async document(
    @Req() req: DeviceRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const pdf = await this.service.document(req.printDevice, id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      length: pdf.length,
      disposition: 'attachment; filename="label.pdf"',
    });
  }
  @MailroomPrintDeviceAuth()
  @Post('print-device/jobs/:id/receipt')
  @Header('Cache-Control', 'private, no-store')
  receipt(
    @Req() req: DeviceRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PrintReceiptDto,
  ) {
    return this.service.receipt(req.printDevice, id, body);
  }
}
