import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** A purchasing-only projection. Customer accounts, prices and quote terms are not selected. */
@Injectable()
export class PurchaseB2bQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async shortages(entityId: string) {
    const requests = await this.prisma.b2bPurchaseRequest.findMany({
      where: { entityId, status: 'needs_adjustment' },
      select: {
        id: true,
        requestNumber: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            sku: true,
            name: true,
            quantity: true,
            confirmedQuantity: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: requests
        .map((request) => ({
          id: request.id,
          requestNumber: request.requestNumber,
          createdAt: request.createdAt,
          items: request.items
            .filter((item) => item.confirmedQuantity !== null && item.quantity > item.confirmedQuantity)
            .map((item) => ({
              requestItemId: item.id,
              sku: item.sku,
              name: item.name,
              requested: item.quantity,
              confirmed: item.confirmedQuantity!,
              shortage: item.quantity - item.confirmedQuantity!,
            })),
        }))
        .filter((request) => request.items.length > 0),
    };
  }
}
