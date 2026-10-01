import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { MailroomTabletAcceptDto } from './mailroom-tablet.dto';
import { MailroomTabletService } from './mailroom-tablet.service';

@Controller('mailroom/tablet')
export class MailroomTabletController {
  constructor(private readonly service: MailroomTabletService) {}

  @Post('items/:id/accept')
  @HttpCode(200)
  accept(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: MailroomTabletAcceptDto,
  ) {
    return this.service.accept(req.user.id, id, body);
  }
}
