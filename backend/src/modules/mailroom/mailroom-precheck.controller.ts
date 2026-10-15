import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { MailroomPrecheckService } from './mailroom-precheck.service';
import { CreateReceiptDto } from './mailroom.dto';
import {
  PrecheckQueryDto,
  SavePrecheckDto,
  StartPrechecksDto,
  HandoffPrechecksDto,
  RecordedPrecheckPhotoQueryDto,
} from './mailroom-precheck.dto';
type StaffRequest = { user: { id: string } };

@Controller('mailroom/prechecks')
export class MailroomPrecheckController {
  constructor(private readonly prechecks: MailroomPrecheckService) {}
  @Post('receipts') receiveReceipt(
    @Req() req: StaffRequest,
    @Body() body: CreateReceiptDto,
  ) {
    return this.prechecks.receiveReceipt(req.user.id, body);
  }
  @Get() list(@Req() req: StaffRequest, @Query() query: PrecheckQueryDto) {
    return this.prechecks.list(req.user.id, query);
  }
  @Get('items/:id') read(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Query() query: PrecheckQueryDto,
  ) {
    return this.prechecks.read(req.user.id, query.entityId, id);
  }
  @Get('items/:id/photo')
  @Header('Cache-Control', 'private, no-store')
  async photo(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Query() query: PrecheckQueryDto,
  ) {
    const photo = await this.prechecks.photo(req.user.id, query.entityId, id);
    return new StreamableFile(photo.buffer, {
      type: photo.type,
      length: photo.buffer.length,
    });
  }
  @Post('start') start(
    @Req() req: StaffRequest,
    @Body() body: StartPrechecksDto,
  ) {
    return this.prechecks.start(req.user.id, body);
  }
  @Get('items/:id/recorded-photos/:photoId')
  @Header('Cache-Control', 'private, no-store')
  async recordedPhoto(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Query() query: RecordedPrecheckPhotoQueryDto,
  ) {
    const photo = await this.prechecks.recordedPhoto(
      req.user.id,
      query.entityId,
      id,
      query.revision,
      photoId,
    );
    return new StreamableFile(photo.buffer, {
      type: photo.type,
      length: photo.buffer.length,
    });
  }
  @Post('items/:id/save') save(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: SavePrecheckDto,
  ) {
    return this.prechecks.save(req.user.id, id, body);
  }
  @Post('handoff') handoff(
    @Req() req: StaffRequest,
    @Body() body: HandoffPrechecksDto,
  ) {
    return this.prechecks.handoff(req.user.id, body);
  }
  @Get('batches/:id') batch(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Query() query: PrecheckQueryDto,
  ) {
    return this.prechecks.batch(req.user.id, query.entityId, id);
  }
}
