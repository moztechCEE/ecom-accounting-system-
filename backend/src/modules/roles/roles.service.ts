import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { roleDeletionReason } from './role-deletion-policy';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const ROLE_INCLUDE = {
  permissions: {
    include: {
      permission: true,
    },
  },
} as const satisfies Prisma.RoleInclude;

type RoleWithRelations = Prisma.RoleGetPayload<{
  include: typeof ROLE_INCLUDE;
}>;

type PrismaClientOrTx = PrismaService | Prisma.TransactionClient;

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(actorId?: string) {
    const roles = await this.prisma.role.findMany({ orderBy: { hierarchyLevel: 'asc' }, include: { ...ROLE_INCLUDE, _count: { select: { users: true } } } });
    const superAdmin = Boolean(actorId && await this.prisma.userRole.count({ where: { userId: actorId, role: { code: 'SUPER_ADMIN' } } }));
    return roles.map(role => ({ ...role, assignedUserCount: role._count.users, deletionReason: roleDeletionReason(role.code, role._count.users, superAdmin) }));
  }

  async findById(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: ROLE_INCLUDE,
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    return role;
  }

  async create(dto: CreateRoleDto) {
    try {
      const role = await this.prisma.role.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description,
          hierarchyLevel: dto.hierarchyLevel ?? undefined,
        },
        include: ROLE_INCLUDE,
      });

      this.logger.log(`Created role ${role.code}`);
      return role;
    } catch (error) {
      this.handlePrismaError(error, `create role ${dto.code}`);
    }
  }

  async update(id: string, dto: UpdateRoleDto) {
    try {
      const role = await this.prisma.role.update({
        where: { id },
        data: {
          code: dto.code ?? undefined,
          name: dto.name ?? undefined,
          description: dto.description ?? undefined,
          hierarchyLevel: dto.hierarchyLevel ?? undefined,
        },
        include: ROLE_INCLUDE,
      });

      this.logger.log(`Updated role ${id}`);
      return role;
    } catch (error) {
      this.handlePrismaError(error, `update role ${id}`);
    }
  }

  async remove(id: string, actorId?: string) {
    return this.prisma.$transaction(async tx => {
      // Lock the role before counting assignments; concurrent FK inserts must wait.
      await tx.$queryRaw`SELECT id FROM roles WHERE id = ${id} FOR UPDATE`;
      const role = await tx.role.findUnique({ where: { id } });
      if (!role) throw new NotFoundException('角色不存在');
      const assigned = await tx.userRole.count({ where: { roleId: id } });
      const superAdmin = Boolean(actorId && await tx.userRole.count({ where: { userId: actorId, role: { code: 'SUPER_ADMIN' } } }));
      const reason = roleDeletionReason(role.code, assigned, superAdmin);
      if (reason) throw new BadRequestException(reason);
      return tx.role.delete({ where: { id }, include: ROLE_INCLUDE });
    });
  }

  async setPermissions(roleId: string, permissionIds: string[]) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const role = await tx.role.findUnique({ where: { id: roleId } });
        if (!role) {
          throw new NotFoundException(`Role with ID ${roleId} not found`);
        }

        await this.ensurePermissionIdsExist(permissionIds, tx);

        await tx.rolePermission.deleteMany({ where: { roleId } });

        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              roleId,
              permissionId,
            })),
            skipDuplicates: true,
          });
        }

        const updated = await tx.role.findUnique({
          where: { id: roleId },
          include: ROLE_INCLUDE,
        });

        return updated as RoleWithRelations;
      });

      this.logger.log(`Updated permissions for role ${roleId}`);
      return result;
    } catch (error) {
      this.handlePrismaError(error, `update permissions for role ${roleId}`);
    }
  }

  private async ensurePermissionIdsExist(
    permissionIds: string[],
    db: PrismaClientOrTx,
  ) {
    if (!permissionIds.length) {
      return;
    }

    const uniqueIds = Array.from(new Set(permissionIds));
    const permissions = await db.permission.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });

    const foundIds = new Set(permissions.map((permission) => permission.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));

    if (missing.length > 0) {
      throw new BadRequestException(
        `Permissions not found: ${missing.join(', ')}`,
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
