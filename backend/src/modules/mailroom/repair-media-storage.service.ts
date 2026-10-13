import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Storage, type FileMetadata } from '@google-cloud/storage';
import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { withRepairStorage } from './repair-storage-context';

export const REPAIR_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;
export const mediaLimit = (type: string) =>
  type.startsWith('image/') ? 10 * 1024 * 1024 : 128 * 1024 * 1024;
export function matchesRepairMediaMagic(
  type: string,
  head: Buffer,
  tail: Buffer,
  size: number,
) {
  if (type === 'image/jpeg')
    return (
      head.length >= 3 &&
      head[0] === 255 &&
      head[1] === 216 &&
      head[2] === 255 &&
      tail.subarray(-2).equals(Buffer.from([255, 217]))
    );
  if (type === 'image/png')
    return (
      head.length >= 24 &&
      head
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      head.toString('ascii', 12, 16) === 'IHDR' &&
      head.readUInt32BE(16) > 0 &&
      head.readUInt32BE(20) > 0 &&
      head.readUInt32BE(16) <= 16384 &&
      head.readUInt32BE(20) <= 16384
    );
  if (type === 'image/webp')
    return (
      head.length >= 16 &&
      head.toString('ascii', 0, 4) === 'RIFF' &&
      head.toString('ascii', 8, 12) === 'WEBP' &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(head.toString('ascii', 12, 16)) &&
      head.readUInt32LE(4) + 8 === size
    );
  if (type === 'video/webm')
    return (
      head.length >= 8 &&
      head.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
      head.includes(Buffer.from('webm'))
    );
  if (['video/mp4', 'video/quicktime'].includes(type)) {
    if (
      head.length < 16 ||
      head.toString('ascii', 4, 8) !== 'ftyp' ||
      head.readUInt32BE(0) < 16 ||
      head.readUInt32BE(0) > size
    )
      return false;
    const brand = head.toString('ascii', 8, 12);
    return type === 'video/quicktime'
      ? brand === 'qt  '
      : ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV'].includes(
          brand,
        );
  }
  return false;
}

@Injectable()
export class RepairMediaStorageService {
  private readonly storage = new Storage();
  configuration() {
    const bucket = process.env.REPAIR_MEDIA_BUCKET;
    if (
      process.env.REPAIR_MEDIA_ENABLED !== 'true' ||
      !bucket ||
      !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(bucket)
    )
      throw new ServiceUnavailableException('檢修影像服務尚未啟用');
    return { bucket };
  }
  private file(bucket: string, key: string, generation?: string) {
    if (
      bucket !== this.configuration().bucket ||
      !/^repair-media\/[^/]+\/[^/]+\/[a-f0-9-]{36}$/.test(key)
    )
      throw new BadRequestException('檢修影像位置不符');
    return this.storage
      .bucket(bucket)
      .file(key, generation ? { generation } : undefined);
  }
  async mint(bucket: string, key: string, type: string) {
    if (
      !REPAIR_MEDIA_TYPES.includes(type as (typeof REPAIR_MEDIA_TYPES)[number])
    )
      throw new BadRequestException('影像格式不支援');
    const origin = process.env.REPAIR_MEDIA_UPLOAD_ORIGIN;
    if (
      !origin ||
      new URL(origin).origin !== origin ||
      !origin.startsWith('https://')
    )
      throw new ServiceUnavailableException('檢修影像上傳來源尚未設定');
    let uri: string;
    try {
      [uri] = await withRepairStorage(bucket, key, () =>
        this.file(bucket, key).createResumableUpload({
          origin,
          metadata: { contentType: type, cacheControl: 'private, no-store' },
          preconditionOpts: { ifGenerationMatch: 0 },
        }),
      );
    } catch {
      throw new ServiceUnavailableException('影像上傳暫時無法使用');
    }
    const url = new URL(uri);
    if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com')
      throw new ServiceUnavailableException('影像上傳暫時無法使用');
    return uri;
  }
  async verify(bucket: string, key: string, expectedType: string) {
    return withRepairStorage(bucket, key, () =>
      this.verifyWithinContext(bucket, key, expectedType),
    );
  }
  private async verifyWithinContext(
    bucket: string,
    key: string,
    expectedType: string,
  ) {
    const file = this.file(bucket, key);
    let metadata: FileMetadata;
    try {
      [metadata] = await file.getMetadata();
    } catch {
      throw new BadRequestException('影像尚未完成上傳');
    }
    const size = Number(metadata.size),
      generation = metadata.generation;
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > mediaLimit(expectedType) ||
      metadata.contentType !== expectedType ||
      !generation ||
      !/^\d+$/.test(String(generation))
    )
      throw new BadRequestException('影像大小或格式不符');
    const stream = this.file(bucket, key, String(generation)).createReadStream({
      validation: 'crc32c',
    });
    const hash = createHash('sha256');
    let total = 0,
      head = Buffer.alloc(0),
      tail = Buffer.alloc(0);
    try {
      for await (const value of stream) {
        if (!Buffer.isBuffer(value))
          throw new BadRequestException('影像資料不符');
        total += value.length;
        if (total > mediaLimit(expectedType) || total > size)
          throw new BadRequestException('影像超過上傳限制');
        hash.update(value);
        if (head.length < 4096)
          head = Buffer.concat([head, value.subarray(0, 4096 - head.length)]);
        tail = Buffer.concat([tail, value.subarray(-32)]).subarray(-32);
      }
    } catch {
      stream.destroy();
      throw new BadRequestException('影像讀取或驗證失敗');
    }
    if (
      total !== size ||
      !matchesRepairMediaMagic(expectedType, head, tail, size)
    )
      throw new BadRequestException('影像內容與格式不符');
    return {
      generation: String(generation),
      sha256: hash.digest('hex'),
      sizeBytes: size,
      contentType: expectedType,
    };
  }
  stream(
    bucket: string,
    key: string,
    generation: string,
    range?: { start: number; end: number },
  ) {
    const output = new PassThrough();
    void withRepairStorage(bucket, key, async () => {
      const source = this.file(bucket, key, generation).createReadStream({
        validation: range ? false : 'crc32c',
        ...range,
      });
      const safeSource = Readable.from(
        (async function* () {
          try {
            for await (const chunk of source) {
              if (!Buffer.isBuffer(chunk)) throw new Error();
              yield chunk;
            }
          } catch {
            source.destroy();
            throw new Error('檢修影像讀取失敗');
          }
        })(),
      );
      await pipeline(safeSource, output);
    }).catch(() => output.destroy(new Error('檢修影像讀取失敗')));
    return output;
  }
}
