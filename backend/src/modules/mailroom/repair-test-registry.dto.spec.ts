import { ValidationPipe } from '@nestjs/common';
import {
  CreateRepairStandardDto,
  RecordRepairCalibrationDto,
  NewRepairStandardRevisionDto,
  UpdateRepairStandardDraftDto,
  ReviewRepairStandardDto,
  RepairRegistryProductsQueryDto,
} from './repair-test-registry.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});
const body = () => ({
  entityId: 'company',
  requestId: 'standard-request',
  productId: 'product',
  sku: 'SYNTHETIC-SKU',
  data: {
    checks: [
      {
        key: 'check',
        name: '合成測試',
        requiredForInspection: false,
        requiredForCompletion: true,
        requiresCalibration: false,
        standard: { kind: 'BOOLEAN', instruction: '合成基準', expected: false },
      },
    ],
  },
});

describe('actual registry DTO pipe under global implicit conversion', () => {
  it('preserves literal false flags and literal expected=false', async () => {
    const parsed = (await pipe.transform(body(), {
      type: 'body',
      metatype: CreateRepairStandardDto,
    })) as CreateRepairStandardDto;
    expect(parsed.data.checks[0]).toMatchObject({
      requiredForInspection: false,
      requiresCalibration: false,
      standard: { expected: false },
    });
  });
  it.each(['false', 'true', 0, 1, null])(
    'rejects forged boolean %j without converting it into an approved requirement',
    async (value) => {
      const input = body();
      Object.assign(input.data.checks[0], { requiredForCompletion: value });
      await expect(
        pipe.transform(input, {
          type: 'body',
          metatype: CreateRepairStandardDto,
        }),
      ).rejects.toThrow();
    },
  );
  it.each(['false', 'true', 0, 1])(
    'rejects nonboolean measurement standard expected=%j',
    async (value) => {
      const input = body();
      Object.assign(input.data.checks[0].standard, { expected: value });
      await expect(
        pipe.transform(input, {
          type: 'body',
          metatype: CreateRepairStandardDto,
        }),
      ).rejects.toThrow();
    },
  );
  it('rejects client-supplied review state or reviewer fields', async () => {
    await expect(
      pipe.transform(
        { ...body(), status: 'REVIEWED', reviewedById: 'client' },
        { type: 'body', metatype: CreateRepairStandardDto },
      ),
    ).rejects.toThrow();
  });
  it('requires calibration certificate and actual ISO interval fields', async () => {
    await expect(
      pipe.transform(
        {
          entityId: 'company',
          requestId: 'cal-record-key',
          instrumentId: 'meter',
          equipmentType: 'SYNTHETIC',
          proofReference: '',
          validFrom: '2026-02-30T00:00:00Z',
          validUntil: 'tomorrow',
        },
        { type: 'body', metatype: RecordRepairCalibrationDto },
      ),
    ).rejects.toThrow();
  });
});

describe('template version and product search DTO boundary', () => {
  it.each([
    NewRepairStandardRevisionDto,
    UpdateRepairStandardDraftDto,
    ReviewRepairStandardDto,
  ])('requires a precise content hash for %p', async (metatype) => {
    const input = {
      entityId: 'company',
      requestId: 'version-request-1',
      expectedRevision: 1,
      ...(metatype === ReviewRepairStandardDto ? {} : { data: body().data }),
    };
    await expect(
      pipe.transform(input, { type: 'body', metatype }),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { ...input, expectedContentHash: '0'.repeat(64) },
        { type: 'body', metatype },
      ),
    ).resolves.toBeDefined();
    await expect(
      pipe.transform(
        { ...input, expectedContentHash: 'bad-hash' },
        { type: 'body', metatype },
      ),
    ).rejects.toThrow();
  });
  it('accepts product search text but does not accept client-selected employee or hidden scope', async () => {
    await expect(
      pipe.transform(
        { entityId: 'company', q: 'Model A' },
        { type: 'query', metatype: RepairRegistryProductsQueryDto },
      ),
    ).resolves.toBeDefined();
    await expect(
      pipe.transform(
        { entityId: 'company', q: 'x'.repeat(161) },
        { type: 'query', metatype: RepairRegistryProductsQueryDto },
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { entityId: 'company', isActive: false },
        { type: 'query', metatype: RepairRegistryProductsQueryDto },
      ),
    ).rejects.toThrow();
  });
});
