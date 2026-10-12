import * as XLSX from "xlsx";

/** A single text column, without guessed headers, formulas or numeric coercion. */
export function readExistingSerialWorkbook(buffer: ArrayBuffer): string[] {
  const book = XLSX.read(buffer, { type: "array", raw: true });
  if (book.SheetNames.length !== 1)
    throw new Error("請提供單一工作表的 SN 清單");
  const sheet = book.Sheets[book.SheetNames[0]],
    range = sheet["!ref"];
  if (!range) throw new Error("SN 檔案沒有內容");
  const decoded = XLSX.utils.decode_range(range);
  if (decoded.e.r - decoded.s.r >= 10000 || decoded.e.c !== decoded.s.c)
    throw new Error("請提供一欄、最多 10,000 筆 SN，無表頭");
  const serials: string[] = [];
  for (let row = decoded.s.r; row <= decoded.e.r; row++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: decoded.s.c })];
    if (!cell || String(cell.v ?? "").trim() === "") continue;
    if (cell.t !== "s" || cell.f)
      throw new Error("SN 必須是文字欄位，不可使用數值或公式");
    serials.push(String(cell.v).trim());
  }
  return serials;
}
