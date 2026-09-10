import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Max,
  Min,
  Matches,
} from 'class-validator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { EntityAccessGuard } from '../../../common/guards/entity-access.guard';
import { RequireEntityAccess } from '../../../common/decorators/entity-access.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AfterSalesSourceGuard } from './after-sales-source.guard';
import { AfterSalesPreparationService } from './after-sales-preparation.service';

export class PreparationEntityDto {
  @IsString() @IsNotEmpty() entityId!: string;
}
export class SaveBrandDto extends PreparationEntityDto {
  @IsInt() @Min(0) @Max(2147483646) version!: number;
  @IsObject() data!: Record<string, unknown>;
}
export class SaveQuoteDraftDto extends PreparationEntityDto {
  @IsUUID('4') requestKey!: string;
  @IsObject() data!: Record<string, unknown>;
}
export class CaseBrandDto extends PreparationEntityDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,128}$/) sourceCaseId!: string;
}
@Controller('after-sales/preparation')
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
  PermissionsGuard,
  EntityAccessGuard,
  AfterSalesSourceGuard,
)
@RequireEntityAccess('sales')
@RequirePermissions({ resource: 'after_sales_cases', action: 'read' })
export class AfterSalesPreparationController {
  constructor(private readonly service: AfterSalesPreparationService) {}
  @Get('brands')
  @Header('Cache-Control', 'private, no-store')
  brands(@Query() query: PreparationEntityDto) {
    return this.service.brands(query.entityId);
  }
  @Post('brands')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Header('Cache-Control', 'private, no-store')
  saveBrand(@Body() body: SaveBrandDto, @Req() req: { user: { id: string } }) {
    return this.service.saveBrand(
      body.entityId,
      req.user.id,
      body.version,
      body.data,
    );
  }
  @Get('quote-drafts')
  @Header('Cache-Control', 'private, no-store')
  drafts(@Query() query: PreparationEntityDto) {
    return this.service.drafts(query.entityId);
  }
  @Get('case-brand')
  @Header('Cache-Control', 'private, no-store')
  caseBrand(@Query() query: CaseBrandDto) {
    return this.service.caseBrand(query.entityId, query.sourceCaseId);
  }
  @Post('quote-drafts')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions(
    { resource: 'after_sales_cases', action: 'read' },
    { resource: 'after_sales_cases', action: 'create' },
  )
  saveDraft(
    @Body() body: SaveQuoteDraftDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.service.saveDraft(
      body.entityId,
      req.user.id,
      body.requestKey,
      body.data,
    );
  }
}
