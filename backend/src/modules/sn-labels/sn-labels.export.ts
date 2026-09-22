import { BadRequestException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { SnData } from './sn-labels.rules';
const QR = require('qrcode');
const BWIP = require('bwip-js');
const mm = 72 / 25.4;
const font = join(process.cwd(), 'assets/fonts/NotoSansCJKtc-Regular.otf');
export const EXPORT_KINDS = [
  'labels',
  'cartons',
  'cartons-no-sn',
  'warranty',
  'warehouse',
];
@Injectable()
export class SnLabelsExport {
  workbook(kind: string, d: SnData, items: any[], columns?: string[]) {
    const mapping: Record<string, (s: any) => string> = {
      一般序號: (s) => s.sn,
      SKU: () => d.barcode,
      國際條碼: () => d.barcode,
      'ERP SKU': () => d.sku,
      箱號: (s) => s.carton_id,
      產品名稱: () => d.productName,
      型號: () => d.model,
      款式: () => d.style,
      顏色: () => d.color,
      下單日期: () => d.orderDate,
      製造日期: () => d.manufactureDate,
      箱內順序: (s) => String(s.position),
    };
    const headers =
      kind === 'warranty'
        ? ['一般序號', 'SKU']
        : columns?.length
          ? columns
          : [
              '一般序號',
              '國際條碼',
              '箱號',
              '箱內順序',
              '產品名稱',
              '型號',
              '款式',
              '顏色',
              '下單日期',
              '製造日期',
            ];
    if (
      headers.length > 12 ||
      new Set(headers).size !== headers.length ||
      headers.some((h) => !mapping[h]) ||
      !headers.includes('一般序號')
    )
      throw new BadRequestException('匯出欄位無效，必須包含一般序號');
    const sheet = XLSX.utils.aoa_to_sheet([
      headers,
      ...items.map((s) => headers.map((h) => mapping[h](s))),
    ]);
    // Strings preserve leading zeroes and prevent formula execution.
    sheet['!cols'] = headers.map(() => ({ wch: 25 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheet,
      kind === 'warranty' ? '保固序號' : 'SN 明細',
    );
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
  async pdf(kind: string, d: SnData, items: any[], boxes: any[]) {
    const isCarton = kind.startsWith('carton'),
      scale = (d.cartonWidth || 60) / 60;
    const width = isCarton ? 60 * scale : d.label.width,
      height = isCarton
        ? (kind === 'cartons-no-sn' ? 45 : 75) * scale
        : d.label.height;
    const doc = new PDFDocument({
      autoFirstPage: false,
      margin: 0,
      compress: true,
    });
    const chunks: Buffer[] = [];
    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    const text = (
      s: string,
      x: number,
      y: number,
      size: number,
      maxWidth: number,
    ) => {
      doc.font(font).fontSize(size * mm);
      if (doc.widthOfString(s) > maxWidth * mm + 0.01)
        throw new BadRequestException('標籤文字超出範圍，請縮小字級或放大標籤');
      doc.fillColor('black').text(s, x * mm, y * mm, { lineBreak: false });
    };
    const fit = (s: string, x: number, y: number, size: number, w: number) => {
      doc.font(font).fontSize(size * mm);
      const actual = Math.min(
        size,
        (size * w * mm) / Math.max(1, doc.widthOfString(s)),
      );
      if (actual < 1)
        throw new BadRequestException('外箱文字過長，請調整產品名稱或標籤尺寸');
      text(s, x, y, actual, w);
    };
    const qr = (value: string, x: number, y: number, size: number) => {
      const q = QR.create(value, { errorCorrectionLevel: 'M' }).modules,
        n = q.size,
        unit = size / (n + 8);
      if (unit < 0.2)
        throw new BadRequestException(
          'QR Code 過密，請放大標籤或降低每箱容量後再配號',
        );
      doc
        .fillColor('white')
        .rect(x * mm, y * mm, size * mm, size * mm)
        .fill();
      doc.fillColor('black');
      for (let row = 0; row < n; row++)
        for (let col = 0; col < n; col++)
          if (q.get(row, col))
            doc
              .rect(
                (x + (col + 4) * unit) * mm,
                (y + (row + 4) * unit) * mm,
                unit * mm,
                unit * mm,
              )
              .fill();
    };
    const bars = (
      value: string,
      x: number,
      y: number,
      w: number,
      h: number,
    ) => {
      const raw = BWIP.raw({ bcid: 'code128', text: value })[0].sbs as number[];
      const unit = w / (raw.reduce((a, b) => a + b, 0) + 20);
      let pos = x + 10 * unit;
      raw.forEach((v, i) => {
        if (i % 2 === 0)
          doc
            .fillColor('black')
            .rect(pos * mm, y * mm, v * unit * mm, h * mm)
            .fill();
        pos += v * unit;
      });
    };
    try {
      for (const item of isCarton ? boxes : items) {
        doc.addPage({ size: [width * mm, height * mm], margin: 0 });
        if (!isCarton) {
          const l = d.label,
            title = [d.model, d.style, d.color].filter(Boolean).join(' '),
            lines = [
              title,
              '製造日期 ' + d.manufactureDate.replaceAll('-', '').slice(0, 6),
              'SN: ' + item.sn,
            ];
          const bottom = l.textY + l.fontSize * 3.8;
          if (bottom > l.height)
            throw new BadRequestException('文字高度超出標籤');
          const tw = Math.max(
            ...lines.map(
              (line) =>
                doc
                  .font(font)
                  .fontSize(l.fontSize * mm)
                  .widthOfString(line) / mm,
            ),
          );
          if (
            l.showQr &&
            l.textX < l.qrX + l.qrSize &&
            l.textX + tw > l.qrX &&
            l.textY < l.qrY + l.qrSize &&
            bottom > l.qrY
          )
            throw new BadRequestException('文字與 QR Code 重疊，請調整版面');
          lines.forEach((line, i) =>
            text(
              line,
              l.textX,
              l.textY + i * l.fontSize * 1.25,
              l.fontSize,
              l.width - l.textX,
            ),
          );
          if (l.showQr) qr(item.sn, l.qrX, l.qrY, l.qrSize);
        } else {
          const s = scale;
          fit('型號: ' + d.model, 3 * s, 3 * s, 3 * s, 32 * s);
          fit('一箱共 ' + item.quantity + ' 入', 37 * s, 3 * s, 3 * s, 20 * s);
          fit('款式: ' + (d.style || '—'), 3 * s, 9 * s, 2.5 * s, 28 * s);
          fit('顏色: ' + (d.color || '—'), 3 * s, 14 * s, 2.5 * s, 28 * s);
          bars(d.barcode, 32 * s, 9 * s, 25 * s, 7 * s);
          fit(d.barcode, 33 * s, 17 * s, 1.7 * s, 24 * s);
          bars(item.id, 3 * s, 24 * s, 54 * s, 9 * s);
          fit('箱號: ' + item.id, 3 * s, 35 * s, 2.5 * s, 54 * s);
          if (kind !== 'cartons-no-sn') {
            qr(item.serials.join('ㆍ'), 3 * s, 41 * s, 31 * s);
            fit('箱內序號', 36 * s, 44 * s, 2.4 * s, 21 * s);
            fit(item.serials[0], 35 * s, 52 * s, 2.2 * s, 22 * s);
            text('至', 43 * s, 58 * s, 2 * s, 10 * s);
            fit(
              item.serials[item.serials.length - 1],
              35 * s,
              64 * s,
              2.2 * s,
              22 * s,
            );
          }
        }
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
