/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access */
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReceiptDto } from './mailroom.dto';
import { type SourceCase } from './mailroom.contract';
import {
  receiptLinkChanges,
  requireReceiptSourceVersion,
  resolveReceiptLocation,
  validateReceiptPayload,
  validateReceiptProduct,
} from './mailroom-receipt.contract';

export const receiptPhoto = (size = 8) => {
  const bytes = Buffer.alloc(size);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  return 'data:image/png;base64,' + bytes.toString('base64');
};
const body = (
  category: CreateReceiptDto['category'] = 'UNMATCHED',
): CreateReceiptDto => ({
  entityId: 'company',
  requestId: 'receipt-request',
  category,
  location: 'A1',
  items: [{ productName: 'Synthetic', evidence: [receiptPhoto()] }],
  ...(['REPAIR', 'RETURN'].includes(category)
    ? { sourceCaseId: 'case', sourceVersion: 'v1' }
    : {}),
});

describe('receipt photos and source snapshot', () => {
  test.each(['REPAIR', 'RETURN', 'UNMATCHED'] as const)(
    '%s requires an actual photo',
    (category) => {
      const input = body(category);
      input.items[0].evidence = [];
      expect(() => validateReceiptPayload(input)).toThrow('拍照');
      input.items[0].evidence = [receiptPhoto()];
      expect(() => validateReceiptPayload(input)).not.toThrow();
    },
  );
  test.each(['LETTER', 'PARCEL'] as const)(
    '%s does not require photos',
    (category) => {
      const input = body(category);
      delete input.items[0].evidence;
      expect(() => validateReceiptPayload(input)).not.toThrow();
    },
  );
  test('rejects spoofed headers, invalid MIME, fifth photo and a photo larger than 1 MB', () => {
    const input = body();
    for (const evidence of [
      ['data:image/png;base64,ZmFrZQ=='],
      ['data:text/plain;base64,ZmFrZQ=='],
      Array(5).fill(receiptPhoto()),
      [receiptPhoto(1024 * 1024 + 1)],
    ]) {
      input.items[0].evidence = evidence as string[];
      expect(() => validateReceiptPayload(input)).toThrow();
    }
  });
  test('12 MB decoded receipt boundary is accepted; 15 MB across separately valid items is rejected', () => {
    const input = body();
    const three = Array.from({ length: 3 }, () => receiptPhoto(1024 * 1024));
    input.items = Array.from({ length: 4 }, () => ({
      productName: 'Synthetic',
      evidence: three,
    }));
    expect(() => validateReceiptPayload(input)).not.toThrow();
    input.items.push({ productName: 'Synthetic', evidence: three });
    expect(() => validateReceiptPayload(input)).toThrow('12 MB');
  });
  test('a malformed oversized body is rejected before writes and each item still has a 3 MB limit', () => {
    const input = body();
    input.senderLabel = 'x'.repeat(50 * 1024 * 1024);
    expect(() => validateReceiptPayload(input)).toThrow('50 MB');
    delete input.senderLabel;
    input.items[0].evidence = Array.from({ length: 4 }, () =>
      receiptPhoto(1024 * 1024),
    );
    expect(() => validateReceiptPayload(input)).toThrow('3 MB');
  });
  test('known cases require the selected version; unrelated receipts reject a stray version', () => {
    const known = body('REPAIR');
    delete known.sourceVersion;
    expect(() => validateReceiptPayload(known)).toThrow('重新選擇');
    const unknown = { ...body(), sourceVersion: 'v1' };
    expect(() => validateReceiptPayload(unknown)).toThrow('不可附');
    expect(() =>
      requireReceiptSourceVersion({ version: 'v2' } as SourceCase, 'v1'),
    ).toThrow('已更新');
    expect(() =>
      requireReceiptSourceVersion({ version: 'v1' } as SourceCase, 'v1'),
    ).not.toThrow();
  });
  test('free-text position is required without a bin; optional location DTO accepts a structured bin and validates nested photos', async () => {
    const input = body();
    delete input.location;
    expect(() => validateReceiptPayload(input)).toThrow('存放位置');
    input.storageLocationId = 'bin';
    expect(() => validateReceiptPayload(input)).not.toThrow();
    expect(
      await validate(plainToInstance(CreateReceiptDto, input)),
    ).toHaveLength(0);
    input.items[0].evidence = ['x'.repeat(1400001)];
    expect(
      (await validate(plainToInstance(CreateReceiptDto, input))).some(
        (error) => error.property === 'items',
      ),
    ).toBe(true);
  });
});

