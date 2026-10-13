import { Storage } from '@google-cloud/storage';
import { Readable } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  RepairMediaUploadDto,
  RepairReportPublishDto,
} from './repair-evidence.dto';
import {
  RepairMediaStorageService,
  matchesRepairMediaMagic,
  mediaLimit,
} from './repair-media-storage.service';
jest.mock('@google-cloud/storage', () => ({ Storage: jest.fn() }));
const key = 'repair-media/company/item/00000000-0000-4000-8000-000000000001';
function png() {
  const body = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(body);
  body.write('IHDR', 12);
  body.writeUInt32BE(1, 16);
  body.writeUInt32BE(1, 20);
  return body;
}
describe('private repair storage and original-value DTO guards', () => {
  let service: RepairMediaStorageService, body: Buffer;
  let file: {
    getMetadata: jest.Mock;
    createReadStream: jest.Mock;
    createResumableUpload: jest.Mock;
  };
  let bucket: jest.Mock, fileFactory: jest.Mock;
  const original = { ...process.env };
  beforeEach(() => {
    process.env.ERP_DEV_SANDBOX = 'false';
    process.env.REPAIR_MEDIA_ENABLED = 'true';
    process.env.REPAIR_MEDIA_BUCKET = 'synthetic-repair-private';
    process.env.REPAIR_MEDIA_UPLOAD_ORIGIN = 'https://synthetic-erp.invalid';
    body = png();
    file = {
      getMetadata: jest.fn(() =>
        Promise.resolve([
          {
            generation: '12345678901234567',
            size: body.length,
            contentType: 'image/png',
          },
        ]),
      ),
      createReadStream: jest.fn(() =>
        Readable.from([body.subarray(0, 16), body.subarray(16)]),
      ),
      createResumableUpload: jest.fn(() =>
        Promise.resolve([
          'https://storage.googleapis.com/upload/storage/v1/b/synthetic-repair-private/o?upload_id=SYNTHETIC',
        ]),
      ),
    };
    fileFactory = jest.fn(() => file);
    bucket = jest.fn(() => ({ file: fileFactory }));
    jest
      .mocked(Storage)
      .mockImplementation(() => ({ bucket }) as unknown as Storage);
    service = new RepairMediaStorageService();
  });
  afterEach(() => {
    for (const name of [
      'ERP_DEV_SANDBOX',
      'REPAIR_MEDIA_ENABLED',
      'REPAIR_MEDIA_BUCKET',
      'REPAIR_MEDIA_UPLOAD_ORIGIN',
    ]) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });
  it('does not start any SDK operation if the sandbox scope rejects it', async () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    const symbol = Symbol.for('corely.dev.repair-storage.v1');
    const globals = globalThis as unknown as { [key: symbol]: unknown };
    const previous = globals[symbol];
    globals[symbol] = () => Promise.reject(new Error('blocked'));
    try {
      await expect(
        service.mint('synthetic-repair-private', key, 'image/png'),
      ).rejects.toThrow();
      await expect(
        service.verify('synthetic-repair-private', key, 'image/png'),
      ).rejects.toThrow();
      const stream = service.stream('synthetic-repair-private', key, '7');
      await expect(
        (async () => {
          for await (const value of stream) void value;
        })(),
      ).rejects.toThrow('檢修影像讀取失敗');
      expect(bucket).not.toHaveBeenCalled();
    } finally {
      globals[symbol] = previous;
    }
  });
  it('keeps metadata, byte hashing and lazy private streaming inside the runtime context', async () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    const symbol = Symbol.for('corely.dev.repair-storage.v1');
    const globals = globalThis as unknown as { [key: symbol]: unknown };
    const previous = globals[symbol];
    const context = new AsyncLocalStorage<string>();
    globals[symbol] = (
      b: string,
      k: string,
      operation: () => Promise<unknown>,
    ) => {
      expect([b, k]).toEqual(['synthetic-repair-private', key]);
      return context.run('allowed', operation);
    };
    file.getMetadata.mockImplementation(() => {
      expect(context.getStore()).toBe('allowed');
      return Promise.resolve([
        { generation: '7', size: 32, contentType: 'image/png' },
      ]);
    });
    file.createResumableUpload.mockImplementation(() => {
      expect(context.getStore()).toBe('allowed');
      return Promise.resolve([
        'https://storage.googleapis.com/upload?upload_id=SYNTHETIC',
      ]);
    });
    file.createReadStream.mockImplementation(() => {
      expect(context.getStore()).toBe('allowed');
      return Readable.from(
        (async function* () {
          await Promise.resolve();
          expect(context.getStore()).toBe('allowed');
          yield body;
        })(),
      );
    });
    try {
      await service.mint('synthetic-repair-private', key, 'image/png');
      await service.verify('synthetic-repair-private', key, 'image/png');
      const stream = service.stream('synthetic-repair-private', key, '7');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks)).toEqual(body);
      expect(context.getStore()).toBeUndefined();
    } finally {
      globals[symbol] = previous;
    }
  });
  it('sanitizes provider stream failures before the private response receives them', async () => {
    file.createReadStream.mockImplementation(() =>
      Readable.from(
        (async function* () {
          await Promise.resolve();
          throw new Error('SECRET_PROVIDER_URI');
          yield body;
        })(),
      ),
    );
    const stream = service.stream('synthetic-repair-private', key, '7');
    await expect(
      (async () => {
        for await (const value of stream) void value;
      })(),
    ).rejects.toThrow('檢修影像讀取失敗');
  });
  it('mints only the configured bucket/path and uses create-only generation precondition', async () => {
    await expect(
      service.mint('synthetic-repair-private', key, 'image/png'),
    ).resolves.toContain('storage.googleapis.com');
    expect(file.createResumableUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'https://synthetic-erp.invalid',
        preconditionOpts: { ifGenerationMatch: 0 },
      }),
    );
    await expect(
      service.mint('other-bucket', key, 'image/png'),
    ).rejects.toThrow();
    await expect(
      service.mint(
        'synthetic-repair-private',
        'https://evil.invalid/x',
        'image/png',
      ),
    ).rejects.toThrow();
  });
  it('hashes the actual bounded stream and pins the exact string generation without numeric rounding', async () => {
    const result = await service.verify(
      'synthetic-repair-private',
      key,
      'image/png',
    );
    expect(result).toEqual({
      generation: '12345678901234567',
      sha256: createHash('sha256').update(body).digest('hex'),
      sizeBytes: 32,
      contentType: 'image/png',
    });
    expect(fileFactory).toHaveBeenLastCalledWith(key, {
      generation: '12345678901234567',
    });
    expect(file.createReadStream).toHaveBeenCalledWith({
      validation: 'crc32c',
    });
  });
  it.each(['mime', 'size', 'stream length', 'magic', 'generation', 'provider'])(
    'rejects %s instead of creating a finalized proof',
    async (reason) => {
      if (reason === 'mime')
        file.getMetadata.mockResolvedValue([
          { generation: '4', size: 32, contentType: 'image/svg+xml' },
        ]);
      if (reason === 'size')
        file.getMetadata.mockResolvedValue([
          {
            generation: '4',
            size: mediaLimit('image/png') + 1,
            contentType: 'image/png',
          },
        ]);
      if (reason === 'stream length')
        file.createReadStream.mockReturnValue(
          Readable.from([Buffer.alloc(33)]),
        );
      if (reason === 'magic') body = Buffer.alloc(32);
      if (reason === 'generation')
        file.getMetadata.mockResolvedValue([
          { generation: '../other', size: 32, contentType: 'image/png' },
        ]);
      if (reason === 'provider')
        file.getMetadata.mockRejectedValue(
          new Error('provider request contains SECRET'),
        );
      await expect(
        service.verify('synthetic-repair-private', key, 'image/png'),
      ).rejects.toThrow();
    },
  );
  it('never exposes a provider session URI or raw error in the failed mint response', async () => {
    file.createResumableUpload.mockRejectedValue(
      new Error('SECRET_URI upload_id=SECRET'),
    );
    await expect(
      service.mint('synthetic-repair-private', key, 'image/png'),
    ).rejects.toThrow('影像上傳暫時無法使用');
    file.createResumableUpload.mockResolvedValue([
      'https://evil.invalid/upload',
    ]);
    await expect(
      service.mint('synthetic-repair-private', key, 'image/png'),
    ).rejects.toThrow('影像上傳暫時無法使用');
  });
  it('requires explicit enabled/configured storage without assuming Source attachment storage', () => {
    process.env.REPAIR_MEDIA_ENABLED = 'false';
    expect(() => service.configuration()).toThrow();
    process.env.REPAIR_MEDIA_ENABLED = 'true';
    delete process.env.REPAIR_MEDIA_BUCKET;
    expect(() => service.configuration()).toThrow();
  });
  it('recognizes allowed media container magic and refuses HTML/SVG or mislabelled video', () => {
    const jpg = Buffer.from([255, 216, 255, 0, 255, 217]);
    expect(matchesRepairMediaMagic('image/jpeg', jpg, jpg, jpg.length)).toBe(
      true,
    );
    const webp = Buffer.alloc(16);
    webp.write('RIFF');
    webp.writeUInt32LE(8, 4);
    webp.write('WEBPVP8 ', 8);
    expect(matchesRepairMediaMagic('image/webp', webp, webp, 16)).toBe(true);
    const mp4 = Buffer.alloc(20);
    mp4.writeUInt32BE(20);
    mp4.write('ftypisom', 4);
    expect(matchesRepairMediaMagic('video/mp4', mp4, mp4, 20)).toBe(true);
    expect(matchesRepairMediaMagic('video/quicktime', mp4, mp4, 20)).toBe(
      false,
    );
    const webm = Buffer.concat([
      Buffer.from([26, 69, 223, 163]),
      Buffer.from('webm'),
    ]);
    expect(matchesRepairMediaMagic('video/webm', webm, webm, 8)).toBe(true);
    expect(
      matchesRepairMediaMagic(
        'image/png',
        Buffer.from('<svg>'),
        Buffer.alloc(0),
        5,
      ),
    ).toBe(false);
  });
  it.each([
    { expectedVersion: '5' },
    { kind: ['inspection'] },
    { phase: ['BEFORE'] },
    { contentType: 123 },
    { finalized: true },
  ])('rejects original values and foreign proof field %j', async (extra) => {
    const dto = plainToInstance(
      RepairMediaUploadDto,
      {
        entityId: 'company',
        requestId: 'synthetic-req-0001',
        expectedVersion: 5,
        kind: 'inspection',
        phase: 'BEFORE',
        contentType: 'image/png',
        ...extra,
      },
      { enableImplicitConversion: true },
    );
    expect(
      (await validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
        .length,
    ).toBeGreaterThan(0);
  });
  it('rejects publishing expiry coercion and client report content/proof overrides', async () => {
    const dto = plainToInstance(
      RepairReportPublishDto,
      {
        entityId: 'company',
        requestId: 'synthetic-req-0001',
        expectedVersion: 5,
        kind: 'inspection',
        expiresInDays: '30',
        content: { findings: 'client forged' },
      },
      { enableImplicitConversion: true },
    );
    expect(
      (await validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
        .length,
    ).toBeGreaterThan(0);
  });
});
