import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
export type SnData = {
  name: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  model: string;
  style: string;
  color: string;
  modelCode: string;
  styleCode: string;
  colorCode: string;
  orderDate: string;
  manufactureDate: string;
  quantity: number;
  capacity: number | null;
  label: {
    width: number;
    height: number;
    showQr: boolean;
    target: string;
    textX: number;
    textY: number;
    fontSize: number;
    qrX: number;
    qrY: number;
    qrSize: number;
  };
  cartonWidth?: number;
  cartonHeight?: number;
  serialSource?: 'generated' | 'existing';
  actualSN?: string[];
  wmsItemCode?: string;
  internalScanCode?: string;
};
export function dateYear(value: string) {
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('請填寫有效日期（2000～2099）');
  return Number(value.slice(0, 4));
}
export function validateDraft(input: any): SnData {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('草稿格式錯誤');
  const data = {} as SnData;
  for (const k of [
    'name',
    'productId',
    'productName',
    'sku',
    'barcode',
    'model',
    'style',
    'color',
    'modelCode',
    'styleCode',
    'colorCode',
    'orderDate',
    'manufactureDate',
  ]) {
    if (typeof input[k] !== 'string' || input[k].length > 250)
      throw new BadRequestException(`欄位格式錯誤：${k}`);
    data[k] = input[k].trim();
  }
  if (!data.name) throw new BadRequestException('請填寫批次名稱');
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 10000
  )
    throw new BadRequestException('單次配號數量需為 1～10,000');
  if (
    input.capacity !== null &&
    (!Number.isInteger(input.capacity) ||
      input.capacity < 1 ||
      input.capacity > 100)
  )
    throw new BadRequestException('每箱容量需為 1～100（確保整箱 QR 可編碼）');
  data.quantity = input.quantity;
  data.capacity = input.capacity;
  if (
    input.serialSource !== undefined &&
    !['generated', 'existing'].includes(input.serialSource)
  )
    throw new BadRequestException('請選擇序號來源');
  data.serialSource = input.serialSource || 'generated';
  data.actualSN =
    data.serialSource === 'existing'
      ? validateActualSN(input.actualSN, data.quantity)
      : [];
  if (data.serialSource !== 'existing' && input.actualSN?.length)
    throw new BadRequestException('既有 SN 請使用既有序號裝箱');
  data.wmsItemCode = identifier(
    input.wmsItemCode ?? data.sku,
    'WMS／ECOUNT 品號',
    true,
  );
  data.internalScanCode = internalScanCode(
    input.internalScanCode ??
      (!data.barcode && /^[A-Za-z0-9._-]{1,96}$/.test(data.sku)
        ? `ITM-${data.sku}`
        : ''),
    true,
  );
  const l = input.label;
  if (
    !l ||
    typeof l.showQr !== 'boolean' ||
    !['box', 'device'].includes(l.target)
  )
    throw new BadRequestException('標籤格式錯誤');
  for (const k of [
    'width',
    'height',
    'textX',
    'textY',
    'fontSize',
    'qrX',
    'qrY',
    'qrSize',
  ])
    if (!Number.isFinite(l[k])) throw new BadRequestException('標籤尺寸錯誤');
  if (
    l.width < 15 ||
    l.width > 150 ||
    l.height < 7.5 ||
    l.height > 150 ||
    l.fontSize < 0.8 ||
    l.fontSize > 8 ||
    l.textX < 0 ||
    l.textY < 0 ||
    l.qrX < 0 ||
    l.qrY < 0 ||
    l.qrSize < 3 ||
    l.qrX + l.qrSize > l.width ||
    l.qrY + l.qrSize > l.height
  )
    throw new BadRequestException('標籤元件超出尺寸');
  data.label = Object.fromEntries(
    [
      'width',
      'height',
      'showQr',
      'target',
      'textX',
      'textY',
      'fontSize',
      'qrX',
      'qrY',
      'qrSize',
    ].map((k) => [k, l[k]]),
  ) as SnData['label'];
  data.cartonWidth = input.cartonWidth ?? 60;
  data.cartonHeight = input.cartonHeight ?? 75;
  if (
    !Number.isFinite(data.cartonWidth) ||
    !Number.isFinite(data.cartonHeight) ||
    data.cartonWidth < 60 ||
    data.cartonWidth > 150 ||
    Math.abs(data.cartonHeight / data.cartonWidth - 1.25) > 0.001
  )
    throw new BadRequestException('規格箱標籤請依 60 × 75 mm 等比縮放');
  return data;
}
export const hasControlCharacters = (value: string) =>
  [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
export function identifier(value: unknown, label: string, optional = false) {
  if (
    typeof value !== 'string' ||
    value.length > 255 ||
    hasControlCharacters(value) ||
    (!optional && !value.trim())
  )
    throw new BadRequestException(`${label}需為 1～255 字有效文字`);
  const result = value.trim();
  if (/^(?:CARTON:|CTN-)/i.test(result))
    throw new BadRequestException(`${label}不可使用箱號`);
  return result;
}
export function internalScanCode(value: unknown, optional = false) {
  const code = identifier(value, '內部掃描碼', optional);
  if (code && !/^ITM-[A-Za-z0-9._-]{1,96}$/.test(code))
    throw new BadRequestException(
      '內部掃描碼需為 ITM- 加 1～96 字英數字、點、底線或連字號',
    );
  return code;
}
export function validateActualSN(value: unknown, quantity: number): string[] {
  if (
    !Array.isArray(value) ||
    value.length !== quantity ||
    value.length > 10000
  )
    throw new BadRequestException('既有 SN 筆數必須與產品數量一致');
  const seen = new Set<string>();
  for (const sn of value) {
    if (
      typeof sn !== 'string' ||
      !/^[\x21-\x2b\x2d-\x7e]{1,100}$/.test(sn) ||
      /^(?:CARTON:|CTN-|DRAFT:)/i.test(sn)
    )
      throw new BadRequestException(
        'SN 需為 1～100 字英數符號，不可含空白、逗號或箱號',
      );
    if (seen.has(sn))
      throw new BadRequestException(`SN ${sn} 重複，請核對原始清單`);
    seen.add(sn);
  }
  return [...value];
}
export const isNoSerial = (d: Pick<SnData, 'modelCode' | 'serialSource'>) =>
  d.serialSource !== 'existing' && d.modelCode === 'NSI';
export function allocationRule(entity: string, d: SnData) {
  const year = d.manufactureDate
    ? dateYear(d.manufactureDate)
    : d.serialSource === 'existing' || isNoSerial(d)
      ? null
      : dateYear(d.manufactureDate);
  dateYear(d.orderDate);
  if (!d.productId || !d.model || !/^[A-Za-z0-9_-]{1,40}$/.test(d.model))
    throw new BadRequestException('箱號型號需為 1～40 碼英數字、- 或 _');
  if (
    d.serialSource !== 'existing' &&
    !isNoSerial(d) &&
    (!/^[A-Z0-9]+$/.test(d.modelCode) ||
      !/^[A-Z0-9]*$/.test(d.styleCode) ||
      !/^[A-Z0-9]+$/.test(d.colorCode) ||
      !/^[A-Z0-9]{4,6}$/.test(d.modelCode + d.styleCode + d.colorCode))
  )
    throw new BadRequestException(
      '型號與顏色代碼必填；款式選填，合计 4～6 碼大寫英數字',
    );
  if (d.barcode && !/^\d{8,14}$/.test(d.barcode))
    throw new BadRequestException('國際條碼需為 8～14 碼數字；沒有國條請留空');
  if (!d.capacity) throw new BadRequestException('請填寫每箱容量');
  const prefix =
    d.modelCode +
    d.styleCode +
    d.colorCode +
    String(year).slice(-2).split('').reverse().join('');
  const scope = JSON.stringify([
    entity,
    d.modelCode,
    d.styleCode,
    d.colorCode,
    year,
  ]);
  return {
    noSerial: isNoSerial(d),
    existingSerials: d.serialSource === 'existing',
    prefix,
    scope,
    mergeKey:
      d.serialSource === 'existing'
        ? JSON.stringify([
            entity,
            d.productId,
            'existing',
            d.orderDate,
            createHash('sha256')
              .update(JSON.stringify(d.actualSN))
              .digest('hex'),
          ])
        : JSON.stringify([entity, d.productId, scope, d.orderDate]),
    cartonScope: d.orderDate + '|' + d.model,
  };
}
export function serial(prefix: string, n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 999999)
    throw new BadRequestException('流水號超過六碼上限');
  return prefix + String(n).padStart(6, '0');
}
export function cartonId(d: SnData, n: number) {
  return `CTN-${d.orderDate.slice(2).replaceAll('-', '')}-${d.model}-${String(n).padStart(3, '0')}`;
}