describe('transactional bin and catalog validation', () => {
  function storage() {
    let active = true;
    const $queryRaw = jest.fn().mockResolvedValue([]);
    const mailroomStorageRack = {
      findFirst: jest.fn().mockResolvedValue({ isActive: true }),
    };
    const mailroomStorageLocation = {
      findFirst: jest
        .fn()
        .mockImplementation(async (args: { select: { code?: boolean } }) =>
          args.select.code
            ? { id: 'bin', code: 'A1', rackId: 'rack', isActive: active }
            : { id: 'bin', rackId: 'rack' },
        ),
    };
    return {
      tx: {
        $queryRaw,
        mailroomStorageRack,
        mailroomStorageLocation,
      } as unknown as Prisma.TransactionClient,
      $queryRaw,
      mailroomStorageRack,
      mailroomStorageLocation,
      deactivate: () => {
        active = false;
      },
    };
  }
  test('locks rack before bin and uses the locked current code rather than the caller text', async () => {
    const f = storage();
    expect(
      await resolveReceiptLocation(f.tx, {
        entityId: 'company',
        storageLocationId: 'bin',
        location: 'stale B9',
      }),
    ).toEqual({ storageLocationId: 'bin', location: 'A1' });
    const queries = f.$queryRaw.mock.calls.map(
      ([sql]: [Prisma.Sql]) => sql.sql,
    );
    expect(queries[0]).toContain('mailroom_storage_racks');
    expect(queries[1]).toContain('mailroom_storage_locations');
    expect(
      queries.every(
        (sql) => sql.includes('FOR UPDATE') && sql.includes('entity_id'),
      ),
    ).toBe(true);
    expect(
      f.mailroomStorageLocation.findFirst.mock.calls.every(
        ([args]: [{ where: Record<string, string> }]) =>
          args.where.entityId === 'company',
      ),
    ).toBe(true);
  });
  test('bin deactivation between candidate read and lock rejects rather than using the earlier snapshot', async () => {
    const f = storage();
    f.$queryRaw.mockImplementationOnce(async () => {
      f.deactivate();
      return [];
    });
    await expect(
      resolveReceiptLocation(f.tx, {
        entityId: 'company',
        storageLocationId: 'bin',
      }),
    ).rejects.toThrow('已停用');
  });
  test('rack deactivation and foreign/missing bin stop the receipt', async () => {
    const f = storage();
    f.mailroomStorageRack.findFirst.mockResolvedValueOnce({ isActive: false });
    await expect(
      resolveReceiptLocation(f.tx, {
        entityId: 'company',
        storageLocationId: 'bin',
      }),
    ).rejects.toThrow('已停用');
    f.$queryRaw.mockClear();
    f.mailroomStorageLocation.findFirst.mockResolvedValueOnce(null);
    await expect(
      resolveReceiptLocation(f.tx, {
        entityId: 'foreign',
        storageLocationId: 'bin',
      }),
    ).rejects.toThrow('找不到');
    expect(f.$queryRaw).not.toHaveBeenCalled();
  });
  test('selected actual product locks and validates company/active/name/SKU/barcode, never generates a serial', async () => {
    const product = {
      findFirst: jest
        .fn()
        .mockResolvedValue({ name: 'Synthetic', sku: 'SKU', barcode: null }),
    };
    const $queryRaw = jest.fn().mockResolvedValue([]);
    const tx = { product, $queryRaw } as unknown as Prisma.TransactionClient;
    const row = {
      productId: 'product',
      productName: ' Synthetic ',
      sku: ' SKU ',
      barcode: '',
      serialNumber: 'SCANNED-SN',
    };
    await expect(
      validateReceiptProduct(tx, 'company', row),
    ).resolves.toBeUndefined();
    expect($queryRaw.mock.calls[0][0].sql).toContain('FOR SHARE');
    expect(product.findFirst).toHaveBeenCalledWith({
      where: { id: 'product', entityId: 'company', isActive: true },
      select: { name: true, sku: true, barcode: true },
    });
    expect(row.serialNumber).toBe('SCANNED-SN');
    for (const replacement of [
      null,
      { name: 'Changed', sku: 'SKU', barcode: null },
      { name: 'Synthetic', sku: 'Other', barcode: null },
      { name: 'Synthetic', sku: 'SKU', barcode: 'OTHER' },
    ]) {
      product.findFirst.mockResolvedValueOnce(replacement);
      await expect(validateReceiptProduct(tx, 'company', row)).rejects.toThrow(
        '重新選擇',
      );
    }
  });
});

describe('structured links follow actual custody and identity', () => {
  const item = { productName: 'Synthetic', sku: 'SKU', custodianId: 'clerk' };
  test.each(['accept', 'accept_return', 'dispatch'])(
    '%s clears the old bin even if location text is unchanged',
    (action) => {
      expect(receiptLinkChanges(item, {}, action)).toEqual({
        storageLocationId: null,
      });
    },
  );
  test('free-text moves/custody changes clear the bin; mere assignment does not', () => {
    expect(receiptLinkChanges(item, { location: 'A1' }, 'move')).toEqual({
      storageLocationId: null,
    });
    expect(
      receiptLinkChanges(item, { custodianId: 'technician' }, 'handoff'),
    ).toEqual({ storageLocationId: null });
    expect(
      receiptLinkChanges(item, { nextUserId: 'technician' }, 'assign'),
    ).toEqual({});
  });
  test('correction clears product identity/barcode; unchanged inspection and an SN-only correction keep catalog identity', () => {
    expect(receiptLinkChanges(item, {}, 'correct')).toEqual({
      productId: null,
      barcode: null,
    });
    expect(
      receiptLinkChanges(item, { productName: 'Other' }, 'inspect'),
    ).toEqual({ productId: null, barcode: null });
    expect(
      receiptLinkChanges(
        item,
        { productName: 'Synthetic', sku: 'SKU', serialNumber: 'SCANNED' },
        'inspect',
      ),
    ).toEqual({});
  });
});
