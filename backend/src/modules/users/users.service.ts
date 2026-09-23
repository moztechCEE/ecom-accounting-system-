import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { isPrivilegedRole } from '../roles/role-policy';
import {
  DataAccessModule,
  DataAccessScope,
  EntityAccessService,
  UserDataAccessContext,
} from '../../common/entity-access/entity-access.service';

const USER_INCLUDE = {
  entityMemberships: {
    orderBy: [{ isPrimary: 'desc' }, { entityId: 'asc' }],
    include: {
      entity: {
        select: {
          id: true,
          loginCode: true,
          name: true,
          isActive: true,
        },
      },
    },
  },
  roles: {
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{
  include: typeof USER_INCLUDE;
}>;

type PrismaClientOrTx = PrismaService | Prisma.TransactionClient;
/**
 * UsersService
 * 使用者服務，處理使用者相關的資料庫操作
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly SALT_ROUNDS = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entityAccessService: EntityAccessService,
  ) {}

  private normalizeDataScope(value?: string | null): DataAccessScope {
    return value === 'DEPARTMENT' || value === 'ENTITY' ? value : 'SELF';
  }

  /** API actor checks are separate from trusted employee-account provisioning. */
  async assertAccessManagementAllowed(
    actorId: string,
    change: { targetUserId?: string; roleIds?: string[]; data?: CreateUserDto | UpdateUserDto },
  ) {
    const isSuperAdmin = await this.userHasRole(actorId, 'SUPER_ADMIN');
    const scopeFields = [
      'entityIds', 'employeeDataScope', 'attendanceDataScope', 'payrollDataScope',
      'accountingDataScope', 'inventoryDataScope', 'salesDataScope', 'purchasingDataScope', 'bankingDataScope',
    ];
    if (!isSuperAdmin && change.data && scopeFields.some(key => change.data![key as keyof (CreateUserDto | UpdateUserDto)] !== undefined)) {
      throw new ForbiddenException('公司與資料範圍僅能由最高管理員設定');
    }
    if (!isSuperAdmin && change.targetUserId) {
      const links = await this.prisma.userRole.findMany({ where: { userId: change.targetUserId }, include: { role: true } });
      if (links.some(link => isPrivilegedRole(link.role))) {
        throw new ForbiddenException('管理員帳號僅能由最高管理員調整');
      }
    }
    if (change.roleIds?.length) {
      const roles = await this.prisma.role.findMany({ where: { id: { in: change.roleIds } } });
      if (roles.some(role => role.code === 'SUPER_ADMIN' || role.name === 'SUPER_ADMIN')) {
        throw new ForbiddenException('最高管理員角色不在一般帳號管理中指派');
      }
      if (!isSuperAdmin && roles.some(isPrivilegedRole)) {
        throw new ForbiddenException('管理員角色僅能由最高管理員指派');
      }
    }
  }

  private sanitizeUser(user: UserWithRelations | null) {
    if (!user) {
      return null;
    }

    const {
      passwordHash,
      passwordResetTokenHash,
      passwordResetTokenExpiresAt,
      twoFactorSecret,
      ...rest
    } = user as UserWithRelations & {
      passwordResetTokenHash?: string | null;
      passwordResetTokenExpiresAt?: Date | null;
      twoFactorSecret?: string | null;
    };
    return rest;
  }

  private sanitizeUsers(users: UserWithRelations[]) {
    return users.map((user) => this.sanitizeUser(user));
  }

  /**
   * 根據 Email 查詢使用者
   */
  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: USER_INCLUDE,
    });
  }

  /**
   * Auth 專用：根據 Email 查詢使用者（不載入 roles/permissions）
   *
   * 用途：登入/註冊只需要最小欄位（包含 passwordHash），避免因為
   * 角色/權限相關資料表尚未部署或不同步導致的 500。
   */
  async findForAuthByEmail(email: string) {
    try {
      return await this.prisma.user.findUnique({
        where: { email },
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Auth user lookup failed for email ${email}: ${err?.message ?? String(error)}`,
        err?.stack,
      );
      throw error;
    }
  }

  /**
   * Auth 專用：建立使用者（不載入 roles/permissions）
   */
  async createForAuth(data: {
    email: string;
    name: string;
    passwordHash: string;
    mustChangePassword?: boolean;
  }) {
    try {
      return await this.prisma.user.create({
        data,
      });
    } catch (error) {
      this.handlePrismaError(error, `create user with email ${data.email}`);
    }
  }

  /**
   * 根據 ID 查詢使用者
   */
  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: USER_INCLUDE,
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return this.sanitizeUser(user);
  }

  /**
   * 分頁取得使用者清單
   */
  async findAll(
    page: number,
    limit: number,
    options?: {
      requesterId?: string;
      systemAdmins?: 'exclude' | 'only' | 'include';
      search?: string;
    },
  ) {
    const skip = (page - 1) * limit;
    const requesterIsSuperAdmin = options?.requesterId
      ? await this.userHasRole(options.requesterId, 'SUPER_ADMIN')
      : false;
    const requestedSystemAdminMode = options?.systemAdmins ?? 'exclude';
    const systemAdminMode = requesterIsSuperAdmin
      ? requestedSystemAdminMode
      : 'exclude';
    const systemAdminWhere: Prisma.UserWhereInput =
      systemAdminMode === 'include'
        ? {}
        : systemAdminMode === 'only'
          ? { roles: { some: { role: { code: 'SUPER_ADMIN' } } } }
          : { roles: { none: { role: { code: 'SUPER_ADMIN' } } } };
    const search = options?.search?.trim();
    const searchWhere: Prisma.UserWhereInput | undefined = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            {
              roles: {
                some: {
                  role: {
                    OR: [
                      { code: { contains: search, mode: 'insensitive' } },
                      { name: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : undefined;
    const where: Prisma.UserWhereInput = searchWhere
      ? { AND: [systemAdminWhere, searchWhere] }
      : systemAdminWhere;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: USER_INCLUDE,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: this.sanitizeUsers(items as UserWithRelations[]),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private async userHasRole(userId: string, roleCode: string) {
    const role = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: {
          code: roleCode,
        },
      },
      select: { userId: true },
    });

    return Boolean(role);
  }

  private async ensureNoSystemAdminRoleIds(roleIds: string[]) {
    if (roleIds.length === 0) {
      return;
    }

    const systemRoles = await this.prisma.role.findMany({
      where: {
        id: { in: roleIds },
        code: 'SUPER_ADMIN',
      },
      select: { id: true },
    });

    if (systemRoles.length > 0) {
      throw new BadRequestException('最高權限角色不在一般使用者管理中指派');
    }
  }

  /**
   * 建立新使用者
   */
  async create(data: { email: string; name: string; passwordHash: string }) {
    try {
      const user = await this.prisma.user.create({
        data,
        include: USER_INCLUDE,
      });

      return this.sanitizeUser(user);
    } catch (error) {
      this.handlePrismaError(error, `create user with email ${data.email}`);
    }
  }

  /**
   * 管理員建立使用者（含角色指派）
   */
  async createUser(dto: CreateUserDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const {
      password,
      name,
      roleIds = [],
      entityIds = [],
      mustChangePassword,
      employeeDataScope,
      attendanceDataScope,
      payrollDataScope,
      accountingDataScope,
      inventoryDataScope,
      salesDataScope,
      purchasingDataScope,
      bankingDataScope,
    } = dto;

    await this.ensureNoSystemAdminRoleIds(roleIds);

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException(`Email ${normalizedEmail} already exists`);
    }

    const passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (roleIds.length > 0) {
          await this.ensureRoleIdsExist(roleIds, tx);
        }
        await this.ensureEntityIdsExist(entityIds, tx);

        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            name,
            passwordHash,
            mustChangePassword: mustChangePassword ?? false,
            employeeDataScope: this.normalizeDataScope(employeeDataScope),
            attendanceDataScope: this.normalizeDataScope(attendanceDataScope),
            payrollDataScope: this.normalizeDataScope(payrollDataScope),
            accountingDataScope: this.normalizeDataScope(accountingDataScope),
            inventoryDataScope: this.normalizeDataScope(inventoryDataScope),
            salesDataScope: this.normalizeDataScope(salesDataScope),
            purchasingDataScope: this.normalizeDataScope(purchasingDataScope),
            bankingDataScope: this.normalizeDataScope(bankingDataScope),
          },
        });

        if (roleIds.length > 0) {
          await tx.userRole.createMany({
            data: roleIds.map((roleId) => ({ userId: user.id, roleId })),
            skipDuplicates: true,
          });
        }

        if (entityIds.length > 0) {
          await tx.userEntityMembership.createMany({
            data: entityIds.map((entityId, index) => ({
              userId: user.id,
              entityId,
              isPrimary: index === 0,
            })),
            skipDuplicates: true,
          });
        }

        const created = await tx.user.findUnique({
          where: { id: user.id },
          include: USER_INCLUDE,
        });

        return this.sanitizeUser(created as UserWithRelations);
      });

      this.logger.log(`Created user ${normalizedEmail}`);
      return result;
    } catch (error) {
      this.handlePrismaError(
        error,
        `create user with email ${normalizedEmail}`,
      );
    }
  }

  /**
   * 更新使用者資訊
   */
  async updateUser(id: string, dto: UpdateUserDto) {
    if (await this.userHasRole(id, 'SUPER_ADMIN')) {
      throw new BadRequestException('最高權限帳號不在一般使用者管理中調整');
    }

    const {
      name,
      isActive,
      password,
      mustChangePassword,
      employeeDataScope,
      attendanceDataScope,
      payrollDataScope,
      accountingDataScope,
      inventoryDataScope,
      salesDataScope,
      purchasingDataScope,
      bankingDataScope,
      entityIds,
    } = dto;

    if (
      typeof name === 'undefined' &&
      typeof isActive === 'undefined' &&
      typeof password === 'undefined' &&
      typeof mustChangePassword === 'undefined' &&
      typeof employeeDataScope === 'undefined' &&
      typeof attendanceDataScope === 'undefined' &&
      typeof payrollDataScope === 'undefined' &&
      typeof accountingDataScope === 'undefined' &&
      typeof inventoryDataScope === 'undefined' &&
      typeof salesDataScope === 'undefined' &&
      typeof purchasingDataScope === 'undefined' &&
      typeof bankingDataScope === 'undefined' &&
      typeof entityIds === 'undefined'
    ) {
      throw new BadRequestException('No updates provided');
    }

    const data: Prisma.UserUpdateInput = {};

    if (typeof name !== 'undefined') {
      data.name = name;
    }

    if (typeof isActive !== 'undefined') {
      data.isActive = isActive;
    }

    if (typeof password !== 'undefined') {
      data.passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS);
    }

    if (typeof mustChangePassword !== 'undefined') {
      data.mustChangePassword = mustChangePassword;
    }
    if (typeof employeeDataScope !== 'undefined') {
      data.employeeDataScope = this.normalizeDataScope(employeeDataScope);
    }
    if (typeof attendanceDataScope !== 'undefined') {
      data.attendanceDataScope = this.normalizeDataScope(attendanceDataScope);
    }
    if (typeof payrollDataScope !== 'undefined') {
      data.payrollDataScope = this.normalizeDataScope(payrollDataScope);
    }
    if (typeof accountingDataScope !== 'undefined') {
      data.accountingDataScope = this.normalizeDataScope(accountingDataScope);
    }
    if (typeof inventoryDataScope !== 'undefined') {
      data.inventoryDataScope = this.normalizeDataScope(inventoryDataScope);
    }
    if (typeof salesDataScope !== 'undefined') {
      data.salesDataScope = this.normalizeDataScope(salesDataScope);
    }
    if (typeof purchasingDataScope !== 'undefined') {
      data.purchasingDataScope = this.normalizeDataScope(purchasingDataScope);
    }
    if (typeof bankingDataScope !== 'undefined') {
      data.bankingDataScope = this.normalizeDataScope(bankingDataScope);
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (typeof entityIds !== 'undefined') {
          await this.ensureEntityIdsExist(entityIds, tx);
        }

        await tx.user.update({ where: { id }, data });

        if (typeof entityIds !== 'undefined') {
          await tx.userEntityMembership.deleteMany({ where: { userId: id } });
          if (entityIds.length > 0) {
            await tx.userEntityMembership.createMany({
              data: entityIds.map((entityId, index) => ({
                userId: id,
                entityId,
                isPrimary: index === 0,
              })),
            });
          }
        }

        return tx.user.findUnique({
          where: { id },
          include: USER_INCLUDE,
        });
      });

      this.logger.log(`Updated user ${id}`);
      return this.sanitizeUser(updated as UserWithRelations);
    } catch (error) {
      this.handlePrismaError(error, `update user ${id}`);
    }
  }

  async updateLoginCredentials(
    id: string,
    dto: {
      email?: string;
      password?: string;
      mustChangePassword?: boolean;
    },
  ) {
    const normalizedEmail = dto.email?.trim().toLowerCase();
    const password = dto.password?.trim();

    if (
      !normalizedEmail &&
      typeof password === 'undefined' &&
      typeof dto.mustChangePassword === 'undefined'
    ) {
      throw new BadRequestException('No login credential updates provided');
    }

    const data: Prisma.UserUpdateInput = {};

    if (normalizedEmail) {
      const existing = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });

      if (existing && existing.id !== id) {
        throw new ConflictException(`Email ${normalizedEmail} already exists`);
      }

      data.email = normalizedEmail;
    }

    if (typeof password !== 'undefined') {
      if (password.length < 8) {
        throw new BadRequestException('Password must be at least 8 characters');
      }

      data.passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS);
    }

    if (typeof dto.mustChangePassword !== 'undefined') {
      data.mustChangePassword = dto.mustChangePassword;
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data,
        include: USER_INCLUDE,
      });

      this.logger.log(`Updated login credentials for user ${id}`);
      return this.sanitizeUser(updated as UserWithRelations);
    } catch (error) {
      this.handlePrismaError(error, `update login credentials for user ${id}`);
    }
  }

  /**
   * 停用使用者帳號
   */
  async deactivateUser(id: string) {
    if (await this.userHasRole(id, 'SUPER_ADMIN')) {
      throw new BadRequestException('最高權限帳號不在一般使用者管理中停用');
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data: { isActive: false },
        include: USER_INCLUDE,
      });

      this.logger.log(`Deactivated user ${id}`);
      return this.sanitizeUser(updated as UserWithRelations);
    } catch (error) {
      this.handlePrismaError(error, `deactivate user ${id}`);
    }
  }

  /**
   * 設定使用者角色
   */
  async setUserRoles(userId: string, roleIds: string[]) {
    if (await this.userHasRole(userId, 'SUPER_ADMIN')) {
      throw new BadRequestException('最高權限帳號不在一般使用者管理中調整角色');
    }

    await this.ensureNoSystemAdminRoleIds(roleIds);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        await this.ensureRoleIdsExist(roleIds, tx);

        await tx.userRole.deleteMany({ where: { userId } });

        if (roleIds.length > 0) {
          await tx.userRole.createMany({
            data: roleIds.map((roleId) => ({ userId, roleId })),
            skipDuplicates: true,
          });
        }

        const updated = await tx.user.findUnique({
          where: { id: userId },
          include: USER_INCLUDE,
        });

        return this.sanitizeUser(updated as UserWithRelations);
      });

      this.logger.log(`Updated roles for user ${userId}`);
      return result;
    } catch (error) {
      this.handlePrismaError(error, `update roles for user ${userId}`);
    }
  }

  /**
   * 更新 2FA 設定
   */
  async updateTwoFactorConfig(
    userId: string,
    secret: string,
    enabled: boolean,
  ) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorSecret: secret,
          isTwoFactorEnabled: enabled,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, `update 2fa for user ${userId}`);
    }
  }

  /**
   * 取得使用者的所有權限
   */
  async getUserPermissions(userId: string) {
    const user = await this.findById(userId);

    const permissions =
      user?.roles?.flatMap((userRole) =>
        userRole.role.permissions.map((rolePermission) => ({
          resource: rolePermission.permission.resource,
          action: rolePermission.permission.action,
        })),
      ) ?? [];

    return permissions;
  }

  async getDataAccessContext(
    userId: string,
    module: DataAccessModule,
    requestedEntityId?: string,
  ): Promise<UserDataAccessContext> {
    return this.entityAccessService.getContext(
      userId,
      module,
      requestedEntityId,
    );
  }

  /**
   * 檢查使用者是否擁有特定權限
   */
  async hasPermission(
    userId: string,
    resource: string,
    action: string,
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.some(
      (p) => p.resource === resource && p.action === action,
    );
  }

  /**
   * 為使用者指派角色
   */
  async assignRole(userId: string, roleId: string) {
    await this.ensureRoleIdsExist([roleId], this.prisma);

    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await this.prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId,
          roleId,
        },
      },
      update: {},
      create: {
        userId,
        roleId,
      },
    });

    return this.findById(userId);
  }

  async findForAuthById(id: string) {
    try {
      return await this.prisma.user.findUnique({
        where: { id },
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Auth user lookup failed for id ${id}: ${err?.message ?? String(error)}`,
        err?.stack,
      );
      throw error;
    }
  }

  async setPasswordResetToken(
    userId: string,
    passwordResetTokenHash: string,
    passwordResetTokenExpiresAt: Date,
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetTokenHash,
        passwordResetTokenExpiresAt,
      },
    });
  }

  async findByPasswordResetTokenHash(passwordResetTokenHash: string) {
    return this.prisma.user.findFirst({
      where: {
        passwordResetTokenHash,
        passwordResetTokenExpiresAt: {
          gt: new Date(),
        },
      },
    });
  }

  async updatePassword(
    userId: string,
    password: string,
    options?: {
      email?: string;
      mustChangePassword?: boolean;
      clearPasswordResetToken?: boolean;
    },
  ) {
    const data: Prisma.UserUpdateInput = {
      passwordHash: await bcrypt.hash(password, this.SALT_ROUNDS),
    };

    if (options?.email) {
      data.email = options.email;
    }

    if (typeof options?.mustChangePassword !== 'undefined') {
      data.mustChangePassword = options.mustChangePassword;
    }

    if (options?.clearPasswordResetToken) {
      data.passwordResetTokenHash = null;
      data.passwordResetTokenExpiresAt = null;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  private async ensureRoleIdsExist(roleIds: string[], db: PrismaClientOrTx) {
    if (!roleIds.length) {
      return;
    }

    const uniqueRoleIds = Array.from(new Set(roleIds));
    const roles = await db.role.findMany({
      where: { id: { in: uniqueRoleIds } },
      select: { id: true },
    });

    const foundIds = new Set(roles.map((role) => role.id));
    const missing = uniqueRoleIds.filter((id) => !foundIds.has(id));

    if (missing.length > 0) {
      throw new BadRequestException(`Roles not found: ${missing.join(', ')}`);
    }
  }

  private async ensureEntityIdsExist(
    entityIds: string[],
    db: PrismaClientOrTx,
  ) {
    if (!entityIds.length) {
      return;
    }

    const uniqueEntityIds = Array.from(new Set(entityIds));
    const entities = await db.entity.findMany({
      where: { id: { in: uniqueEntityIds }, isActive: true },
      select: { id: true },
    });
    const foundIds = new Set(entities.map((entity) => entity.id));
    const missing = uniqueEntityIds.filter((id) => !foundIds.has(id));

    if (missing.length > 0) {
      throw new BadRequestException(
        `Active companies not found: ${missing.join(', ')}`,
      );
    }
  }

  private handlePrismaError(error: unknown, context: string): never {
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          `Duplicate value detected while trying to ${context}`,
        );
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(
          `Record not found while trying to ${context}`,
        );
      }
    }

    const err = error as Error;
    this.logger.error(`Unhandled error while trying to ${context}`, err?.stack);
    throw error;
  }
}
