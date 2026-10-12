import { buildCartonManifest } from './sn-labels.manifest';
import {
  allocationRule,
  SnData,
  validateActualSN,
  validateDraft,
} from './sn-labels.rules';

export const cartonDraft = (overrides: Partial<SnData> = {}) =>
  validateDraft({
    name: 'Synthetic existing serials',
    productId: 'product',
    productName: 'Synthetic product',
    sku: 'ERP-SKU',
    barcode: '',
    model: 'M1',
    style: '',
    color: '',
    modelCode: '',
    styleCode: '',
    colorCode: '',
    orderDate: '2026-10-12',
    manufactureDate: '2026-10-12',
    quantity: 3,
    capacity: 2,
    serialSource: 'existing',
    actualSN: ['00001', 'Vendor-a02', 'Vendor-A02'],
    wmsItemCode: 'ECOUNT-ITEM',
    internalScanCode: 'ITM-ERP-SKU',
    label: {
      width: 28,
      height: 7.5,
      showQr: true,
      target: 'box',
      textX: 8,
      textY: 0.7,
      fontSize: 1.45,
      qrX: 0.25,
      qrY: 0.25,
      qrSize: 6,
    },
    ...overrides,
  });
const boxes = [
  { id: 'CTN-261012-M1-001', quantity: 2, serials: ['00001', 'Vendor-a02'] },
  { id: 'CTN-261012-M1-002', quantity: 1, serials: ['Vendor-A02'] },
];
const mapping = {
  itemCode: 'ECOUNT-ITEM',
  internalScanCode: 'ITM-ERP-SKU',
  confirmed: true,
};

describe('ERP to WMS carton manifest', () => {
  it('keeps exact manufacturer serials, tail quantities and explicitly reviewed cross-system item identity', () => {
    const data = cartonDraft(),
      result = buildCartonManifest('batch-id', data, boxes, mapping);
    expect(result).toEqual({
      format: 'corely-cartons-v1',
      sourceSystem: 'corely-erp',
      sourceReference: 'batch-id',
      cartons: [
        {
          cartonId: boxes[0].id,
          lines: [
            {
              itemCode: 'ECOUNT-ITEM',
              productName: data.productName,
              ean: null,
              internalScanCode: 'ITM-ERP-SKU',
              quantity: 2,
              actualSN: boxes[0].serials,
            },
          ],
        },
        {
          cartonId: boxes[1].id,
          lines: [
            {
              itemCode: 'ECOUNT-ITEM',
              productName: data.productName,
              ean: null,
              internalScanCode: 'ITM-ERP-SKU',
              quantity: 1,
              actualSN: boxes[1].serials,
            },
          ],
        },
      ],
    });
    expect(data.sku).toBe('ERP-SKU');
    expect(JSON.stringify(result)).not.toMatch(/sealed|inventoryPosted|stock/);
  });
  it('supports no-SN / no-EAN contents without fabricating a barcode or serial', () => {
    const result = buildCartonManifest(
      'batch-id',
      cartonDraft({
        serialSource: 'generated',
        actualSN: [],
        modelCode: 'NSI',
      }),
      [{ ...boxes[0], serials: [] }],
      mapping,
    );
    expect(result.cartons[0].lines[0]).toMatchObject({
      ean: null,
      internalScanCode: 'ITM-ERP-SKU',
      actualSN: [],
      quantity: 2,
    });
  });
  it('requires human mapping confirmation and an internal code when EAN is absent', () => {
    expect(() =>
      buildCartonManifest('b', cartonDraft(), boxes, {
        ...mapping,
        itemCode: 'a'.repeat(101),
      }),
    ).toThrow(/100 字/);
    expect(() =>
      buildCartonManifest('b', cartonDraft(), boxes, {
        ...mapping,
        confirmed: false,
      }),
    ).toThrow(/核對/);
    expect(() =>
      buildCartonManifest('b', cartonDraft(), boxes, {
        ...mapping,
        internalScanCode: '',
      }),
    ).toThrow(/內部掃描碼/);
    expect(() =>
      buildCartonManifest('b', cartonDraft(), boxes, {
        ...mapping,
        itemCode: '',
      }),
    ).toThrow(/品號/);
    for (const code of ['ITM-中文', 'ERP-SKU', `ITM-${'a'.repeat(97)}`])
      expect(() =>
        buildCartonManifest('b', cartonDraft(), boxes, {
          ...mapping,
          internalScanCode: code,
        }),
      ).toThrow(/內部掃描碼/);
    expect(() =>
      buildCartonManifest(
        'b',
        cartonDraft({ barcode: 'ERP-SKU' }),
        boxes,
        mapping,
      ),
    ).toThrow(/條碼/);
  });
  it('rejects duplicate ownership, mismatched quantity and oversized exports', () => {
    expect(() =>
      buildCartonManifest(
        'b',
        cartonDraft(),
        [boxes[0], { ...boxes[1], id: boxes[0].id }],
        mapping,
      ),
    ).toThrow(/箱號/);
    expect(() =>
      buildCartonManifest(
        'b',
        cartonDraft(),
        [boxes[0], { ...boxes[1], serials: ['00001'] }],
        mapping,
      ),
    ).toThrow(/兩箱/);
    expect(() =>
      buildCartonManifest(
        'b',
        cartonDraft(),
        [{ ...boxes[0], quantity: 3 }],
        mapping,
      ),
    ).toThrow(/筆數/);
    expect(() =>
      buildCartonManifest(
        'b',
        cartonDraft(),
        Array(101).fill(boxes[0]),
        mapping,
      ),
    ).toThrow(/100 箱/);
  });
});

describe('serial source and item identifiers', () => {
  it('preserves exact case / zeros and prevents malformed or duplicate imports', () => {
    expect(validateActualSN(['00001', 'sn-a', 'SN-A'], 3)).toEqual([
      '00001',
      'sn-a',
      'SN-A',
    ]);
    for (const value of [
      ['SN-A', 'SN-A'],
      ['SN A'],
      ['SN,A'],
      ['SN\nA'],
      ['CTN-001'],
      ['ctn-001'],
      ['carton:001'],
      ['draft:sample'],
      ['x'.repeat(101)],
    ])
      expect(() => validateActualSN(value, value.length)).toThrow();
    expect(() => validateActualSN(['one'], 2)).toThrow(/筆數/);
  });
  it('separates existing serial batches from generated prefix counters without requiring manufacturer code rules', () => {
    const rule = allocationRule('company', cartonDraft());
    expect(rule).toMatchObject({ existingSerials: true, noSerial: false });
    expect(rule.mergeKey).toContain('existing');
    expect(
      allocationRule('company', cartonDraft({ manufactureDate: '' }))
        .existingSerials,
    ).toBe(true);
    expect(
      allocationRule(
        'company',
        cartonDraft({
          serialSource: 'generated',
          actualSN: [],
          modelCode: 'NSI',
        }),
      ),
    ).toMatchObject({ existingSerials: false, noSerial: true });
    expect(() =>
      allocationRule(
        'company',
        cartonDraft({ serialSource: 'generated', actualSN: [], modelCode: '' }),
      ),
    ).toThrow(/代碼/);
  });
});
