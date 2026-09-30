import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequireEntityAccess } from '../../common/decorators/entity-access.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { EntityAccessGuard } from '../../common/guards/entity-access.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  B2bCustomerDiscountDto,
  B2bDiscountPreviewDto,
  B2bOfferPreviewDto,
  B2bPriceBookListDto,
  B2bPriceBookEntityDto,
  B2bPublicCatalogQueryDto,
  B2bPutPriceBookDto,
  B2bUpsertOfferDto,
} from './b2b-pricebook.dto';
import { B2bPriceBookService } from './b2b-pricebook.service';

type StaffRequest = { user: { id: string } };

@Controller('b2b/admin')
@UseGuards(PermissionsGuard, EntityAccessGuard)
@RequireEntityAccess('sales')
@RequirePermissions({ resource: 'sales_orders', action: 'read' })
export class B2bPriceBookAdminController {
  constructor(private readonly service: B2bPriceBookService) {}

  @Get('price-books')
  @Header('Cache-Control', 'no-store')
  list(@Query() query: B2bPriceBookListDto) {
    return this.service.list(query);
  }

  @Get('price-books/brands')
  @Header('Cache-Control', 'no-store')
  brands(@Query() query: B2bPriceBookEntityDto) {
    return this.service.brands(query.entityId);
  }

  @Put('price-books/:productId')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  putBook(
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: B2bPutPriceBookDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.putBook(productId, dto, req.user.id);
  }

  @Post('price-books/:productId/offers')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  createOffer(
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: B2bUpsertOfferDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.createOffer(productId, dto, req.user.id);
  }

  @Patch('price-books/:productId/offers/:offerId')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  updateOffer(
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Param('offerId', new ParseUUIDPipe({ version: '4' })) offerId: string,
    @Body() dto: B2bUpsertOfferDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.updateOffer(productId, offerId, dto, req.user.id);
  }

  @Post('price-books/:productId/preview')
  @Header('Cache-Control', 'no-store')
  preview(
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: B2bOfferPreviewDto,
  ) {
    return this.service.preview(productId, dto);
  }

  @Get('customer-discounts')
  @Header('Cache-Control', 'no-store')
  discountRules(@Query() query: B2bPriceBookListDto) {
    return this.service.discountRules(query);
  }

  @Put('customer-discounts/:customerId')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  putDiscountRule(
    @Param('customerId', new ParseUUIDPipe({ version: '4' }))
    customerId: string,
    @Body() dto: B2bCustomerDiscountDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.putDiscountRule(customerId, dto, req.user.id);
  }

  @Post('customer-discounts/:customerId/preview')
  @Header('Cache-Control', 'no-store')
  previewDiscount(
    @Param('customerId', new ParseUUIDPipe({ version: '4' }))
    customerId: string,
    @Body() dto: B2bDiscountPreviewDto,
  ) {
    return this.service.previewDiscount(customerId, dto);
  }
}

@Public()
@Controller('b2b/public')
export class B2bPublicCatalogController {
  constructor(private readonly service: B2bPriceBookService) {}

  @Get('catalog')
  @Header('Cache-Control', 'no-store')
  catalog(@Query() query: B2bPublicCatalogQueryDto) {
    return this.service.publicCatalog(
      query.entityId,
      query.limit ? Number(query.limit) : 100,
      query.offset ? Number(query.offset) : 0,
      query.search,
      query.brand,
      query.category,
    );
  }

  @Get('catalog/facets')
  @Header('Cache-Control', 'no-store')
  facets(@Query() query: B2bPriceBookEntityDto) {
    return this.service.publicCatalogFacets(query.entityId);
  }
}
