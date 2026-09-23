import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { EntityAccessGuard } from '../../common/guards/entity-access.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireEntityAccess } from '../../common/decorators/entity-access.decorator';
import { B2bLogin, B2bSession } from './b2b-auth.guard';
import { B2bService } from './b2b.service';
import type { B2bIdentity } from './b2b.service';
import {
  B2bAccountDto,
  B2bAccountUpdateDto,
  B2bCatalogDto,
  B2bConfirmDto,
  B2bEntityDto,
  B2bIssueQuoteDto,
  B2bWithdrawQuoteDto,
  B2bLoginDto,
  B2bPriceDto,
  B2bProductOptionsDto,
  B2bRequestDto,
  B2bReviewDto,
  B2bSupplierAccountDto,
} from './b2b.dto';

type CustomerRequest = { b2b: B2bIdentity };
type StaffRequest = { user: { id: string } };
@Controller('b2b/portal')
@B2bSession()
export class B2bPortalController {
  constructor(private readonly service: B2bService) {}
  @Post('login')
  @B2bLogin()
  @Header('Cache-Control', 'no-store')
  login(@Body() dto: B2bLoginDto) {
    return this.service.login(dto);
  }
  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Req() req: CustomerRequest) {
    const { tokenHash, ...profile } = req.b2b;
    return profile;
  }
  @Post('logout')
  @Header('Cache-Control', 'no-store')
  logout(@Req() req: CustomerRequest) {
    return this.service.logout(req.b2b);
  }
  @Get('catalog')
  @Header('Cache-Control', 'no-store')
  catalog(@Req() req: CustomerRequest) {
    return this.service.catalog(req.b2b);
  }
  @Post('requests')
  @Header('Cache-Control', 'no-store')
  submit(@Req() req: CustomerRequest, @Body() dto: B2bRequestDto) {
    return this.service.submit(req.b2b, dto);
  }
  @Get('requests')
  @Header('Cache-Control', 'no-store')
  requests(@Req() req: CustomerRequest) {
    return this.service.requests(req.b2b.entityId, req.b2b.customerId);
  }
  @Get('requests/:id')
  @Header('Cache-Control', 'no-store')
  detail(
    @Req() req: CustomerRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.detail(req.b2b, id);
  }
  @Get('requests/:id/quotes/:version')
  @Header('Cache-Control', 'no-store')
  formalQuote(
    @Req() req: CustomerRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.service.formalQuote(req.b2b, id, version);
  }
  @Post('requests/:id/quotes/:version/accept')
  @Header('Cache-Control', 'no-store')
  acceptQuote(
    @Req() req: CustomerRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.service.acceptQuote(req.b2b, id, version);
  }
}
@Controller('b2b/admin')
@UseGuards(PermissionsGuard, EntityAccessGuard)
@RequireEntityAccess('sales')
@RequirePermissions({ resource: 'sales_orders', action: 'read' })
export class B2bAdminController {
  constructor(private readonly service: B2bService) {}
  @Get('setup')
  @Header('Cache-Control', 'no-store')
  setup(@Query() query: B2bEntityDto) {
    return this.service.setup(query.entityId);
  }
  @Get('product-options')
  @Header('Cache-Control', 'no-store')
  productOptions(@Query() query: B2bProductOptionsDto) {
    return this.service.productOptions(query.entityId, query.search, query.limit);
  }
  @Post('accounts')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  createAccount(@Body() dto: B2bAccountDto, @Req() req: StaffRequest) {
    return this.service.createAccount(dto, req.user.id);
  }
  @Post('supplier-accounts')
  @RequireEntityAccess('purchasing')
  @RequirePermissions({ resource: 'purchase_orders', action: 'create' })
  createSupplierAccount(
    @Body() dto: B2bSupplierAccountDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.createSupplierAccount(dto, req.user.id);
  }
  @Patch('accounts/:id')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  updateAccount(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: B2bAccountUpdateDto,
  ) {
    return this.service.updateAccount(id, dto);
  }
  @Patch('supplier-accounts/:id')
  @RequireEntityAccess('purchasing')
  @RequirePermissions({ resource: 'purchase_orders', action: 'create' })
  updateSupplierAccount(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: B2bAccountUpdateDto,
  ) {
    return this.service.updateAccount(id, dto, 'SUPPLIER');
  }
  @Put('catalog')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  catalog(@Body() dto: B2bCatalogDto, @Req() req: StaffRequest) {
    return this.service.setCatalog(dto, req.user.id);
  }
  @Put('prices')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  price(@Body() dto: B2bPriceDto, @Req() req: StaffRequest) {
    return this.service.setPrice(dto, req.user.id);
  }
  @Get('requests')
  @Header('Cache-Control', 'no-store')
  requests(@Query() query: B2bEntityDto) {
    return this.service.requests(query.entityId);
  }
  @Post('requests/:id/review')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  review(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: B2bReviewDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.review(id, dto, req.user.id);
  }

  @Post('requests/:id/quotes')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  issueQuote(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: B2bIssueQuoteDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.issueQuote(id, dto, req.user.id);
  }

  @Post('requests/:id/quotes/:version/withdraw')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  withdrawQuote(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: B2bWithdrawQuoteDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.withdrawQuote(id, version, dto, req.user.id);
  }

  @Post('requests/:id/confirm')
  @RequirePermissions({ resource: 'sales_orders', action: 'create' })
  confirm(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: B2bConfirmDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.confirm(id, dto, req.user.id);
  }
}
