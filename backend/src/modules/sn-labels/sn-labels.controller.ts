import {
  BadRequestException,
  Body,
  Controller,
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
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { resolveCompanyRead } from '../../common/entity-access/resolve-company-read';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SnLabelsService } from './sn-labels.service';
import { EXPORT_KINDS, SnLabelsExport } from './sn-labels.export';
@Controller('sn-labels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SnLabelsController {
  constructor(
    private readonly service: SnLabelsService,
    private readonly access: EntityAccessService,
    private readonly exporter: SnLabelsExport,
    private readonly db: PrismaService,
  ) {}
  private company(req: any, entityId?: string) {
    return resolveCompanyRead(this.access, req.user?.id, 'inventory', entityId);
  }
  @Get()
  @RequirePermissions({ resource: 'inventory', action: 'read' })
  async list(@Request() req, @Query() q: any) {
    return this.service.list(await this.company(req, q.entityId), q);
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
    const excel = ['warranty', 'warehouse'].includes(body.kind),
      buffer = excel
        ? this.exporter.workbook(body.kind, data, items, body.columns)
        : await this.exporter.pdf(body.kind, data, items, boxes);
    await this.service.event(
      this.db,
      entity,
      req.user.id,
      'EXPORT',
      {
        kind: body.kind,
        reason: body.reason,
        from: body.from,
        to: body.to,
        serialCount: items.length,
        cartons: boxes.map((b) => b.id),
      },
      id,
    );
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
}
