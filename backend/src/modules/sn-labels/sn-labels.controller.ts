import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { resolveCompanyRead } from '../../common/entity-access/resolve-company-read';
import { SnLabelsService } from './sn-labels.service';
import { EXPORT_KINDS, SnLabelsExport } from './sn-labels.export';
import { SnLabelBatchReviewService } from './sn-label-batch-review';
@Controller('sn-labels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SnLabelsController {
  constructor(
    private readonly service: SnLabelsService,
    private readonly access: EntityAccessService,
    private readonly exporter: SnLabelsExport,
    private readonly reviews: SnLabelBatchReviewService,
  ) {}
  private company(req: any, entityId?: string) {
    return resolveCompanyRead(this.access, req.user?.id, 'inventory', entityId);
  }
  @Get()
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  async list(@Request() req, @Query() q: any) {
    return this.service.list(await this.company(req, q.entityId), q);
  }
  @Post('preview')
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  async preview(
    @Request() req,
    @Body() body: any,
    @Query('entityId') e?: string,
  ) {
    return this.service.preview(
      await this.company(req, e),
      body?.data,
      body?.page,
    );
  }
  @Delete('drafts/:id')
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async remove(
    @Request() req,
    @Param('id') id: string,
    @Body() body: any,
    @Query('entityId') e?: string,
  ) {
    return this.service.remove(
      await this.company(req, e),
      req.user.id,
      id,
      body?.revision,
    );
  }
  @Put('drafts/:id')
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async save(
    @Request() req,
    @Param('id') id: string,
    @Body() body: any,
    @Query('entityId') e?: string,
  ) {
    return this.service.save(await this.company(req, e), req.user.id, id, body);
  }
  @Post('drafts/:id/activate')
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async activate(
    @Request() req,
    @Param('id') id: string,
    @Body() body: any,
    @Query('entityId') e?: string,
  ) {
    return this.service.activate(
      await this.company(req, e),
      req.user.id,
      id,
      body?.revision,
      body?.previewToken,
    );
  }
  @Get('batches/:id')
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  async detail(
    @Request() req,
    @Param('id') id: string,
    @Query('entityId') e?: string,
    @Query('page') page?: string,
  ) {
    return this.service.detail(
      await this.company(req, e),
      id,
      Number(page) || 1,
    );
  }
  @Post('batches/:id/export')
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async export(
    @Request() req,
    @Param('id') id: string,
    @Body() body: any,
    @Res() res: Response,
    @Query('entityId') e?: string,
  ) {
    if (
      !EXPORT_KINDS.includes(body?.kind) ||
      !['initial', 'missed', 'damaged', 'copy'].includes(body?.reason)
    )
      throw new BadRequestException('請選擇輸出類型與列印原因');
    const entity = await this.company(req, e),
      { data, items, boxes } = await this.service.exportData(
        entity,
        id,
        body.from,
        body.to,
        body.kind,
      );
    const excel = ['warranty', 'warehouse', 'warehouse-cartons'].includes(body.kind);
    const buffer = body.kind === 'warehouse-cartons'
      ? this.exporter.warehouseCartons(data, boxes, id)
      : excel
        ? this.exporter.workbook(body.kind, data, items, body.columns)
        : await this.exporter.pdf(body.kind, data, items, boxes);
    await this.reviews.recordOutput(entity, req.user.id, id, {
      kind: body.kind,
      reason: body.reason,
      from: body.from,
      to: body.to,
      serialCount: body.kind === 'warehouse-cartons'
        ? boxes.reduce((count, box) => count + box.serials.length, 0)
        : items.length,
      cartons: boxes.map((b) => b.id),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Type',
      excel
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="SN-${body.kind}-${id}.${excel ? 'xlsx' : 'pdf'}"`,
    );
    res.send(buffer);
  }
  @Post('batches/:id/reversion')
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async requestReversion(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: unknown,
    @Query('entityId') e?: string,
  ) {
    return this.reviews.returnToDraft(
      await this.company(req, e),
      req.user.id,
      id,
      body,
    );
  }
  @Post('batches/:id/reversion/:reviewId/decision')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequirePermissions({ resource: 'inventory', action: 'update' })
  async decideReversion(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
    @Body() body: unknown,
    @Query('entityId') e?: string,
  ) {
    return this.reviews.decide(
      await this.company(req, e),
      req.user.id,
      id,
      reviewId,
      body,
    );
  }
}
