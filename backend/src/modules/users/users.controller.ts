import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

/**
 * UsersController
 * 使用者控制器
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * 取得當前使用者資訊
   */
  @Get('me')
  @ApiOperation({ summary: '取得當前使用者資訊' })
  async getCurrentUser(@CurrentUser('id') userId: string) {
    return this.usersService.findById(userId);
  }

  /**
   * 取得當前使用者的權限
   */
  @Get('me/permissions')
  @ApiOperation({ summary: '取得當前使用者的權限' })
  async getMyPermissions(@CurrentUser('id') userId: string) {
    return this.usersService.getUserPermissions(userId);
  }

  /**
   * 取得使用者列表（帳號與權限管理）
   */
  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'read' })
  @ApiOperation({ summary: '查詢所有使用者（帳號與權限管理）' })
  async listUsers(@Query('page') page = '1', @Query('limit') limit = '25') {
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNumber = Math.min(
      100,
      Math.max(1, Number.parseInt(limit, 10) || 25),
    );

    return this.usersService.findAll(pageNumber, limitNumber);
  }

  /**
   * 查詢單一使用者（帳號與權限管理）
   */
  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'read' })
  @ApiOperation({ summary: '查詢指定使用者（帳號與權限管理）' })
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  /**
   * 建立新使用者（帳號與權限管理）
   */
  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '建立新使用者（帳號與權限管理）' })
  async createUser(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }

  /**
   * 更新使用者（帳號與權限管理）
   */
  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '更新使用者資訊（帳號與權限管理）' })
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateUser(id, dto);
  }

  /**
   * 設定使用者角色（帳號與權限管理）
   */
  @Put(':id/roles')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '設定使用者角色（帳號與權限管理）' })
  async setRoles(@Param('id') id: string, @Body() dto: SetUserRolesDto) {
    return this.usersService.setUserRoles(id, dto.roleIds);
  }

  /**
   * 停用使用者（帳號與權限管理）
   */
  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions({ resource: 'access_control', action: 'update' })
  @ApiOperation({ summary: '停用使用者帳號（帳號與權限管理）' })
  async deactivate(@Param('id') id: string) {
    return this.usersService.deactivateUser(id);
  }
}
