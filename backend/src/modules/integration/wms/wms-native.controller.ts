import {
  All,
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { WMS_NATIVE_ENTRIES } from './wms-native.contract';
import { WmsNativeService } from './wms-native.service';

export class WmsNativeSessionDto {
  @IsIn(WMS_NATIVE_ENTRIES) entry!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) nonce!: string;
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,128}$/)
  entityId?: string;
}
type ActorRequest = RawBodyRequest<Request> & { user: { id: string } };

@Controller('wms/native')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions({ resource: 'wms_tasks', action: 'read' })
export class WmsNativeController {
  constructor(private readonly service: WmsNativeService) {}
  @Post('session')
  @Header('Cache-Control', 'private, no-store')
  session(
    @Req() req: ActorRequest,
    @Headers('x-wms-entity') entity: string,
    @Body() dto: WmsNativeSessionDto,
  ) {
    return this.service.session(req.user.id, entity, dto);
  }
  @All('proxy/*path')
  async proxy(
    @Req() req: ActorRequest,
    @Res() res: Response,
    @Headers('x-wms-entity') entity: string,
    @Headers('x-wms-session') token: string,
  ) {
    const marker = '/wms/native/proxy/',
      start = req.originalUrl.indexOf(marker);
    if (start < 0) throw new BadRequestException('WMS_NATIVE_PATH_INVALID');
    const target = '/' + req.originalUrl.slice(start + marker.length);
    // rawBody preserves JSON command UUIDs, state/revision fields and formatting.
    // The scoped raw parser installed before JSON parsing handles multipart bytes.
    const body = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    const abort = this.abort(req, res);
    try {
      const reply = await this.service.proxy(req.user.id, entity, token, {
        target,
        method: req.method,
        body,
        signal: abort.signal,
        contentType: req.get('content-type'),
        accept: req.get('accept'),
        etag: req.get('if-none-match'),
      });
      res.status(reply.status).set(reply.headers).send(reply.body);
    } finally {
      abort.cleanup();
    }
  }
  @Post('files/:id/:kind')
  async file(
    @Req() req: ActorRequest,
    @Res() res: Response,
    @Headers('x-wms-entity') entity: string,
    @Headers('x-wms-session') token: string,
    @Param('id') id: string,
    @Param('kind') kind: string,
  ) {
    const abort = this.abort(req, res);
    try {
      const reply = await this.service.file(
        req.user.id,
        entity,
        token,
        id,
        kind,
        abort.signal,
      );
      res.status(reply.status).set(reply.headers).send(reply.body);
    } finally {
      abort.cleanup();
    }
  }
  private abort(req: Request, res: Response) {
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', cancel);
    res.once('close', cancel);
    return {
      signal: controller.signal,
      cleanup: () => {
        req.off('aborted', cancel);
        res.off('close', cancel);
      },
    };
  }
}
