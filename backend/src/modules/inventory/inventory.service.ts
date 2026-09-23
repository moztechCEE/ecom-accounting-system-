import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma, ProductType } from '@prisma/client';
import * as XLSX from 'xlsx';

interface CreateWarehouseInput {
  entityId: string;
  code: string;
  name: string;
  type?: string;
}

interface AdjustStockInput {
  entityId: string;
  warehouseId: string;
  productId: string;
  quantity: Prisma.Decimal | number; // 正數: IN, 負數: OUT
  direction: 'IN' | 'OUT' | 'ADJUST';
  referenceType: string; // PURCHASE_ORDER, SALES_ORDER, ADJUSTMENT 等
  referenceId?: string;
  reason?: string;
  occurredAt?: Date;
}

interface ReserveStockInput {
  entityId: string;
  warehouseId: string;
  productId: string;
  quantity: Prisma.Decimal | number;
  referenceType: 'SALES_ORDER';
  referenceId: string;
}

interface ShipStockInput extends ReserveStockInput {
  reason?: string;
}

type ImportRow = {
  barcode: string;
  name: string;
  warehouseCode: string;
  warehouseName: string;
  serialNumber?: string;
  quantity: number;
};

type ImportProductCache = {
  id: string;
  name: string;
  hasSerialNumbers: boolean;
};

type ParsedImportMeta = {
  format: 'csv' | 'excel';
  headers: string[];
  sheet?: string;
  availableSheets?: string[];
};

type ParsedImportDebug = {
  accepted: number;
  rejected: number;
  reasons: {
    missingBarcode: number;
    missingWarehouse: number;
  };
  sampleRejected?: {
    keys: string[];
    barcodeCandidate?: string;
    warehouseCodeCandidate?: string;
    warehouseNameCandidate?: string;
  };
};

