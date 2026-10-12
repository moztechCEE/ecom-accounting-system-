import { SnLabelsService } from './sn-labels.service';
import { validateDraft } from './sn-labels.rules';

const draft = () =>
  validateDraft({
    name: 'Synthetic batch',
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
  });

function harness() {
  const data = draft(),
    saved = {
      id: 'draft',
      entity_id: 'company',
      revision: 1,
      data,
      batch_id: null as string | null,
    };
  const reads: string[] = [],
    writes: { sql: string; values: any[] }[] = [];
  let cartonCounter = 4,
    duplicate = false;
  const tx = {
    product: {
      findFirst: jest.fn(async () => ({
        id: 'product',
        sku: data.sku,
        name: data.productName,
        barcode: null,
      })),
    },
    $queryRaw: jest.fn(
      async (parts: TemplateStringsArray, ...values: any[]): Promise<any[]> => {
        const sql = parts.join('?');
        reads.push(sql);
        if (sql.includes('sn_label_drafts'))
          return values[1] === 'company' ? [saved] : [];
        if (sql.includes('SELECT sn FROM sn_label_serials'))
          return duplicate ? [{ sn: '00001' }] : [];
        if (sql.includes('sn_label_batches')) return [];
        if (sql.includes('sn_label_carton_counters'))
          return [{ last_value: cartonCounter }];
        throw new Error(`Unexpected database read: ${sql}`);
      },
    ),
    $executeRaw: jest.fn(
      async (parts: TemplateStringsArray, ...values: any[]) => {
        const sql = parts.join('?');
        writes.push({ sql, values });
        if (sql.startsWith('UPDATE sn_label_drafts SET batch_id='))
          saved.batch_id = values[0];
        return 1;
      },
    ),
  };
  const db = {
    $transaction: jest.fn(async (fn: (client: any) => Promise<any>) => fn(tx)),
  };
  const pdf = jest.fn(async () => Buffer.from('%PDF'));
  const service = new SnLabelsService(db as any, { pdf } as any);
  return {
    service,
    data,
    saved,
    reads,
    writes,
    pdf,
    tx,
    advanceCartonCounter: () => cartonCounter++,
    occupySN: () => {
      duplicate = true;
    },
  };
}

