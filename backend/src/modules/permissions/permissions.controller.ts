import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
@UseGuards(JwtAuthGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'read' })
  @ApiOperation({ summary: '查詢所有權限（帳號與權限管理）' })
  async findAll() {
    return this.permissionsService.findAll();
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'read' })
  @ApiOperation({ summary: '查詢指定權限（帳號與權限管理）' })
  async findOne(@Param('id') id: string) {
    return this.permissionsService.findById(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '建立權限（帳號與權限管理）' })
  async create(@Body() dto: CreatePermissionDto) {
    return this.permissionsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '更新權限（帳號與權限管理）' })
  async update(@Param('id') id: string, @Body() dto: UpdatePermissionDto) {
    return this.permissionsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '刪除權限（帳號與權限管理）' })
  async remove(@Param('id') id: string) {
    return this.permissionsService.remove(id);
  }
}
