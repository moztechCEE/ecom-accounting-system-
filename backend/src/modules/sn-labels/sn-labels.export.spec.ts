import 'reflect-metadata';
import PDFDocument from 'pdfkit';
import { SnLabelsExport } from './sn-labels.export';
import { SnData } from './sn-labels.rules';

const QR = require('qrcode');
const BWIP = require('bwip-js');

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
