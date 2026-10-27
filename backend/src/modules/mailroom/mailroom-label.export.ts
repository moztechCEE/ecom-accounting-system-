import { BadRequestException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import type { MailroomLabel } from './mailroom-label.contract';

type QrModules = { size: number; get: (row: number, column: number) => number };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QR = require('qrcode') as {
  create: (
    value: string,
    options: { errorCorrectionLevel: 'M' },
  ) => {
    modules: QrModules;
  };
};
const MM = 72 / 25.4;
export const LABEL_DPI = 203;
export const LABEL_DOT_PT = 72 / LABEL_DPI;
export const LABEL_MIN_FONT_PT = 6.8;
const FONT = join(process.cwd(), 'assets/fonts/NotoSansCJKtc-Regular.otf');

/** Vector edges land on whole thermal dots; four quiet modules are never cropped. */
export function thermalLabelQr(value: string) {
  const modules = QR.create(value, { errorCorrectionLevel: 'M' }).modules;
  const boxDots = Math.floor((18 / 25.4) * LABEL_DPI);
  const moduleDots = Math.floor(boxDots / (modules.size + 8));
  if (moduleDots < 2)
    throw new BadRequestException(
      '掃碼網址過長，無法產生可辨識的 50 × 30 mm 標籤',
    );
  const totalDots = (modules.size + 8) * moduleDots;
  return {
    modules,
    moduleDots,
    totalDots,
    xDots:
      Math.round((1 / 25.4) * LABEL_DPI) +
      Math.floor((boxDots - totalDots) / 2),
    yDots:
      Math.round((6 / 25.4) * LABEL_DPI) +
      Math.floor((boxDots - totalDots) / 2),
  };
}

@Injectable()
export class MailroomLabelExport {
  pdf(label: MailroomLabel): Promise<Buffer> {
    return this.pdfMany([label]);
  }
  async pdfMany(labels: readonly MailroomLabel[]): Promise<Buffer> {
    if (!labels.length || labels.length > 50)
      throw new BadRequestException('每次可產生 1 至 50 件標籤');
    const qrs = labels.map((label) => thermalLabelQr(label.qrLink));
    const doc = new PDFDocument({
      autoFirstPage: false,
      size: [50 * MM, 30 * MM],
      margin: 0,
      compress: true,
      info: { Title: '收件標籤', Producer: 'Corely', Creator: 'Corely' },
    });
    const chunks: Buffer[] = [];
    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    try {
      const clean = (value: string) =>
        value
          .replace(/\p{Cc}/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim();
      const fitted = (value: string, width: number): string => {
        const text = clean(value);
        if (doc.widthOfString(text) <= width) return text;
        const letters = Array.from(text);
        let start = 0;
        let end = letters.length;
        while (start < end) {
          const middle = Math.ceil((start + end) / 2);
          if (
            doc.widthOfString(letters.slice(0, middle).join('') + '…') <= width
          )
            start = middle;
          else end = middle - 1;
        }
        return letters.slice(0, start).join('') + '…';
      };
      const line = (
        value: string,
        x: number,
        y: number,
        width: number,
        size: number,
      ) => {
        doc.fontSize(size).text(fitted(value, width * MM), x * MM, y * MM, {
          lineBreak: false,
        });
      };
      const paragraph = (value: string) => {
        doc.fontSize(LABEL_MIN_FONT_PT);
        const letters = Array.from(clean(value));
        const width = 29 * MM;
        for (let row = 0; row < 3 && letters.length; row++) {
          let value = '';
          while (
            letters.length &&
            doc.widthOfString(value + letters[0]) <= width
          )
            value += letters.shift()!;
          if (row === 2 && letters.length)
            value = fitted(value + letters.join(''), width);
          doc.text(value, 20 * MM, 17 * MM + row * 8, { lineBreak: false });
        }
      };
      for (const [index, label] of labels.entries()) {
        const qr = qrs[index];
        doc.addPage();
        doc.font(FONT).fillColor('black');
        line('案件 ' + (label.caseNumber || '未綁定'), 1, 1, 48, 7);
        line('姓名 ' + (label.customerName || '未提供'), 20, 6, 29, 8);
        line('電話 ' + (label.customerPhone || '未提供'), 20, 9.8, 29, 7.5);
        line(label.productName, 20, 13.4, 29, LABEL_MIN_FONT_PT);
        paragraph('問題 ' + (label.customerIssue || '未提供'));
        line(label.unit, 1, 26, 48, LABEL_MIN_FONT_PT);

        doc
          .fillColor('white')
          .rect(
            qr.xDots * LABEL_DOT_PT,
            qr.yDots * LABEL_DOT_PT,
            qr.totalDots * LABEL_DOT_PT,
            qr.totalDots * LABEL_DOT_PT,
          )
          .fill();
        doc.fillColor('black');
        for (let row = 0; row < qr.modules.size; row++)
          for (let column = 0; column < qr.modules.size; column++)
            if (qr.modules.get(row, column))
              doc
                .rect(
                  (qr.xDots + (column + 4) * qr.moduleDots) * LABEL_DOT_PT,
                  (qr.yDots + (row + 4) * qr.moduleDots) * LABEL_DOT_PT,
                  qr.moduleDots * LABEL_DOT_PT,
                  qr.moduleDots * LABEL_DOT_PT,
                )
                .fill();
      }
      doc.end();
      return await result;
    } catch (error) {
      doc.end();
      await result;
      throw error;
    }
  }
}