type ParsedImport = {
  rows: ImportRow[];
  rawRows: number;
  meta: ParsedImportMeta;
  debug: ParsedImportDebug;
};

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private pick(row: Record<string, any>, keys: string[]): any {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
  }

  private toNumber(value: any, defaultValue = 0): number {
    if (value === undefined || value === null || value === '') return defaultValue;
    const n = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : defaultValue;
  }

  private normalizeHeaderKey(key: string): string {
    return String(key || '').trim();
  }

  private normalizeWarehouseCode(value: string): string {
    return String(value || '').trim();
  }

  private parseRowsFromRecords(
    raw: Array<Record<string, any>>,
  ): { rows: ImportRow[]; rawRows: number; debug: ParsedImportDebug } {
    let missingBarcode = 0;
    let missingWarehouse = 0;
    let sampleRejected: ParsedImportDebug['sampleRejected'] | undefined;

    const mapped: Array<ImportRow | null> = raw.map((r) => {
        const row: Record<string, any> = {};
        for (const [k, v] of Object.entries(r)) {
          row[this.normalizeHeaderKey(k)] = v;
        }

        const barcode = String(
          this.pick(row, [
            '品項編碼',
            '品項代碼',
            '商品編碼',
            '商品代碼',
            '料號',
            'SKU',
            'sku',
            '國際條碼',
            '國際碼',
            '條碼',
            '商品條碼',
            '品項條碼',
            'Barcode',
            'barcode',
            'EAN',
            'EAN13',
            'UPC',
          ]) ?? '',
        ).trim();
        const name = String(this.pick(row, ['品項名稱', '品名', '商品名稱', '名稱', 'name']) ?? '').trim();

        const warehouseLocation = String(
          this.pick(row, [
            '工業店',
            '店別',
            '店別名稱',
            '倉庫位置',
            '倉庫位置名稱',
            '庫位',
            '倉庫',
            '倉別',
            '庫別',
            'warehouse',
            'location',
          ]) ?? '',
        ).trim();
        const rawWarehouseCode = String(
          this.pick(row, [
            '倉庫工廠編碼',
            '工廠編碼',
            '倉庫編碼',
            '倉庫代碼',
            '倉別代碼',
            '庫別代碼',
            '店別代碼',
            'warehouseCode',
            'warehouse_code',
          ]) ?? '',
        ).trim();
        const rawWarehouseName = String(
          this.pick(row, [
            '倉庫工廠名稱',
            '工廠名稱',
            '倉庫名稱',
            '倉別名稱',
            '庫別名稱',
            '店別名稱',
            'warehouseName',
            'warehouse_name',
          ]) ?? '',
        ).trim();

        const warehouseName = (rawWarehouseName || warehouseLocation || rawWarehouseCode || '').trim();
        const warehouseCode = this.normalizeWarehouseCode(
          (rawWarehouseCode || warehouseLocation || rawWarehouseName || '').trim(),
        );

        const serialNumberRaw = this.pick(row, [
          '序號/批號',
          '序號',
          '批號',
          'SN',
          'sn',
          'serialNumber',
          'serial_number',
        ]);
        const serialNumber = serialNumberRaw ? String(serialNumberRaw).trim() : undefined;
        let quantity = this.toNumber(
          this.pick(row, [
            '庫存數量',
            '庫存',
            '現有量',
            '結存量',
            '期末量',
            '可用量',
            '數量',
            'qty',
            'quantity',
          ]) ?? 0,
          0,
        );
        if ((!quantity || quantity <= 0) && serialNumber) quantity = 1;

        if (!barcode) {
          missingBarcode++;
          if (!sampleRejected) {
            sampleRejected = {
              keys: Object.keys(row),
              barcodeCandidate: String(
                this.pick(row, ['品項編碼', '品項代碼', '商品編碼', '商品代碼', '料號', 'SKU', 'sku', '條碼']) ?? '',
              ).trim(),
              warehouseCodeCandidate: rawWarehouseCode,
              warehouseNameCandidate: rawWarehouseName || warehouseLocation,
            };
          }
          return null;
        }
        if (!warehouseCode || !warehouseName) {
          missingWarehouse++;
          if (!sampleRejected) {
            sampleRejected = {
              keys: Object.keys(row),
              barcodeCandidate: barcode,
              warehouseCodeCandidate: rawWarehouseCode,
              warehouseNameCandidate: rawWarehouseName || warehouseLocation,
            };
          }
          return null;
        }

        const finalName = name || barcode;

        const out: ImportRow = {
          barcode,
          name: finalName,
          warehouseCode,
          warehouseName,
          quantity: quantity > 0 ? quantity : 0,
        };

        if (serialNumber) out.serialNumber = serialNumber;
        return out;
      });

    const rows: ImportRow[] = mapped.filter((r): r is ImportRow => r !== null);

    return {
      rows,
      rawRows: raw.length,
      debug: {
        accepted: rows.length,
        rejected: Math.max(0, raw.length - rows.length),
        reasons: {
          missingBarcode,
          missingWarehouse,
        },
        sampleRejected,
      },
    };
  }

  private parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        out.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    out.push(current);
    return out.map((v) => v.trim());
  }

  private parseRowsFromCsvBuffer(buffer: Buffer): ParsedImport {
    const content = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      return {
        rows: [],
        rawRows: 0,
        meta: { format: 'csv', headers: [] },
        debug: {
          accepted: 0,
          rejected: 0,
          reasons: { missingBarcode: 0, missingWarehouse: 0 },
        },
      };
    }

    const headers = this.parseCsvLine(lines[0]).map((h) => this.normalizeHeaderKey(h));
    const raw: Array<Record<string, any>> = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCsvLine(lines[i]);
      const row: Record<string, any> = {};
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c];
        if (!key) continue;
        row[key] = cols[c] ?? '';
      }
      raw.push(row);
    }

    const parsed = this.parseRowsFromRecords(raw);
    return {
      ...parsed,
      meta: { format: 'csv', headers },
    };
  }

  private parseRowsFromExcelBuffer(buffer: Buffer, sheetName?: string): ParsedImport {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const availableSheets = workbook.SheetNames || [];
    const chosenSheetName = sheetName || availableSheets[0];
    if (!chosenSheetName || !workbook.Sheets[chosenSheetName]) {
      throw new Error(`Sheet not found: ${chosenSheetName}`);
    }

    const sheet = workbook.Sheets[chosenSheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    const headers = Object.keys((raw as Array<Record<string, any>>)[0] || {}).map((h) =>
      this.normalizeHeaderKey(h),
    );
    const parsed = this.parseRowsFromRecords(raw as Array<Record<string, any>>);
    return {
      ...parsed,
      meta: {
        format: 'excel',
        headers,
        sheet: chosenSheetName,
        availableSheets,
      },
    };
  }

  async importLegacyErpInventory(input: {
    entityId: string;
    file?: Express.Multer.File;
    sheet?: string;
    dryRun?: boolean;
    force?: boolean;
  }) {
    const server = {
      service: process.env.K_SERVICE,
      revision: process.env.K_REVISION,
      configuration: process.env.K_CONFIGURATION,
    };

    const entityId = input.entityId?.trim();
    if (!entityId) throw new BadRequestException('Missing entityId');
    if (!input.file?.buffer) throw new BadRequestException('Missing file');

    const dryRun = Boolean(input.dryRun);
    const force = Boolean(input.force);
    const sheet = input.sheet?.trim();
    const importRef = (input.file.originalname || 'upload.xlsx').trim();

    if (!dryRun && !force) {
      const prior = await this.prisma.inventoryTransaction.count({
        where: {
          entityId,
          referenceType: 'MIGRATION',
          referenceId: importRef,
        },
      });
      if (prior > 0) {
        throw new BadRequestException(
          `This file looks already imported (referenceId=${importRef}). Use force=true to run again.`,
        );
      }
    }

    const originalName = (input.file.originalname || '').toLowerCase();
    const mime = String(input.file.mimetype || '').toLowerCase();
    const isCsv = originalName.endsWith('.csv') || mime.includes('text/csv') || mime.includes('application/csv');

    const parsed: ParsedImport = isCsv
      ? this.parseRowsFromCsvBuffer(input.file.buffer)
      : this.parseRowsFromExcelBuffer(input.file.buffer, sheet);

    const { rows, rawRows, meta, debug } = parsed;
    if (rows.length === 0) {
      return {
        server,
        rawRows,
        rows: 0,
        skippedRows: rawRows,
        message: 'No rows found (check headers / sheet).',
        debug: {
          format: meta.format,
          sheet: meta.sheet,
          availableSheets: meta.availableSheets,
          headers: meta.headers,
          parser: debug,
        },
      };
    }

    const warehouseKeyToId = new Map<string, string>();
    const productKeyToCache = new Map<string, ImportProductCache>();
    let createdWarehouses = 0;
    let createdProducts = 0;
    let updatedProducts = 0;

    const qtyAgg = new Map<string, Prisma.Decimal>();
    const serialRows: Array<{
      entityId: string;
      productId: string;
      warehouseId: string;
      serialNumber: string;
    }> = [];

    const [existingWarehouses, existingProducts] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { entityId } }),
      this.prisma.product.findMany({ where: { entityId } }),
    ]);

    for (const w of existingWarehouses) warehouseKeyToId.set(w.code, w.id);
    for (const p of existingProducts) {
      productKeyToCache.set(p.sku, {
        id: p.id,
        name: p.name,
        hasSerialNumbers: p.hasSerialNumbers,
      });
    }

    for (const r of rows) {
      // Warehouse
      let warehouseId = warehouseKeyToId.get(r.warehouseCode);
      if (!warehouseId) {
        if (!dryRun) {
          const created = await this.prisma.warehouse.create({
            data: {
              entityId,
              code: r.warehouseCode,
              name: r.warehouseName,
              type: 'INTERNAL',
              isActive: true,
            },
          });
          warehouseId = created.id;
        } else {
          warehouseId = `DRYRUN-WH-${r.warehouseCode}`;
        }

        warehouseKeyToId.set(r.warehouseCode, warehouseId);
        createdWarehouses++;
      }

      // Product (sku = barcode)
      const sku = r.barcode;
      const cached = productKeyToCache.get(sku);
      let productId = cached?.id;

      if (!productId) {
        if (!dryRun) {
          const created = await this.prisma.product.create({
            data: {
              entityId,
              sku,
              name: r.name,
              type: ProductType.SIMPLE,
              barcode: r.barcode,
              hasSerialNumbers: Boolean(r.serialNumber),
              isActive: true,
            },
          });
          productId = created.id;
          productKeyToCache.set(sku, {
            id: created.id,
            name: created.name,
            hasSerialNumbers: created.hasSerialNumbers,
          });
        } else {
          productId = `DRYRUN-PROD-${sku}`;
          productKeyToCache.set(sku, {
            id: productId,
            name: r.name,
            hasSerialNumbers: Boolean(r.serialNumber),
          });
        }

        createdProducts++;
      } else {
        const needsSn = Boolean(r.serialNumber);
        const current = productKeyToCache.get(sku);
        const shouldUpdateName = Boolean(current && (!current.name || current.name.trim() === '') && r.name);
        const shouldEnableSn = Boolean(current && !current.hasSerialNumbers && needsSn);

        if (shouldUpdateName || shouldEnableSn) {
          productKeyToCache.set(sku, {
            id: productId,
            name: shouldUpdateName ? r.name : (current?.name || r.name),
            hasSerialNumbers: shouldEnableSn ? true : Boolean(current?.hasSerialNumbers),
          });

          if (!dryRun) {
            await this.prisma.product.update({
              where: { id: productId },
              data: {
                ...(shouldUpdateName ? { name: r.name } : {}),
                ...(shouldEnableSn ? { hasSerialNumbers: true } : {}),
              },
            });
          }

          updatedProducts++;
        }
      }

      if (r.quantity > 0) {
        const key = `${warehouseId}::${productId}`;
        const prev = qtyAgg.get(key) || new Prisma.Decimal(0);
        qtyAgg.set(key, prev.add(new Prisma.Decimal(r.quantity)));
      }

      if (r.serialNumber && r.serialNumber.trim()) {
        serialRows.push({
          entityId,
          productId,
          warehouseId,
          serialNumber: r.serialNumber.trim(),
        });
      }
    }

    if (dryRun) {
      return {
        server,
        dryRun: true,
        entityId,
        file: importRef,
        sheet: sheet || '(first sheet)',
        rawRows,
        rows: rows.length,
        skippedRows: Math.max(0, rawRows - rows.length),
        createdWarehouses,
        createdProducts,
        updatedProducts,
        inventoryLines: qtyAgg.size,
        serialNumbers: serialRows.length,
      };
    }

    let createdMovements = 0;
    let upsertedSnapshots = 0;

    for (const [key, qty] of qtyAgg.entries()) {
      const [warehouseId, productId] = key.split('::');

      await this.prisma.$transaction(async (tx) => {
        await tx.inventoryTransaction.create({
          data: {
            entityId,
            warehouseId,
            productId,
            direction: 'IN',
            quantity: qty,
            referenceType: 'MIGRATION',
            referenceId: importRef,
            reason: 'ERP_IMPORT',
            occurredAt: new Date(),
          },
        });

        await tx.inventorySnapshot.upsert({
          where: {
            entityId_warehouseId_productId: {
              entityId,
              warehouseId,
              productId,
            },
          },
          create: {
            entityId,
            warehouseId,
            productId,
            qtyOnHand: qty,
            qtyAllocated: new Prisma.Decimal(0),
            qtyAvailable: qty,
          },
          update: {
            qtyOnHand: { increment: qty },
            qtyAvailable: { increment: qty },
          },
        });
      });

      createdMovements++;
      upsertedSnapshots++;
    }

    let createdSerials = 0;
    const chunkSize = 1000;
    for (let i = 0; i < serialRows.length; i += chunkSize) {
      const chunk = serialRows.slice(i, i + chunkSize);
      const result = await this.prisma.inventorySerialNumber.createMany({
        data: chunk.map((s) => ({
          entityId: s.entityId,
          productId: s.productId,
          warehouseId: s.warehouseId,
          serialNumber: s.serialNumber,
          status: 'AVAILABLE',
          inboundRefType: 'MIGRATION',
          inboundRefId: importRef,
        })),
        skipDuplicates: true,
      });
      createdSerials += result.count;
    }

    return {
      server,
      success: true,
      entityId,
      file: importRef,
      sheet: sheet || '(first sheet)',
      rawRows,
      rows: rows.length,
      skippedRows: Math.max(0, rawRows - rows.length),
      createdWarehouses,
      createdProducts,
      updatedProducts,
      inventoryLines: qtyAgg.size,
      createdMovements,
      upsertedSnapshots,
      serialRows: serialRows.length,
      createdSerials,
    };
  }

  /**
   * 查詢倉庫列表
   */
  async getWarehouses(entityId: string) {
    return this.prisma.warehouse.findMany({
      where: { entityId, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * 建立倉庫（若 code 已存在則直接回傳既有倉庫）
   */
  async createWarehouse(input: CreateWarehouseInput) {
    const entityId = input.entityId?.trim();
    const code = input.code?.trim();
    const name = input.name?.trim();
    const type = input.type?.trim() || 'INTERNAL';

    if (!entityId || !code || !name) {
      throw new BadRequestException('Missing required fields: entityId, code, name');
    }

    const existing = await this.prisma.warehouse.findUnique({
      where: {
        entityId_code: {
          entityId,
          code,
        },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.warehouse.create({
      data: {
        entityId,
        code,
        name,
        type,
        isActive: true,
      },
    });
  }

  /**
   * 取得指定商品在所有倉庫的庫存快照
   */
  async getSnapshotsForProduct(entityId: string, productId: string) {
    return this.prisma.inventorySnapshot.findMany({
      where: { entityId, productId },
      include: {
        warehouse: true,
        product: true,
      },
      orderBy: {
        warehouse: {
          code: 'asc',
        },
      },
    });
  }

  /**
   * 通用庫存異動（進貨入庫、出貨出庫、盤點調整等）
   */
  async adjustStock(
    input: AdjustStockInput,
    transactionClient?: Prisma.TransactionClient,
  ) {
    const {
      entityId,
      warehouseId,
      productId,
      quantity,
      direction,
      referenceType,
      referenceId,
      reason,
      occurredAt,
    } = input;

    const execute = async (tx: Prisma.TransactionClient) => {
      // 確保倉庫與商品屬於同一公司且仍啟用。
      const [warehouse, product] = await Promise.all([
        tx.warehouse.findFirst({
        where: { id: warehouseId, entityId, isActive: true },
      }),
        tx.product.findFirst({
        where: { id: productId, entityId, isActive: true },
      }),
      ]);

      if (!warehouse) {
        throw new NotFoundException('Warehouse not found or inactive');
      }
      if (!product) {
        throw new NotFoundException('Product not found or inactive');
      }

      const qty = new Prisma.Decimal(quantity as any);
      if (qty.lte(0)) {
        throw new BadRequestException('Inventory quantity must be greater than zero');
      }

      // 1. 建立異動紀錄
      const movement = await tx.inventoryTransaction.create({
        data: {
          entityId,
          warehouseId,
          productId,
          direction,
          quantity: qty,
          referenceType,
          referenceId,
          reason,
          occurredAt: occurredAt ?? new Date(),
        },
      });

      // 2. 取得或建立 snapshot
      const snapshot = await tx.inventorySnapshot.upsert({
        where: {
          entityId_warehouseId_productId: {
            entityId,
            warehouseId,
            productId,
          },
        },
        create: {
          entityId,
          warehouseId,
          productId,
          qtyOnHand: direction === 'IN' ? qty : qty.mul(-1),
          qtyAllocated: new Prisma.Decimal(0),
          qtyAvailable: direction === 'IN' ? qty : qty.mul(-1),
        },
        update: {
          qtyOnHand:
            direction === 'IN'
              ? { increment: qty }
              : direction === 'OUT'
                ? { decrement: qty }
                : qty, // ADJUST 模式下可視需要改成直接覆寫
          qtyAvailable:
            direction === 'IN'
              ? { increment: qty }
              : direction === 'OUT'
                ? { decrement: qty }
                : qty,
        },
      });

      return { movement, snapshot };
    };

    return transactionClient
      ? execute(transactionClient)
      : this.prisma.$transaction(execute);
  }

  /**
   * 出貨扣庫。如果這張訂單已有預留量，只釋放屬於該訂單的部分，
   * 再扣減實際現有與可用庫存。全程可共用上層 transaction。
   */
  async shipStock(
    input: ShipStockInput,
    transactionClient?: Prisma.TransactionClient,
  ) {
    const execute = async (tx: Prisma.TransactionClient) => {
      const qty = new Prisma.Decimal(input.quantity as any);
      if (qty.lte(0)) {
        throw new BadRequestException('Shipment quantity must be greater than zero');
      }

      const [warehouse, product, snapshot, reservationMovements] = await Promise.all([
        tx.warehouse.findFirst({
          where: { id: input.warehouseId, entityId: input.entityId, isActive: true },
        }),
        tx.product.findFirst({
          where: { id: input.productId, entityId: input.entityId, isActive: true },
        }),
        tx.inventorySnapshot.findUnique({
          where: {
            entityId_warehouseId_productId: {
              entityId: input.entityId,
              warehouseId: input.warehouseId,
              productId: input.productId,
            },
          },
        }),
        tx.inventoryTransaction.findMany({
          where: {
            entityId: input.entityId,
            warehouseId: input.warehouseId,
            productId: input.productId,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            direction: { in: ['RESERVE', 'RELEASE'] },
          },
          select: { direction: true, quantity: true },
        }),
      ]);

      if (!warehouse) throw new NotFoundException('Warehouse not found or inactive');
      if (!product) throw new NotFoundException('Product not found or inactive');
      if (!snapshot || snapshot.qtyOnHand.lt(qty)) {
        throw new BadRequestException(`Insufficient stock for product ${product.sku}`);
      }

      const reservedForOrder = reservationMovements.reduce(
        (total, movement) =>
          movement.direction === 'RESERVE'
            ? total.add(movement.quantity)
            : total.sub(movement.quantity),
        new Prisma.Decimal(0),
      );
      const releasable = Prisma.Decimal.max(
        0,
        Prisma.Decimal.min(reservedForOrder, snapshot.qtyAllocated, qty),
      );
      const availableAfterRelease = snapshot.qtyAvailable.add(releasable);
      if (availableAfterRelease.lt(qty)) {
        throw new BadRequestException(`Insufficient available stock for product ${product.sku}`);
      }

      if (releasable.gt(0)) {
        await tx.inventoryTransaction.create({
          data: {
            entityId: input.entityId,
            warehouseId: input.warehouseId,
            productId: input.productId,
            direction: 'RELEASE',
            quantity: releasable,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            reason: 'Release reservation for shipment',
            occurredAt: new Date(),
          },
        });
      }

      const movement = await tx.inventoryTransaction.create({
        data: {
          entityId: input.entityId,
          warehouseId: input.warehouseId,
          productId: input.productId,
          direction: 'OUT',
          quantity: qty,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          reason: input.reason || 'Sales order shipment',
          occurredAt: new Date(),
        },
      });

      const updatedSnapshot = await tx.inventorySnapshot.update({
        where: {
          entityId_warehouseId_productId: {
            entityId: input.entityId,
            warehouseId: input.warehouseId,
            productId: input.productId,
          },
        },
        data: {
          qtyOnHand: { decrement: qty },
          qtyAllocated: releasable.gt(0) ? { decrement: releasable } : undefined,
          qtyAvailable: { decrement: qty.sub(releasable) },
        },
      });

      return { movement, snapshot: updatedSnapshot, releasedQuantity: releasable };
    };

    return transactionClient
      ? execute(transactionClient)
      : this.prisma.$transaction(execute);
  }

  /**
   * 預留庫存（銷售訂單建立時）
   */
  async reserveStock(
    input: ReserveStockInput,
    transactionClient?: Prisma.TransactionClient,
  ) {
    const {
      entityId,
      warehouseId,
      productId,
      quantity,
      referenceId,
      referenceType,
    } = input;
    const qty = new Prisma.Decimal(quantity as any);
    if (qty.lte(0)) {
      throw new BadRequestException('Reservation quantity must be greater than zero');
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      // A conditional database update serializes competing reservations for the
      // same stock row. A prior findUnique followed by update can oversell.
      const claimed = await tx.inventorySnapshot.updateMany({
        where: {
          entityId,
          warehouseId,
          productId,
          qtyAvailable: { gte: qty },
        },
        data: {
          qtyAllocated: { increment: qty },
          qtyAvailable: { decrement: qty },
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Not enough available stock to reserve');
      }

      const movement = await tx.inventoryTransaction.create({
        data: {
          entityId,
          warehouseId,
          productId,
          direction: 'RESERVE',
          quantity: qty,
          referenceType,
          referenceId,
          occurredAt: new Date(),
        },
      });

      const updatedSnapshot = await tx.inventorySnapshot.findUniqueOrThrow({
        where: {
          entityId_warehouseId_productId: {
            entityId,
            warehouseId,
            productId,
          },
        },
      });

      return { movement, snapshot: updatedSnapshot };
    };

    return transactionClient
      ? execute(transactionClient)
      : this.prisma.$transaction(execute);
  }

  /**
   * 釋放預留庫存（訂單取消或調整）
   */
  async releaseReservedStock(input: ReserveStockInput) {
    const {
      entityId,
      warehouseId,
      productId,
      quantity,
      referenceId,
      referenceType,
    } = input;
    const qty = new Prisma.Decimal(quantity as any);

    return this.prisma.$transaction(async (tx) => {
      const snapshot = await tx.inventorySnapshot.findUnique({
        where: {
          entityId_warehouseId_productId: {
            entityId,
            warehouseId,
            productId,
          },
        },
      });

      if (!snapshot || snapshot.qtyAllocated.lt(qty)) {
        throw new NotFoundException('Not enough allocated stock to release');
      }

      const movement = await tx.inventoryTransaction.create({
        data: {
          entityId,
          warehouseId,
          productId,
          direction: 'RELEASE',
          quantity: qty,
          referenceType,
          referenceId,
          occurredAt: new Date(),
        },
      });

      const updatedSnapshot = await tx.inventorySnapshot.update({
        where: {
          entityId_warehouseId_productId: {
            entityId,
            warehouseId,
            productId,
          },
        },
        data: {
          qtyAllocated: { decrement: qty },
          qtyAvailable: { increment: qty },
        },
      });

      return { movement, snapshot: updatedSnapshot };
    });
  }

  /**
   * 批次新增庫存序號 (進貨時)
   */
  async addSerialNumbers(
    entityId: string,
    warehouseId: string,
    productId: string,
    serialNumbers: string[],
    inboundRefType: string,
    inboundRefId: string,
    transactionClient?: Prisma.TransactionClient,
  ) {
    if (!serialNumbers || serialNumbers.length === 0) return;

    const data = serialNumbers.map((sn) => ({
      entityId,
      productId,
      warehouseId,
      serialNumber: sn,
      status: 'AVAILABLE',
      inboundRefType,
      inboundRefId,
    }));

    const db = transactionClient || this.prisma;
    const uniqueSerialNumbers = [...new Set(serialNumbers.map((serial) => serial.trim()))];
    if (uniqueSerialNumbers.length !== serialNumbers.length || uniqueSerialNumbers.some((serial) => !serial)) {
      throw new BadRequestException('Serial numbers must be unique and non-empty');
    }

    await db.inventorySerialNumber.createMany({
      data: data.map((entry, index) => ({
        ...entry,
        serialNumber: uniqueSerialNumbers[index],
      })),
    });
  }

  /**
   * 將序號標記為已售出 (Outbound)
   */
  async markSerialNumbersAsSold(params: {
    entityId: string;
    warehouseId: string;
    productId: string;
    serialNumbers: string[];
    outboundRefType: string;
    outboundRefId: string;
  }, transactionClient?: Prisma.TransactionClient) {
    const {
      entityId,
      warehouseId,
      productId,
      serialNumbers,
      outboundRefType,
      outboundRefId,
    } = params;

    if (!serialNumbers || serialNumbers.length === 0) {
      return;
    }

    // 1. 驗證所有序號是否存在且狀態為 AVAILABLE
    const uniqueSerialNumbers = [...new Set(serialNumbers.map((serial) => serial.trim()))];
    if (uniqueSerialNumbers.length !== serialNumbers.length || uniqueSerialNumbers.some((serial) => !serial)) {
      throw new BadRequestException('Serial numbers must be unique and non-empty');
    }
    const db = transactionClient || this.prisma;
    const existingSNs = await db.inventorySerialNumber.findMany({
      where: {
        entityId,
        productId,
        warehouseId,
        serialNumber: { in: uniqueSerialNumbers },
        status: 'AVAILABLE',
      },
    });

    if (existingSNs.length !== serialNumbers.length) {
      const foundSNs = existingSNs.map((sn) => sn.serialNumber);
      const missingSNs = uniqueSerialNumbers.filter((sn) => !foundSNs.includes(sn));
      throw new Error(
        `Some serial numbers are invalid or not available: ${missingSNs.join(', ')}`,
      );
    }

    // 2. 更新狀態
    await db.inventorySerialNumber.updateMany({
      where: {
        entityId,
        productId,
        warehouseId,
        serialNumber: { in: uniqueSerialNumbers },
      },
      data: {
        status: 'SOLD',
        warehouseId: null, // 移出倉庫
        outboundRefType,
        outboundRefId,
      },
    });
  }
}
