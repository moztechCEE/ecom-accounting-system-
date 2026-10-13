import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { IntegrationSettingsService } from './integration-settings.service';
import { OperationLogsService } from './operation-logs.service';
class CompanyDto {
  @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
}
class SaveDto extends CompanyDto {
  @IsObject() data!: Record<string, unknown>;
}
class VerifyDto extends CompanyDto {
  @IsString() @MaxLength(128) id!: string;
  @IsInt() @Min(1) version!: number;
}
class InteractionDto extends CompanyDto {
  @IsArray() items!: Record<string, unknown>[];
}
class LogsDto extends CompanyDto {
  @IsOptional() @IsString() @MaxLength(20) source?: string;
  @IsOptional() @IsString() @MaxLength(40) from?: string;
  @IsOptional() @IsString() @MaxLength(40) to?: string;
  @IsOptional() @IsString() @MaxLength(1200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(20) brand?: string;
  @IsOptional() @IsString() @MaxLength(128) recordId?: string;
  @IsOptional() @IsString() @MaxLength(128) actorId?: string;
  @IsOptional() @IsString() @MaxLength(80) actionId?: string;
}
@Controller('admin/integrations')
export class IntegrationSettingsController {
  constructor(private readonly service: IntegrationSettingsService) {}
  @Header('Cache-Control', 'private, no-store')
  @Get()
  list(@Query() query: CompanyDto, @Req() request: any) {
    return this.service.list(request.user.id, query.entityId);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post()
  save(@Body() body: SaveDto, @Req() request: any) {
    return this.service.save(request.user.id, {
      ...body.data,
      entityId: body.entityId,
    });
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('verify')
  verify(@Body() body: VerifyDto, @Req() request: any) {
    return this.service.verify(
      request.user.id,
      body.entityId,
      body.id,
      body.version,
    );
  }
}
@Controller('admin/operation-logs')
export class OperationLogsController {
  constructor(private readonly service: OperationLogsService) {}
  @Header('Cache-Control', 'private, no-store')
  @Get()
  list(@Query() query: LogsDto, @Req() request: any) {
    return this.service.list(request.user.id, query);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('interactions')
  interactions(@Body() body: InteractionDto, @Req() request: any) {
    return this.service.recordInteractions(
      request.user.id,
      body.entityId,
      body.items,
    );
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('archives')
  archive(@Body() body: LogsDto, @Req() request: any) {
    return this.service.archive(request.user.id, body);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('archives/:id')
  async download(
    @Param('id') id: string,
    @Query() query: CompanyDto,
    @Req() request: any,
    @Res() response: Response,
  ) {
    const archive = await this.service.download(
      request.user.id,
      query.entityId,
      id,
    );
    response.setHeader('Content-Type', 'application/gzip');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="operation-logs-${id}.jsonl.gz"`,
    );
    response.send(archive.content);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('archives/:id/manifest')
  async manifest(
    @Param('id') id: string,
    @Query() query: CompanyDto,
    @Req() request: any,
  ) {
    return (await this.service.download(request.user.id, query.entityId, id))
      .manifest;
  }
}
