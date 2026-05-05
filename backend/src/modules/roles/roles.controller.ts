import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'read' })
  @ApiOperation({ summary: '查詢所有角色（帳號與權限管理）' })
  async findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'read' })
  @ApiOperation({ summary: '查詢指定角色（帳號與權限管理）' })
  async findOne(@Param('id') id: string) {
    return this.rolesService.findById(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '建立角色（帳號與權限管理）' })
  async create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '更新角色（帳號與權限管理）' })
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '刪除角色（帳號與權限管理）' })
  async remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }

  @Put(':id/permissions')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '設定角色權限（帳號與權限管理）' })
  async setPermissions(
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rolesService.setPermissions(id, dto.permissionIds);
  }
}
