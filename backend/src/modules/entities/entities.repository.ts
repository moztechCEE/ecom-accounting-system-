import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';

/**
 * 公司實體資料存取層
 * 負責與資料庫的直接互動
 */
@Injectable()
export class EntitiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(isActive?: boolean) {
    return this.prisma.entity.findMany({
      where: isActive !== undefined ? { isActive } : undefined,
      orderBy: [{ loginCode: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    return this.prisma.entity.findUnique({
      where: { id },
    });
  }

  async findByCode(code: string) {
    return this.prisma.entity.findUnique({
      where: { loginCode: code },
    });
  }

  async create(data: CreateEntityDto) {
    const {
      adminName,
      adminEmail,
      adminEmployeeNo,
      adminPassword,
      ...entityData
    } = data;
    return this.prisma.entity.create({
      data: entityData,
    });
  }

  async update(id: string, data: UpdateEntityDto) {
    const {
      adminName,
      adminEmail,
      adminEmployeeNo,
      adminPassword,
      ...entityData
    } = data;
    return this.prisma.entity.update({
      where: { id },
      data: entityData,
    });
  }

  async remove(id: string) {
    return this.prisma.entity.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
