import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Permission, Role } from '@prisma/client';

@Injectable()
export class SeederService implements OnModuleInit {
  private readonly logger = new Logger(SeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log('Checking database seed status...');
    await this.seed();
  }

  async seed() {
    try {
      // 1. Create Entities
      await this.createEntities();

      // 2. Create Roles and Permissions
      const roles = await this.createRolesAndPermissions();

      // 3. Create Departments
      await this.createDepartments();

      // 4. Create Admin User
      await this.createAdminUser(roles);

      this.logger.log('✅ Database seeding completed successfully.');
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `❌ Database seeding failed: ${err?.message ?? String(error)}`,
        err?.stack,
      );
    }
  }

  private async createEntities() {
    await this.prisma.entity.upsert({
      where: { id: 'tw-entity-001' },
      update: {},
      create: {
        id: 'tw-entity-001',
        loginCode: '900324',
        name: '台灣公司',
        country: 'TW',
        baseCurrency: 'TWD',
        taxId: '12345678',
        address: '台北市信義區信義路五段7號',
        contactEmail: 'taiwan@company.com',
        contactPhone: '+886-2-2345-6789',
      },
    });

    await this.prisma.entity.upsert({
      where: { id: 'cn-entity-001' },
      update: {},
      create: {
        id: 'cn-entity-001',
        loginCode: '900325',
        name: '大陸公司',
        country: 'CN',
        baseCurrency: 'CNY',
        taxId: '91110000000000000X',
        address: '上海市浦東新區陸家嘴環路1000號',
        contactEmail: 'china@company.com',
        contactPhone: '+86-21-1234-5678',
      },
    });
  }

  private async createRolesAndPermissions(): Promise<Record<string, Role>> {
    // Create Permissions (Simplified for critical ones)
    const resources = [
      'users',
      'accounts',
      'journal_entries',
      'sales_orders',
      'reconciliation_timeout',
    ];
    const actions = ['read', 'create', 'update', 'delete', 'approve'];

    const permissions: Permission[] = [];
    for (const resource of resources) {
      for (const action of actions) {
        const permission = await this.prisma.permission.upsert({
          where: { resource_action: { resource, action } },
          update: {},
          create: {
            resource,
            action,
            description: `${action} ${resource}`,
          },
        });
        permissions.push(permission);
      }
    }

    const roleDefinitions = [
      {
        code: 'SUPER_ADMIN',
        name: 'SUPER_ADMIN',
        description: '最高管理員，擁有完整系統權限',
        hierarchyLevel: 1,
        permissions: 'ALL' as const,
      },
      {
        code: 'ADMIN',
        name: 'ADMIN',
        description: '公司管理員，可管理大部分模組',
        hierarchyLevel: 2,
        permissions: 'ALL' as const,
      },
      {
        code: 'ACCOUNTANT',
        name: 'ACCOUNTANT',
        description: '財會部門成員，可處理會計與報表作業',
        hierarchyLevel: 3,
        permissions: [
          'accounts:read',
          'journal_entries:read',
          'journal_entries:create',
          'journal_entries:approve',
          'sales_orders:read',
          'reconciliation_timeout:read',
        ],
      },
      {
        code: 'CUSTOMER_SERVICE',
        name: 'CUSTOMER_SERVICE',
        description: '客服部門成員，可處理超時對帳與付款連結通知',
        hierarchyLevel: 4,
        permissions: [
          'sales_orders:read',
          'reconciliation_timeout:read',
          'reconciliation_timeout:update',
        ],
      },
      {
        code: 'OPERATOR',
        name: 'OPERATOR',
        description: '一般操作成員，可進行基礎作業',
        hierarchyLevel: 5,
        permissions: ['sales_orders:read', 'sales_orders:create'],
      },
    ];

    const roles: Record<string, Role> = {};

    for (const roleDef of roleDefinitions) {
      const role = await this.prisma.role.upsert({
        where: { code: roleDef.code },
        update: {
          name: roleDef.name,
          description: roleDef.description,
          hierarchyLevel: roleDef.hierarchyLevel,
        },
        create: {
          code: roleDef.code,
          name: roleDef.name,
          description: roleDef.description,
          hierarchyLevel: roleDef.hierarchyLevel,
        },
      });

      roles[roleDef.code] = role;
    }

    const permissionIndex = new Map(
      permissions.map((permission) => [
        `${permission.resource}:${permission.action}`,
        permission,
      ]),
    );

    for (const roleDef of roleDefinitions) {
      const role = roles[roleDef.code];
      if (!role) {
        continue;
      }

      const targetPermissions =
        roleDef.permissions === 'ALL'
          ? permissions
          : roleDef.permissions
              .map((key) => permissionIndex.get(key))
              .filter(
                (permission): permission is (typeof permissions)[number] =>
                  Boolean(permission),
              );

      for (const permission of targetPermissions) {
        await this.prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId: permission.id,
          },
        });
      }
    }

    return roles;
  }

  private async createDepartments() {
    const departmentTemplates = [
      { key: 'mgmt', name: '管理部' },
      { key: 'procurement', name: '採購部' },
      { key: 'logistics', name: '儲運部' },
      { key: 'product', name: '產品部' },
      { key: 'design', name: '設計部' },
      { key: 'customer-success', name: '客服部' },
      { key: 'finance', name: '財會部' },
    ];

    const entities = await this.prisma.entity.findMany();

    for (const entity of entities) {
      for (const template of departmentTemplates) {
        await this.prisma.department.upsert({
          where: { id: `${entity.id}-${template.key}` },
          update: {
            name: template.name,
            isActive: true,
          },
          create: {
            id: `${entity.id}-${template.key}`,
            entityId: entity.id,
            name: template.name,
          },
        });
      }
    }
  }

  private async createAdminUser(roles: Record<string, Role>) {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    const name = process.env.SUPER_ADMIN_NAME ?? '系統管理員';

    if (!email || !password) {
      this.logger.warn(
        'Skipping admin user seeding because SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD is not set. Please configure these environment variables to seed the super admin account.',
      );
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        passwordHash, // Ensure password is updated
        name,
        isActive: true,
      },
      create: {
        email,
        name,
        passwordHash,
        isActive: true,
      },
    });

    const superAdminRole = roles['SUPER_ADMIN'];
    const adminRole = roles['ADMIN'];

    if (superAdminRole) {
      await this.prisma.userRole.upsert({
        where: {
          userId_roleId: {
            userId: user.id,
            roleId: superAdminRole.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          roleId: superAdminRole.id,
        },
      });
    }

    if (adminRole) {
      await this.prisma.userRole.upsert({
        where: {
          userId_roleId: {
            userId: user.id,
            roleId: adminRole.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          roleId: adminRole.id,
        },
      });
    }

    this.logger.log(`Admin user ensured: ${email} (${name})`);
  }
}
