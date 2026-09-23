import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

@Injectable()
export class VendorService {
  constructor(private prisma: PrismaService) {}

  async create(entityId: string, data: CreateVendorDto) {
    return this.prisma.vendor.create({
      data: {
        entityId,
        name: data.name.trim(),
        country: data.country,
        defaultCurrency: data.defaultCurrency || 'TWD',
        taxId: data.taxId,
        contactPerson: data.contactPerson,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        address: data.address,
        isActive: data.isActive ?? true,
      },
    });
  }

  async findAll(entityId: string) {
    return this.prisma.vendor.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(entityId: string, id: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, entityId } });
    if (!vendor) {
      throw new NotFoundException(`Vendor with ID ${id} not found`);
    }
    return vendor;
  }

  async update(entityId: string, id: string, data: UpdateVendorDto) {
    await this.findOne(entityId, id);
    return this.prisma.vendor.update({
      where: { id, entityId },
      data: {
        name: data.name?.trim(),
        country: data.country,
        defaultCurrency: data.defaultCurrency,
        taxId: data.taxId,
        contactPerson: data.contactPerson,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        address: data.address,
        isActive: data.isActive,
      },
    });
  }

  async remove(entityId: string, id: string) {
    await this.findOne(entityId, id);
    // Preserve purchase orders, AP invoices and B2B account history.
    return this.prisma.vendor.update({ where: { id, entityId }, data: { isActive: false } });
  }
}
