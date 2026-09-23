import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { CreateBomDto } from './dto/create-bom.dto';
import { ProductType } from '@prisma/client';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async create(entityId: string, dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: {
        entityId_sku: {
          entityId,
          sku: dto.sku,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`SKU「${dto.sku}」已存在，請在產品列表開啟「編輯」，補上國際條碼與 SN 建檔資料`);
    }

    try {
      return await this.prisma.product.create({ data: { entityId, ...dto,
        ...(dto.attributes?.snLabels?.modelCode?.trim().toUpperCase() === 'NSI' ? { hasSerialNumbers: false } : {}),
      } });
    } catch (e) {
      if (e?.code === 'P2002') throw new ConflictException(`SKU「${dto.sku}」已存在，請編輯既有產品`);
      throw e;
    }
  }

  async findAll(entityId: string, query?: { type?: ProductType; category?: string }) {
    return this.prisma.product.findMany({
      where: {
        entityId,
        type: query?.type,
        category: query?.category,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(entityId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, entityId },
      include: {
        bomChildren: {
          include: {
            child: true,
          },
        },
        bomParent: {
          include: {
            parent: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async update(entityId: string, id: string, dto: UpdateProductDto) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<any[]>`SELECT id,attributes FROM products WHERE id=${id} AND entity_id=${entityId} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('找不到此公司的產品');
      const old = rows[0].attributes || {}, attrs = dto.attributes;
      const attributes = attrs ? { ...old, ...attrs, ...(attrs.snLabels ? { snLabels: { ...old.snLabels, ...attrs.snLabels } } : {}) } : undefined;
      return tx.product.update({ where: { id }, data: { ...dto, attributes,
        ...(attributes?.snLabels?.modelCode?.trim().toUpperCase() === 'NSI' ? { hasSerialNumbers: false } : {}),
      } });
    });
  }

  async updateSnProfile(entityId: string, id: string, body: any) {
    if (!body || typeof body.modelNumber !== 'string' || body.modelNumber.length > 50) throw new BadRequestException('請填寫型號');
    const profile: Record<string,string> = {};
    for (const key of ['style','color','modelCode','styleCode','colorCode']) {
      if (typeof body[key] !== 'string' || body[key].length > (key.endsWith('Code') ? 6 : 50)) throw new BadRequestException('SN 建檔欄位格式錯誤');
      profile[key] = key.endsWith('Code') ? body[key].trim().toUpperCase() : body[key].trim();
      if (key.endsWith('Code') && !/^[A-Z0-9]*$/.test(profile[key])) throw new BadRequestException('代碼限英數字');
    }
    if (body.barcode !== undefined && (typeof body.barcode !== 'string' || !/^\d{8,14}$/.test(body.barcode.trim()))) throw new BadRequestException('國際條碼需為 8～14 碼數字');
    const updated = await this.prisma.$executeRaw`UPDATE products SET barcode=COALESCE(${body.barcode?.trim() ?? null},barcode), has_serial_numbers=CASE WHEN ${profile.modelCode === 'NSI'} THEN false ELSE has_serial_numbers END, attributes=jsonb_set(CASE WHEN jsonb_typeof(attributes)='object' THEN attributes ELSE '{}'::jsonb END,'{snLabels}',${JSON.stringify(profile)}::jsonb), model_number=${body.modelNumber.trim()}, updated_at=now() WHERE id=${id} AND entity_id=${entityId}`;
    if (!updated) throw new NotFoundException('Product not found');
    return this.findOne(entityId,id);
  }

  async remove(entityId: string, id: string) {
    await this.findOne(entityId, id); // Ensure exists
    return this.prisma.product.delete({ where: { id } });
  }

  // BOM Management
  async addBomComponent(entityId: string, parentId: string, dto: CreateBomDto) {
    const parent = await this.findOne(entityId, parentId);
    
    if (parent.type === ProductType.SIMPLE) {
      throw new ConflictException('Cannot add BOM to a SIMPLE product. Change type to BUNDLE or MANUFACTURED first.');
    }

    const child = await this.prisma.product.findUnique({
      where: {
        entityId_sku: {
          entityId,
          sku: dto.childSku,
        },
      },
    });

    if (!child) {
      throw new NotFoundException(`Child product with SKU ${dto.childSku} not found`);
    }

    if (parent.id === child.id) {
      throw new ConflictException('Cannot add product as its own component');
    }

    // Check if already exists
    const existingBom = await this.prisma.billOfMaterial.findUnique({
      where: {
        parentId_childId: {
          parentId,
          childId: child.id,
        },
      },
    });

    if (existingBom) {
      return this.prisma.billOfMaterial.update({
        where: { id: existingBom.id },
        data: {
          quantity: dto.quantity,
          notes: dto.notes,
        },
      });
    }

    return this.prisma.billOfMaterial.create({
      data: {
        entityId,
        parentId,
        childId: child.id,
        quantity: dto.quantity,
        notes: dto.notes,
      },
    });
  }

  async removeBomComponent(entityId: string, parentId: string, childId: string) {
    // Verify ownership
    const bom = await this.prisma.billOfMaterial.findFirst({
      where: {
        entityId,
        parentId,
        childId,
      },
    });

    if (!bom) {
      throw new NotFoundException('BOM component not found');
    }

    return this.prisma.billOfMaterial.delete({
      where: { id: bom.id },
    });
  }
}
