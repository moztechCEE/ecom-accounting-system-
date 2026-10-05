import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { AfterSalesStockService } from './after-sales-stock.service';
import { ReceiveReturnStockDto } from './after-sales-stock.dto';
class StockQuery {
  @IsString() @IsNotEmpty() entityId!: string;
  @IsOptional() @IsUUID() itemId?: string;
}
class QualificationDto extends StockQuery {
  @IsUUID() productId!: string;
  @IsUUID() warehouseId!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) unitLabel!: string;
  @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
  @IsIn(['NEW', 'REFURBISHED']) kind!: string;
  @IsOptional() @IsUUID() sourceItemId?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) sourceReference!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) ownershipReference!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) inspectionReference!: string;
}
class ReservationDto extends StockQuery {
  @IsUUID() declare itemId: string;
  @IsUUID() unitId!: string;
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}
@Controller('after-sales/stock')
export class AfterSalesStockController {
  constructor(private readonly stock: AfterSalesStockService) {}
  @Get('catalog') catalog(
    @Req() req: { user: { id: string }; headers: { origin?: string } },
    @Query() q: StockQuery,
  ) {
    return this.stock.catalog(req.user.id, q.entityId);
  }
  @Get('units') list(
    @Req() req: { user: { id: string }; headers: { origin?: string } },
    @Query() q: StockQuery,
  ) {
    return this.stock.list(req.user.id, q.entityId, q.itemId);
  }
  @Post('qualify') qualify(
    @Req() req: { user: { id: string }; headers: { origin?: string } },
    @Body() body: QualificationDto,
  ) {
    return this.stock.qualify(req.user.id, body);
  }
  @Post('reserve') reserve(
    @Req() req: { user: { id: string }; headers: { origin?: string } },
    @Body() body: ReservationDto,
  ) {
    return this.stock.reserve(req.user.id, body);
  }
  @Post('receive-return') receiveReturn(
    @Req() req: { user: { id: string } },
    @Body() body: ReceiveReturnStockDto,
  ) {
    return this.stock.receiveReturn(req.user.id, body);
  }
  @Post('reservations/:id/release') release(
    @Req() req: { user: { id: string }; headers: { origin?: string } },
    @Param('id') id: string,
    @Body() body: StockQuery,
  ) {
    return this.stock.release(req.user.id, body.entityId, id);
  }
}
