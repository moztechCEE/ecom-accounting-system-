import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ReceiptFileDto } from './dto/recognize-receipt.dto';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Do not fetch URLs supplied by a user or a model. Only validated inline bytes go to the provider.
export function parseReceiptFile(file: ReceiptFileDto) {
  const match =
    /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      file.url,
    );
  if (!match || match[1] !== file.mimeType)
    throw new BadRequestException('憑證格式不符，請上傳 JPG、PNG、WebP 或 PDF');
  const bytes = Buffer.from(match[2], 'base64');
  if (
    !bytes.length ||
    bytes.length > MAX_FILE_BYTES ||
    bytes.toString('base64') !== match[2]
  )
    throw new BadRequestException('單一憑證上限 5 MB，且必須為完整檔案');
  const magic = bytes.subarray(0, 12);
  const valid =
    file.mimeType === 'application/pdf'
      ? magic.subarray(0, 5).toString() === '%PDF-'
      : file.mimeType === 'image/png'
        ? magic
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : file.mimeType === 'image/jpeg'
          ? magic[0] === 255 && magic[1] === 216 && magic[2] === 255
          : magic.subarray(0, 4).toString() === 'RIFF' &&
            magic.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new BadRequestException('檔案內容與類型不符');
  return {
    inlineData: { mimeType: file.mimeType, data: match[2] },
    size: bytes.length,
    fingerprint: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function parseReceiptFiles(
  files: Array<{ name: string; url: string; mimeType?: string }>,
) {
  if (!Array.isArray(files) || files.length > 5)
    throw new BadRequestException('每次最多 5 個憑證檔案');
  const parsed = files.map((file) => parseReceiptFile(file as ReceiptFileDto));
  if (parsed.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024)
    throw new BadRequestException('憑證總大小上限 10 MB');
  return parsed;
}
