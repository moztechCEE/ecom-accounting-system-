import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  AllocateRepairMaterialDto,
  PhysicalRepairMaterialDto,
  ReleaseRepairMaterialDto,
  RepairMaterialsReadQuery,
} from './repair-materials.dto';
import { RepairMaterialsService } from './repair-materials.service';

@Controller('repair-workbench/items/:itemId/materials')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class RepairMaterialsController {
  constructor(private readonly service: RepairMaterialsService) {}

  @Get()
  read(
    @Req() req: { user: { id: string } },
    @Param('itemId') itemId: string,
    @Query() query: RepairMaterialsReadQuery,
  ) {
    return this.service.read(req.user.id, query.entityId, itemId);
  }

  @Post('allocate')
  allocate(
    @Req() req: { user: { id: string } },
    @Param('itemId') itemId: string,
    @Body() body: AllocateRepairMaterialDto,
  ) {
    return this.service.allocate(req.user.id, itemId, body);
  }

  @Post('receive')
  receive(
    @Req() req: { user: { id: string } },
    @Param('itemId') itemId: string,
    @Body() body: PhysicalRepairMaterialDto,
  ) {
    return this.service.receive(req.user.id, itemId, body);
  }

  @Post('consume')
  consume(
    @Req() req: { user: { id: string } },
    @Param('itemId') itemId: string,
    @Body() body: PhysicalRepairMaterialDto,
  ) {
    return this.service.consume(req.user.id, itemId, body);
  }

  @Post('release')
  release(
    @Req() req: { user: { id: string } },
    @Param('itemId') itemId: string,
    @Body() body: ReleaseRepairMaterialDto,
  ) {
    return this.service.release(req.user.id, itemId, body);
  }
}
