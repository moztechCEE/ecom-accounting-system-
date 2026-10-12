import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { readExistingSerialWorkbook } from '../src/features/sn-labels/existing-serials-file.ts';
import { isNoSerial, newDraft, previewCartons, sampleSerial, splitExistingSerials, validateExistingSerials } from '../src/features/sn-labels/model.ts';

test('existing serial input keeps zeros, case, order and partial final carton', () => {
  const actualSN = validateExistingSerials(splitExistingSerials('000001\nVendor-a02,Vendor-A02'));
  const draft = { ...newDraft('synthetic'), serialSource: 'existing' as const, actualSN, quantity: 3, capacity: 2, modelCode: 'NSI' };
  assert.equal(isNoSerial(draft), false);
  assert.equal(sampleSerial(draft), '000001');
  const preview = previewCartons(draft);
  assert.deepEqual(preview.rows.map(box => [box.quantity, box.firstSn, box.lastSn]), [[2, '000001', 'Vendor-a02'], [1, 'Vendor-A02', 'Vendor-A02']]);
  assert.throws(() => validateExistingSerials(['Vendor-a02', 'Vendor-a02']), /重複/);
  for (const sn of ['SN A', 'SN,A', 'CTN-001', 'CARTON:001', 'x'.repeat(101)]) assert.throws(() => validateExistingSerials([sn]));
});

const workbook = (cells: unknown[][], patch?: (sheet: XLSX.WorkSheet) => void) => {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(cells);
  patch?.(sheet); XLSX.utils.book_append_sheet(book, sheet, 'SN');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
};
test('text CSV and XLSX imports preserve exact serial identities, refusing numeric/duplicate columns and formulas', () => {
  assert.deepEqual(readExistingSerialWorkbook(workbook([['000001'], ['Vendor-a02']])), ['000001', 'Vendor-a02']);
  const csv = new TextEncoder().encode('000001\nVendor-a02\n').buffer;
  assert.deepEqual(readExistingSerialWorkbook(csv), ['000001', 'Vendor-a02']);
  assert.throws(() => readExistingSerialWorkbook(workbook([[12345]])), /文字欄位/);
  assert.throws(() => readExistingSerialWorkbook(workbook([['SN1', 'SN2']])), /一欄/);
  assert.throws(() => readExistingSerialWorkbook(workbook([['SN1']], sheet => { sheet.A1.f = '"SN1"'; })), /公式/);
});
