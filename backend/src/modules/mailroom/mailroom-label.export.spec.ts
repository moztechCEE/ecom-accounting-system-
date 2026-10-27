import PDFDocument from 'pdfkit';
import {
  MailroomLabelExport,
  LABEL_DOT_PT,
  LABEL_MIN_FONT_PT,
  thermalLabelQr,
} from './mailroom-label.export';
import type { MailroomLabel } from './mailroom-label.contract';

const label: MailroomLabel = {
  id: '8c9bba2e-6fe7-4602-bf29-7df4a932ee6c',
  unit: 'MR-20261027-SYNTHETIC-1',
  caseNumber: 'R-20261027-001',
  customerName: '合成顧客陳小明',
  customerPhone: '0900000000',
  customerIssue: '行動電源無法充電，接上電源後指示燈不亮。',
  productName: 'MOZTECH 墨子行動電源',
  version: 1,
  qrLink:
    'https://dev.example.test/operations/repair?entityId=synthetic-company&itemId=8c9bba2e-6fe7-4602-bf29-7df4a932ee6c&queue=all',
};
describe('50 by 30 mm thermal label PDF', () => {
  afterEach(() => jest.restoreAllMocks());
  it('embeds CJK, keeps all required fields readable and produces one exact-size PDF page', async () => {
    const text = jest.spyOn(PDFDocument.prototype, 'text');
    const fonts = jest.spyOn(PDFDocument.prototype, 'font');
    const sizes = jest.spyOn(PDFDocument.prototype, 'fontSize');
    const addPage = jest.spyOn(PDFDocument.prototype, 'addPage');
    const pdf = await new MailroomLabelExport().pdf(label);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const body = pdf.toString('latin1');
    expect(body).toMatch(/\/MediaBox \[0 0 141\.732283 85\.03937\]/);
    expect(body).toContain('/FontFile3');
    expect(addPage).toHaveBeenCalledTimes(1);
    expect(
      fonts.mock.calls.some(([font]) =>
        String(font).endsWith('NotoSansCJKtc-Regular.otf'),
      ),
    ).toBe(true);
    const printed = text.mock.calls.map(([value]) => String(value));
    expect(printed).toContain('案件 R-20261027-001');
    expect(printed).toContain('姓名 合成顧客陳小明');
    expect(printed).toContain('電話 0900000000');
    expect(printed.join('')).toContain('問題 行動電源無法充電');
    expect(printed).toContain(label.unit);
    expect(
      sizes.mock.calls
        .filter(([size]) => size !== undefined)
        .every(([size]) => Number(size) >= LABEL_MIN_FONT_PT),
    ).toBe(true);
  });
  it('uses explicit missing-value copy and never prints null/undefined', async () => {
    const text = jest.spyOn(PDFDocument.prototype, 'text');
    await new MailroomLabelExport().pdf({
      ...label,
      caseNumber: null,
      customerName: null,
      customerPhone: null,
      customerIssue: null,
    });
    const values = text.mock.calls.map(([value]) => String(value));
    expect(values).toEqual(
      expect.arrayContaining([
        '案件 未綁定',
        '姓名 未提供',
        '電話 未提供',
        '問題 未提供',
      ]),
    );
    expect(values.join('')).not.toMatch(/null|undefined/);
  });
  it('summarizes long CJK text without reducing font size or adding pages', async () => {
    const text = jest.spyOn(PDFDocument.prototype, 'text');
    const pages = jest.spyOn(PDFDocument.prototype, 'addPage');
    const sourceIssue = '合成問題無法充電且指示燈異常'.repeat(80);
    await new MailroomLabelExport().pdf({
      ...label,
      customerName: '合成顧客'.repeat(40),
      customerIssue: sourceIssue,
      productName: '超長產品名稱'.repeat(40),
    });
    expect(pages).toHaveBeenCalledTimes(1);
    expect(text.mock.calls.some(([value]) => String(value).endsWith('…'))).toBe(
      true,
    );
    expect(sourceIssue).toHaveLength(1120);
    expect(
      text.mock.calls.every(([, , y]) => Number(y) < (30 * 72) / 25.4),
    ).toBe(true);
  });
  it.each([
    label.qrLink,
    label.qrLink.replace(
      'dev.example.test',
      'corely-erp-dev-sp5g377smq-de.a.run.app',
    ),
  ])(
    'draws actual full-URL QR with four quiet modules, whole 203dpi dots and at least two dots per module',
    async (link) => {
      const geometry = thermalLabelQr(link);
      expect(geometry.moduleDots).toBeGreaterThanOrEqual(2);
      expect(geometry.totalDots).toBe(
        (geometry.modules.size + 8) * geometry.moduleDots,
      );
      const rect = jest.spyOn(PDFDocument.prototype, 'rect');
      await new MailroomLabelExport().pdf({ ...label, qrLink: link });
      const rectangles = rect.mock.calls;
      expect(rectangles.length).toBeGreaterThan(100);
      for (const coordinates of rectangles)
        for (const point of coordinates)
          expect(
            Math.abs(
              Number(point) / LABEL_DOT_PT -
                Math.round(Number(point) / LABEL_DOT_PT),
            ),
          ).toBeLessThan(1e-8);
      const black = rectangles.slice(1);
      expect(Math.min(...black.map(([x]) => Number(x)))).toBe(
        (geometry.xDots + 4 * geometry.moduleDots) * LABEL_DOT_PT,
      );
      expect(Math.min(...black.map(([, y]) => Number(y)))).toBe(
        (geometry.yDots + 4 * geometry.moduleDots) * LABEL_DOT_PT,
      );
    },
  );
  it('renders a trusted batch as exactly one ordered page per physical item without changing DTO values', async () => {
    const text = jest.spyOn(PDFDocument.prototype, 'text');
    const rows = [
      label,
      {
        ...label,
        id: '7eb7d3e2-034f-438d-9194-e7c0d03ec508',
        unit: 'MR-SYNTHETIC-2',
        qrLink: label.qrLink.replace(
          label.id,
          '7eb7d3e2-034f-438d-9194-e7c0d03ec508',
        ),
      },
    ];
    const before = structuredClone(rows);
    const pdf = await new MailroomLabelExport().pdfMany(rows);
    expect(pdf.toString('latin1')).toMatch(/\/Count 2/);
    expect(
      text.mock.calls
        .map(([value]) => String(value))
        .filter((value) => value.startsWith('MR-')),
    ).toEqual(rows.map((row) => row.unit));
    expect(rows).toEqual(before);
  });
  it('rejects empty or oversized batches before rendering', async () => {
    const renderer = new MailroomLabelExport();
    await expect(renderer.pdfMany([])).rejects.toThrow('1 至 50');
    await expect(
      renderer.pdfMany(Array.from({ length: 51 }, () => label)),
    ).rejects.toThrow('1 至 50');
  });
  it('accepts the full 50-item batch while retaining 50 exact paper pages', async () => {
    const pdf = await new MailroomLabelExport().pdfMany(
      Array.from({ length: 50 }, () => label),
    );
    expect(pdf.toString('latin1')).toMatch(/\/Count 50/);
    expect(
      pdf
        .toString('latin1')
        .match(/\/MediaBox \[0 0 141\.732283 85\.03937\]/g) || [],
    ).toHaveLength(50);
  });
});
