import 'reflect-metadata';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { SnLabelsExport } from './sn-labels.export';
import { SnData } from './sn-labels.rules';

const QR = require('qrcode');
const BWIP = require('bwip-js');

describe('warehouse carton workbook', () => {
  it.each([true, false])('keeps complete cartons and a partial last box (SN: %s)', (hasSN) => {
    const data = {
      sku: '000077',
      barcode: '04711299273087',
      productName: '測試商品',
      model: 'MODEL-A',
    } as SnData;
    const boxes = [
      { id: 'CTN-001', quantity: 2, serials: hasSN ? ['00001', '00002'] : [] },
      { id: 'CTN-002', quantity: 1, serials: hasSN ? ['00003'] : [] },
    ];
    const book = XLSX.read(new SnLabelsExport().warehouseCartons(data, boxes, 'batch-123'));
    expect(book.SheetNames).toEqual(['箱號明細', '倉儲明細']);
    const cartonSheet = book.Sheets['箱號明細'];
    expect(cartonSheet.A2).toMatchObject({ t: 's', v: '04711299273087' });
    expect(cartonSheet.G2).toMatchObject({ t: 's', v: '000077' });
    expect(cartonSheet.D3).toMatchObject({ t: 'n', v: 1 });
    expect(cartonSheet.F2.v).toBe(hasSN ? '00001,00002' : '');
    expect(cartonSheet.J3.v).toBe('batch-123');
    expect(book.Sheets['倉儲明細'].G3.v).toBe('CTN-002');
    expect(book.Sheets['倉儲明細'].H3.v).toBe(hasSN ? '00003' : '');
  });
});

describe('carton label PDF scan contents', () => {
  const serials = Array.from(
    { length: 32 },
    (_, index) => `HL1K6200${String(index + 1).padStart(4, '0')}`,
  );
  const carton = {
    id: 'CTN-261002-HL1-001',
    quantity: serials.length,
    serials,
  };
  const data = {
    model: 'HL1',
    style: 'A',
    color: '黑',
    barcode: '04711299273087',
    cartonWidth: 60,
  } as SnData;

  afterEach(() => jest.restoreAllMocks());

  it.each([60, 120])('keeps 11 pt text and a 25 mm serial QR on %i mm paper', async (width) => {
    const font = jest.spyOn(PDFDocument.prototype, 'fontSize');
    const rectangles = jest.spyOn(PDFDocument.prototype, 'rect');
    await new SnLabelsExport().pdf('cartons', { ...data, cartonWidth: width }, [], [carton]);
    expect(font.mock.calls.map(([size]) => size)).toContain(11);
    expect(font.mock.calls.every(([size]) => size === 11 || size === 12)).toBe(true);
    const edge = 25 * 72 / 25.4;
    expect(rectangles.mock.calls.filter(([, , w, h]) => Math.abs(w-edge) < 0.001 && Math.abs(h-edge) < 0.001)).toHaveLength(1);
  });

  it.each([
    ['cartons', true],
    ['cartons-no-sn', false],
  ])(
    'renders %s with only the carton barcode and the expected QR',
    async (kind, hasSerials) => {
      const box = hasSerials ? carton : { ...carton, serials: [] };
      const code128 = jest.spyOn(BWIP, 'raw');
      const qr = jest.spyOn(QR, 'create');
      const text = jest.spyOn(PDFDocument.prototype, 'text');

      const pdf = await new SnLabelsExport().pdf(kind, data, [], [box]);
      const printedText = text.mock.calls.map(([value]) => String(value));

      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(code128).toHaveBeenCalledTimes(1);
      expect(code128).toHaveBeenCalledWith({
        bcid: 'code128',
        text: carton.id,
      });
      expect(printedText).toContain(`箱號: ${carton.id}`);
      expect(printedText.some((value) => value.includes(data.barcode))).toBe(
        false,
      );

      if (hasSerials) {
        expect(qr).toHaveBeenCalledTimes(1);
        expect(qr).toHaveBeenCalledWith(serials.join(','), {
          errorCorrectionLevel: 'M',
        });
        expect(printedText).toContain('箱內序號');
        expect(printedText).toContain(serials[0]);
        expect(printedText).toContain(serials[serials.length - 1]);
      } else {
        expect(qr).not.toHaveBeenCalled();
        expect(printedText).not.toContain('箱內序號');
        expect(printedText).not.toContain(serials[0]);
      }
    },
  );
});
