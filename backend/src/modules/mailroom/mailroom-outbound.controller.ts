import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CreateOutboundDto,
  OutboundCommandDto,
  OutboundQuery,
} from './mailroom-outbound.dto';
import { MailroomOutboundService } from './mailroom-outbound.service';
type Request = { user: { id: string } };
@Controller('mailroom/outbound')
export class MailroomOutboundController {
  constructor(private readonly service: MailroomOutboundService) {}
  @Get('source-orders') sourceOrders(
    @Req() req: Request,
    @Query() q: OutboundQuery,
  ) {
    return this.service.sources(req.user.id, q);
  }
  @Get('warehouses') warehouses(
    @Req() req: Request,
    @Query() q: OutboundQuery,
  ) {
    return this.service.warehouses(req.user.id, q.entityId);
  }
  @Get('orders') orders(@Req() req: Request, @Query() q: OutboundQuery) {
    return this.service.list(req.user.id, q);
  }
  @Get('orders/:id') order(
    @Req() req: Request,
    @Query() q: OutboundQuery,
    @Param('id') id: string,
  ) {
    return this.service.detail(req.user.id, q.entityId, id);
  }
  @Post('orders') async create(
    @Req() req: Request,
    @Body() body: CreateOutboundDto,
  ) {
    const result = await this.service.create(req.user.id, body);
    try {
      return {
        ...(await this.service.detail(req.user.id, body.entityId, result.id)),
        duplicate: result.duplicate,
      };
    } catch {
      throw new ServiceUnavailableException(
        '操作已保存，讀取回執暫時失敗；請重試原操作',
      );
    }
  }
  @Post('orders/:id/actions') async command(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutboundCommandDto,
  ) {
    const result = await this.service.command(req.user.id, id, body);
    try {
      return {
        ...(await this.service.detail(req.user.id, body.entityId, result.id)),
        duplicate: result.duplicate,
      };
    } catch {
      throw new ServiceUnavailableException(
        '操作已保存，讀取回執暫時失敗；請重試原操作',
      );
    }
  }
}
