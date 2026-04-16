import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type AuditPayload = {
  userId?: string | null;
  tableName: string;
  recordId: string;
  action: string;
  oldData?: unknown;
  newData?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(payload: AuditPayload) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: payload.userId || null,
          tableName: payload.tableName,
          recordId: payload.recordId,
          action: payload.action,
          oldData: this.toJsonInput(payload.oldData),
          newData: this.toJsonInput(payload.newData),
          ipAddress: payload.ipAddress || null,
          userAgent: payload.userAgent || null,
        },
      });
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Failed to write audit log for ${payload.tableName}:${payload.recordId} - ${err?.message ?? String(error)}`,
      );
    }
  }

  async listByRecord(tableName: string, recordId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        tableName,
        recordId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  private toJsonInput(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) {
      return undefined;
    }

    const normalized = this.normalize(value);
    if (normalized === null) {
      return Prisma.JsonNull;
    }

    return normalized as Prisma.InputJsonValue;
  }

  private normalize(value: unknown): unknown {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toNumber' in value &&
      typeof (value as { toNumber?: unknown }).toNumber === 'function'
    ) {
      return Number((value as { toNumber: () => number }).toNumber());
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => this.normalize(item))
        .filter((item) => item !== undefined);
    }

    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([key, nestedValue]) => [key, this.normalize(nestedValue)])
          .filter(([, nestedValue]) => nestedValue !== undefined),
      );
    }

    return value;
  }
}