describe('existing serial registration boundaries', () => {
  it('plans no-SN / no-EAN quantities and a tail carton without an invented manufacturing date or serial counter', async () => {
    const h = harness();
    const preview = await h.service.preview('company', {
      ...h.data,
      serialSource: 'generated',
      modelCode: 'NSI',
      actualSN: [],
      quantity: 10,
      capacity: 4,
      manufactureDate: '',
    });
    expect(preview.rows.map((row) => [row.quantity, row.serials])).toEqual([
      [4, []],
      [4, []],
      [2, []],
    ]);
    expect(preview.noSerial).toBe(true);
    expect(h.reads.some((sql) => sql.includes('sn_label_counters'))).toBe(
      false,
    );
    expect(h.writes).toHaveLength(0);
  });
  it('registers the exact list with a tail carton and never reads/writes serial allocation or inventory', async () => {
    const h = harness(),
      preview = await h.service.preview('company', h.data);
    expect(preview.rows).toEqual([
      {
        id: 'CTN-261012-M1-005',
        ordinal: 1,
        quantity: 2,
        serials: ['00001', 'Vendor-a02'],
      },
      {
        id: 'CTN-261012-M1-006',
        ordinal: 2,
        quantity: 1,
        serials: ['Vendor-A02'],
      },
    ]);
    const result = await h.service.activate(
      'company',
      'actor',
      'draft',
      1,
      preview.token,
    );
    const snInsert = h.writes.find((w) =>
      w.sql.startsWith('INSERT INTO sn_label_serials'),
    )!;
    expect(
      JSON.parse(snInsert.values[0]).map((s: any) => [
        s.sn,
        s.carton_id,
        s.position,
      ]),
    ).toEqual([
      ['00001', 'CTN-261012-M1-005', 1],
      ['Vendor-a02', 'CTN-261012-M1-005', 2],
      ['Vendor-A02', 'CTN-261012-M1-006', 1],
    ]);
    const boxInsert = h.writes.find((w) =>
      w.sql.startsWith('INSERT INTO sn_label_cartons SELECT'),
    )!;
    expect(
      JSON.parse(boxInsert.values[0]).map((box: any) => box.quantity),
    ).toEqual([2, 1]);
    expect(
      [...h.reads, ...h.writes.map((w) => w.sql)].some((sql) =>
        /sn_label_counters|inventory|stock/i.test(sql),
      ),
    ).toBe(false);
    expect(h.pdf.mock.calls).toHaveLength(1); // Existing serials are not regenerated or relabelled during registration.
    const insertsBefore = h.writes.filter((w) =>
      w.sql.startsWith('INSERT'),
    ).length;
    expect(await h.service.activate('company', 'actor', 'draft', 1)).toEqual({
      batchId: result.batchId,
      replayed: true,
    });
    expect(h.writes.filter((w) => w.sql.startsWith('INSERT'))).toHaveLength(
      insertsBefore,
    );
  });
  it('rejects globally owned serials, stale carton preview, stale draft and cross-company replay before inserting', async () => {
    const occupied = harness();
    occupied.occupySN();
    await expect(
      occupied.service.activate('company', 'actor', 'draft', 1),
    ).rejects.toThrow(/其他箱/);
    expect(occupied.writes.some((w) => w.sql.startsWith('INSERT'))).toBe(false);
    const stale = harness(),
      preview = await stale.service.preview('company', stale.data);
    stale.advanceCartonCounter();
    await expect(
      stale.service.activate('company', 'actor', 'draft', 1, preview.token),
    ).rejects.toThrow(/內容已變更/);
    expect(stale.writes.some((w) => w.sql.startsWith('INSERT'))).toBe(false);
    await expect(
      harness().service.activate('company', 'actor', 'draft', 2),
    ).rejects.toThrow(/更新/);
    await expect(
      harness().service.activate('other-company', 'actor', 'draft', 1),
    ).rejects.toThrow(/找不到草稿/);
  });
  it('requires the selected product identity even when its EAN is nullable', async () => {
    const h = harness();
    h.data.sku = 'FAKE-ITEM';
    h.tx.product.findFirst.mockResolvedValue({
      id: 'product',
      sku: 'ERP-SKU',
      name: h.data.productName,
      barcode: null,
    });
    await expect(h.service.preview('company', h.data)).rejects.toThrow(
      /產品資料/,
    );
  });
});

describe('manifest read and audit', () => {
  it('only exports an active batch within the authenticated company and a complete bounded carton range', async () => {
    const h = harness(),
      boxes = [
        {
          id: 'CTN-261012-M1-005',
          quantity: 2,
          ordinal: 1,
          serials: ['00001', 'Vendor-a02'],
        },
        {
          id: 'CTN-261012-M1-006',
          quantity: 1,
          ordinal: 2,
          serials: ['Vendor-A02'],
        },
      ];
    h.tx.$queryRaw.mockImplementation(
      async (parts: TemplateStringsArray, ...values: any[]) => {
        const sql = parts.join('?');
        if (sql.includes('sn_label_batches'))
          return values[1] === 'company' ? [{ id: 'batch', data: h.data }] : [];
        if (sql.includes('sn_label_cartons')) return boxes;
        throw new Error('Unexpected database read');
      },
    );
    const body = {
      from: 1,
      to: 2,
      mapping: {
        itemCode: 'ECOUNT-ITEM',
        internalScanCode: 'ITM-ERP-SKU',
        confirmed: true,
      },
    };
    expect(
      (await h.service.manifest('company', 'actor', 'batch', body)).cartons,
    ).toHaveLength(2);
    expect(
      h.writes.every((w) => w.sql.startsWith('INSERT INTO sn_label_events')),
    ).toBe(true);
    await expect(
      h.service.manifest('other-company', 'actor', 'batch', body),
    ).rejects.toThrow(/找不到/);
    await expect(
      h.service.manifest('company', 'actor', 'batch', { ...body, to: 3 }),
    ).rejects.toThrow(/不完整/);
    await expect(
      h.service.manifest('company', 'actor', 'batch', { ...body, to: 101 }),
    ).rejects.toThrow(/100 箱/);
  });
});
