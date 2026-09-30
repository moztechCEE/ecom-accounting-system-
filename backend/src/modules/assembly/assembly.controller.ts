import { Controller, Get, Post, Body, Param, Put, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { AssemblyService } from './assembly.service';
import { CreateAssemblyOrderDto } from './dto/create-assembly-order.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SensitiveResponseInterceptor } from '../product/sensitive-response.interceptor';

@Controller('assembly-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(new SensitiveResponseInterceptor())
export class AssemblyController {
  constructor(private readonly assemblyService: AssemblyService) {}

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  create(@Request() req, @Body() dto: CreateAssemblyOrderDto) {
    return this.assemblyService.create(req.user.entityId, req.user.userId, dto);
  }

  @Get()
  @Roles('ADMIN', 'ACCOUNTANT', 'OPERATOR')
  findAll(@Request() req) {
    return this.assemblyService.findAll(req.user.entityId);
  }

  @Get(':id')
  @Roles('ADMIN', 'ACCOUNTANT', 'OPERATOR')
  findOne(@Request() req, @Param('id') id: string) {
    return this.assemblyService.findOne(req.user.entityId, id);
  }

  @Put(':id/execute')
  @Roles('ADMIN', 'OPERATOR')
  execute(@Request() req, @Param('id') id: string) {
    return this.assemblyService.executeOrder(req.user.entityId, id);
  }
}
