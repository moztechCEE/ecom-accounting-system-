import { Controller, Get, Query, Req } from '@nestjs/common';
import { MailroomQuery } from './mailroom.dto';
import { MailroomCatalogService } from './mailroom-catalog.service';

@Controller('mailroom')
export class MailroomCatalogController {
  constructor(private readonly catalog: MailroomCatalogService) {}
  @Get('product-options')
  options(
    @Req() request: { user: { id: string } },
    @Query() query: MailroomQuery,
  ) {
    return this.catalog.options(request.user.id, query.entityId, query.search);
  }
}
