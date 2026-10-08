import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { MailroomStorageService } from './mailroom-storage.service';
import {
  CreateStorageLocationDto,
  CreateStorageRackDto,
  MoveStorageItemDto,
  StorageQueryDto,
  UpdateStorageLocationDto,
  UpdateStorageRackDto,
} from './mailroom-storage.dto';

type StaffRequest = { user: { id: string } };
@Controller('mailroom/storage')
export class MailroomStorageController {
  constructor(private readonly storage: MailroomStorageService) {}
  @Get() list(@Req() req: StaffRequest, @Query() query: StorageQueryDto) {
    return this.storage.list(req.user.id, query);
  }
  @Post('racks') createRack(
    @Req() req: StaffRequest,
    @Body() body: CreateStorageRackDto,
  ) {
    return this.storage.createRack(req.user.id, body);
  }
  @Post('racks/:id/update') updateRack(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: UpdateStorageRackDto,
  ) {
    return this.storage.updateRack(req.user.id, id, body);
  }
  @Post('locations') createLocation(
    @Req() req: StaffRequest,
    @Body() body: CreateStorageLocationDto,
  ) {
    return this.storage.createLocation(req.user.id, body);
  }
  @Post('locations/:id/update') updateLocation(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: UpdateStorageLocationDto,
  ) {
    return this.storage.updateLocation(req.user.id, id, body);
  }
  @Post('items/:id/move') move(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: MoveStorageItemDto,
  ) {
    return this.storage.move(req.user.id, id, body);
  }
}
