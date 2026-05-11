import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EntitiesRepository } from './entities.repository';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 公司實體服務
 * 處理多公司實體的商業邏輯
 */
@Injectable()
export class EntitiesService {
  constructor(
    private readonly entitiesRepository: EntitiesRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 查詢所有公司實體
   */
  async findAll(isActive?: boolean) {
    return this.entitiesRepository.findAll(isActive);
  }

  /**
   * 查詢單一公司實體
   */
  async findOne(id: string) {
    const entity = await this.entitiesRepository.findOne(id);
    if (!entity) {
      throw new NotFoundException(`Entity with ID ${id} not found`);
    }
    return entity;
  }

  /**
   * 建立新公司實體
   */
  async create(createEntityDto: CreateEntityDto) {
    const entity = await this.entitiesRepository.create(createEntityDto);
    const initialAdmin = await this.createInitialCompanyAdmin(
      entity.id,
      createEntityDto,
    );

    return {
      ...entity,
      initialAdmin,
    };
  }

  /**
   * 更新公司實體
   */
  async update(id: string, updateEntityDto: UpdateEntityDto) {
    await this.findOne(id); // 確認存在
    const entity = await this.entitiesRepository.update(id, updateEntityDto);
    const initialAdmin = await this.createInitialCompanyAdmin(id, updateEntityDto);

    return {
      ...entity,
      initialAdmin,
    };
  }

  /**
   * 刪除公司實體（軟刪除）
   */
  async remove(id: string) {
    await this.findOne(id); // 確認存在
    return this.entitiesRepository.remove(id);
  }

  /**
   * 根據代碼查詢實體
   */
  async findByCode(code: string) {
    return this.entitiesRepository.findByCode(code);
  }

  private async createInitialCompanyAdmin(
    entityId: string,
    dto: Partial<CreateEntityDto>,
  ) {
    const adminEmail = dto.adminEmail?.trim().toLowerCase();
    const adminName = dto.adminName?.trim();
    const adminPassword = dto.adminPassword?.trim();

    if (!adminEmail && !adminName && !adminPassword && !dto.adminEmployeeNo) {
      return null;
    }

    if (!adminEmail || !adminName || !adminPassword) {
      throw new BadRequestException(
        'Admin name, email and password are required when creating an initial company admin',
      );
    }

    if (adminPassword.length < 8) {
      throw new BadRequestException('Admin password must be at least 8 characters');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException(`Email ${adminEmail} already exists`);
    }

    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        country: true,
        baseCurrency: true,
      },
    });
    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    const employeeNo = dto.adminEmployeeNo?.trim() || '0001';
    const existingEmployee = await this.prisma.employee.findFirst({
      where: {
        entityId,
        employeeNo,
      },
      select: { id: true },
    });
    if (existingEmployee) {
      throw new ConflictException(
        `Employee number ${employeeNo} already exists in this company`,
      );
    }

    const [adminRole, employeeRole] = await Promise.all([
      this.prisma.role.findFirst({
        where: {
          OR: [{ code: 'ADMIN' }, { name: 'ADMIN' }],
        },
        select: { id: true },
      }),
      this.prisma.role.findFirst({
        where: {
          OR: [{ code: 'EMPLOYEE' }, { name: 'EMPLOYEE' }],
        },
        select: { id: true },
      }),
    ]);

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: adminEmail,
          name: adminName,
          passwordHash,
          mustChangePassword: true,
          employeeDataScope: 'ENTITY',
          attendanceDataScope: 'ENTITY',
          payrollDataScope: 'ENTITY',
          accountingDataScope: 'ENTITY',
          inventoryDataScope: 'ENTITY',
          salesDataScope: 'ENTITY',
          purchasingDataScope: 'ENTITY',
          bankingDataScope: 'ENTITY',
        },
      });

      const roleIds = [adminRole?.id, employeeRole?.id].filter(
        (roleId): roleId is string => Boolean(roleId),
      );
      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({
            userId: user.id,
            roleId,
          })),
          skipDuplicates: true,
        });
      }

      const employee = await tx.employee.create({
        data: {
          entityId,
          userId: user.id,
          employeeNo,
          name: adminName,
          country: entity.country,
          hireDate: new Date(),
          salaryBaseOriginal: 0,
          salaryBaseCurrency: entity.baseCurrency,
          salaryBaseFxRate: 1,
          salaryBaseBase: 0,
          isActive: true,
        },
      });

      return { user, employee };
    });

    return {
      userId: created.user.id,
      employeeId: created.employee.id,
      email: created.user.email,
      employeeNo: created.employee.employeeNo,
      mustChangePassword: true,
    };
  }
}
