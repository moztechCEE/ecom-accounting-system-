import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Purchasing projection deliberately excludes password hashes and customer accounts. */
@Injectable()
export class B2bSupplierAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(entityId: string) {
    const [accounts, vendors] = await Promise.all([
      this.prisma.b2bAccount.findMany({
        where: { entityId, accountType: 'SUPPLIER' },
        select: {
          id: true,
          vendorId: true,
          email: true,
          name: true,
          isActive: true,
          createdAt: true,
          vendor: { select: { name: true } },
        },
        orderBy: [{ vendor: { name: 'asc' } }, { email: 'asc' }],
      }),
      this.prisma.vendor.findMany({
        where: { entityId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        vendorId: account.vendorId,
        vendorName: account.vendor?.name || '供應商已停用',
        email: account.email,
        name: account.name,
        isActive: account.isActive,
        createdAt: account.createdAt,
      })),
      vendors,
    };
  }
}
