import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { NotificationGateway } from './notification.gateway';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationGateway,
  ) {}

  // Persist under the caller's transaction. Push only after its durable cursor commits.
  async createDeferred(
    tx: Prisma.TransactionClient,
    data: Prisma.NotificationUncheckedCreateInput,
  ) {
    return tx.notification.create({ data });
  }
  publishPersisted(notifications: Array<{ userId: string }>) {
    for (const notification of notifications) {
      try {
        this.gateway.sendToUser(notification.userId, notification);
      } catch {
        /* The persisted unread notification remains available after reconnect. */
      }
    }
  }

  async create(data: Prisma.NotificationUncheckedCreateInput) {
    const notification = await this.prisma.notification.create({
      data,
    });

    // Real-time push
    this.gateway.sendToUser(data.userId, notification);

    return notification;
  }

  async findAll(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }
}
