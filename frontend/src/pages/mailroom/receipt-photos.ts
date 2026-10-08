export const PHOTO_LIMIT = 1024 * 1024;
export const ITEM_PHOTO_LIMIT = PHOTO_LIMIT * 3;
export const RECEIPT_PHOTO_LIMIT = PHOTO_LIMIT * 12;
export function photoBytes(value: string) {
  const body = value.slice(value.indexOf(",") + 1);
  return Math.max(0, Math.floor(body.length * 3 / 4) - (body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0));
}

/** Camera files are resized locally before they reach the saved evidence limits. */
export async function prepareReceiptPhoto(file: File): Promise<Blob> {
  if (file.size <= PHOTO_LIMIT) return file;
  if (file.size > 30 * 1024 * 1024) throw new Error("原始照片請小於 30 MB");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("照片無法讀取，請重新拍照或選擇其他照片"); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 20_000_000) throw new Error("照片尺寸過大，請使用 2,000 萬像素以下照片");
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("此裝置無法處理照片，請改用較小照片");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("照片處理失敗，請重試")), "image/jpeg", quality));
      if (encoded.size <= PHOTO_LIMIT) return encoded;
    }
    throw new Error("照片處理後仍超過 1 MB，請改用較小照片");
  } finally { bitmap.close(); }
}
