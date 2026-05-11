import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { EntitiesService } from './entities.service';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';

/**
 * 公司實體控制器
 * 管理多公司實體（台灣公司、大陸公司等）
 */
@ApiTags('entities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('entities')
export class EntitiesController {
  constructor(private readonly entitiesService: EntitiesService) {}

  @Get()
  @ApiOperation({ summary: '查詢所有公司實體' })
  @ApiResponse({ status: 200, description: '成功取得實體列表' })
  async findAll(@Query('isActive') isActive?: string) {
    const activeFilter = isActive === undefined ? undefined : isActive === 'true';
    return this.entitiesService.findAll(activeFilter);
  }

  @Get(':id')
  @ApiOperation({ summary: '查詢單一公司實體' })
  @ApiResponse({ status: 200, description: '成功取得實體詳情' })
  @ApiResponse({ status: 404, description: '實體不存在' })
  async findOne(@Param('id') id: string) {
    return this.entitiesService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '建立新公司實體' })
  @ApiResponse({ status: 201, description: '實體建立成功' })
  async create(@Body() createEntityDto: CreateEntityDto) {
    return this.entitiesService.create(createEntityDto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '更新公司實體' })
  @ApiResponse({ status: 200, description: '實體更新成功' })
  async update(
    @Param('id') id: string,
    @Body() updateEntityDto: UpdateEntityDto,
  ) {
    return this.entitiesService.update(id, updateEntityDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '刪除公司實體' })
  @ApiResponse({ status: 200, description: '實體刪除成功' })
  async remove(@Param('id') id: string) {
    return this.entitiesService.remove(id);
  }
}
