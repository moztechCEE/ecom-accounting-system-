import { BadRequestException } from '@nestjs/common';
import {
  identifier,
  hasControlCharacters,
  internalScanCode as validateInternalScanCode,
  isNoSerial,
  SnData,
  validateActualSN,
} from './sn-labels.rules';

export type CartonManifestRequest = {
  from: number;
  to: number;
  mapping: unknown;
};
export type CartonManifestBox = {
  id: string;
  quantity: number;
  serials: unknown;
};

export function buildCartonManifest(
  sourceReference: string,
  data: SnData,
  boxes: readonly CartonManifestBox[],
  mappingInput: unknown,
) {
  const mapping =
    mappingInput &&
    typeof mappingInput === 'object' &&
    !Array.isArray(mappingInput)
      ? (mappingInput as Record<string, unknown>)
      : null;
  if (mapping?.confirmed !== true)
    throw new BadRequestException('請核對 WMS／ECOUNT 品號與掃描碼');
  const itemCode = identifier(mapping.itemCode, 'WMS／ECOUNT 品號');
  if (itemCode.length > 100)
    throw new BadRequestException('WMS／ECOUNT 品號不可超過 100 字');
  if (
    typeof data.productName !== 'string' ||
    !data.productName.trim() ||
    data.productName.length > 255 ||
    hasControlCharacters(data.productName)
  )
    throw new BadRequestException('批次產品名稱無效');
  const ean = data.barcode || null;
  if (ean && !/^\d{8,14}$/.test(ean))
    throw new BadRequestException('批次國際條碼格式錯誤');
  const internalScanCode =
    validateInternalScanCode(mapping.internalScanCode ?? '', !!ean) || null;
  if (!boxes.length || boxes.length > 100)
    throw new BadRequestException('每次匯出需為 1～100 箱');
  const cartons = new Set<string>(),
    serials = new Set<string>();
  return {
    format: 'corely-cartons-v1',
    sourceSystem: 'corely-erp',
    sourceReference,
    cartons: boxes.map((box) => {
      if (
        typeof box.id !== 'string' ||
        !box.id.trim() ||
        box.id.length > 128 ||
        hasControlCharacters(box.id) ||
        cartons.has(box.id)
      )
        throw new BadRequestException('批次箱號無效或重複');
      cartons.add(box.id);
      if (
        !Number.isSafeInteger(box.quantity) ||
        box.quantity < 1 ||
        box.quantity > 1000
      )
        throw new BadRequestException('箱內數量無效');
      const actualSN = isNoSerial(data)
        ? []
        : validateActualSN(box.serials, box.quantity);
      if (
        isNoSerial(data) &&
        (!Array.isArray(box.serials) || box.serials.length)
      )
        throw new BadRequestException('無 SN 箱包含序號，請核對批次');
      for (const sn of actualSN) {
        if (serials.has(sn))
          throw new BadRequestException('同一 SN 不可出現在兩箱');
        serials.add(sn);
      }
      if (serials.size > 10000)
        throw new BadRequestException('每次最多匯出 10,000 個 SN');
      return {
        cartonId: box.id,
        lines: [
          {
            itemCode,
            productName: data.productName,
            ean,
            internalScanCode,
            quantity: box.quantity,
            actualSN,
          },
        ],
      };
    }),
  };
}
