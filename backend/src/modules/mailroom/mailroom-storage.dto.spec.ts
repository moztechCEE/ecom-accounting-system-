import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateStorageLocationDto,
  UpdateStorageLocationDto,
} from './mailroom-storage.dto';

describe('storage location purpose request validation', () => {
  const create = {
    entityId: 'company-a',
    requestId: 'purpose-dto-01',
    rackId: 'e84d41dc-fc53-4a51-8337-51fdc3da1d51',
    code: 'A2',
    name: '第二位置',
    level: 1,
    slot: 2,
  };
  const update = {
    entityId: 'company-a',
    requestId: 'purpose-dto-01',
    expectedVersion: 1,
  };
  for (const [label, dto, base] of [
    ['create', CreateStorageLocationDto, create],
    ['update', UpdateStorageLocationDto, update],
  ] as const) {
    it.each([undefined, null, 'RECEIVING', 'OUTBOUND'])(
      `accepts ${label} purpose %p`,
      (purpose) => {
        const value = plainToInstance<
          CreateStorageLocationDto | UpdateStorageLocationDto,
          Record<string, unknown>
        >(
          dto,
          { ...base, ...(purpose === undefined ? {} : { purpose }) },
          { enableImplicitConversion: true },
        );
        expect(
          validateSync(value, { whitelist: true, forbidNonWhitelisted: true }),
        ).toEqual([]);
        expect(value.purpose).toBe(purpose);
      },
    );
    it.each([
      '',
      'INBOUND',
      'receiving',
      ' OUTBOUND',
      'null',
      false,
      true,
      1,
      {},
      [],
    ])(`rejects ${label} purpose %p without coercing it`, (purpose) => {
      const value = plainToInstance<
        CreateStorageLocationDto | UpdateStorageLocationDto,
        Record<string, unknown>
      >(dto, { ...base, purpose }, { enableImplicitConversion: true });
      expect(
        validateSync(value).some((error) => error.property === 'purpose'),
      ).toBe(true);
    });
  }
});
