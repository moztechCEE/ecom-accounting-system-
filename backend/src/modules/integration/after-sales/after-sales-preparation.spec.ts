import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { PERMISSIONS_KEY } from '../../../common/decorators/permissions.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import {
  parseBrand,
  parseQuote,
  quoteTotal,
  customerQuote,
  sourcePaymentBrand,
} from './after-sales-preparation.contract';
import { AfterSalesPreparationService } from './after-sales-preparation.service';
import {
  AfterSalesPreparationController,
  SaveBrandDto,
} from './after-sales-preparation.controller';
const brand = {
  code: 'AIRITY',
  name: 'AIRITY',
  active: true,
  lineOfficialId: '',
  channelId: '',
  liffId: '',
  invoiceLegalName: '測試開票公司',
  invoiceTaxId: '',
  invoiceMerchantLabel: 'INTERNAL-ONLY',
};
const input = {
  sourceCaseId: 'case-1',
  brandCode: 'AIRITY',
  brandVersion: 1,
  lines: [{ description: '檢測', quantity: 3, unitPrice: '0.10' }],
  customerNote: '',
};
const source = {
  id: 'case-1',
  caseNumber: 'CASE-001',
  type: 'REPAIR',
  status: 'RECEIVED',
  sections: [],
};
function setup() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const prisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (fn) => fn(tx)),
  };
  const legacy = { getWorkbenchCase: jest.fn().mockResolvedValue(source) };
  return {
    prisma,
    tx,
    legacy,
    service: new AfterSalesPreparationService(prisma as any, legacy as any),
  };
}
describe('after-sales brand and quote preparation', () => {
  it('uses exact minor units and rejects malformed amounts and unknown fields', () => {
    expect(quoteTotal(parseQuote(input).lines)).toBe('0.30');
    for (const unitPrice of ['-1', '1e4', '0.001', 'NaN']) {
      expect(() =>
        parseQuote({ ...input, lines: [{ ...input.lines[0], unitPrice }] }),
      ).toThrow();
    }
    expect(() => parseQuote({ ...input, lines: [] })).toThrow();
    expect(() => parseQuote({ ...input, invoiceStatus: 'ISSUED' })).toThrow();
    expect(() =>
      parseQuote({ ...input, lines: [{ ...input.lines[0], quantity: 0 }] }),
    ).toThrow();
  });
  it('does not accept credentials, invoice verification claims or a brand fallback', () => {
    expect(parseBrand(brand).code).toBe('AIRITY');
    expect(() =>
      parseBrand({ ...brand, channelSecret: 'test-secret' }),
    ).toThrow();
    expect(() => parseBrand({ ...brand, invoiceVerified: true })).toThrow();
    expect(() => parseBrand({ ...brand, code: '' })).toThrow();
    expect(() => parseBrand({ ...brand, invoiceTaxId: '123' })).toThrow();
  });
  it('projects only the chosen customer brand without internal issuer routing', () => {
    const publicQuote = customerQuote(brand, 'CASE-001', parseQuote(input));
    expect(publicQuote.brandName).toBe('AIRITY');
    expect(JSON.stringify(publicQuote)).not.toMatch(
      /MOZTECH|INTERNAL-ONLY|測試開票公司|invoice|channel|entity/,
    );
  });
  it('keeps existing payment brands and stops ambiguous source records', () => {
    const section = (value: string) => ({
      key: 'paymentRequests',
      records: [{ fields: [{ key: 'brand', value }] }],
    });
    expect(sourcePaymentBrand({ sections: [section('BONSON')] })).toBe(
      'BONSON',
    );
    expect(() =>
      sourcePaymentBrand({ sections: [section('BONSON'), section('MOZTECH')] }),
    ).toThrow();
    expect(sourcePaymentBrand({ sections: [] })).toBeNull();
  });
  it('limits config mutation to administrators and requires explicit quote-create permission', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        ROLES_KEY,
        AfterSalesPreparationController.prototype.saveBrand,
      ),
    ).toEqual(['SUPER_ADMIN', 'ADMIN']);
    expect(
      reflector.get(
        PERMISSIONS_KEY,
        AfterSalesPreparationController.prototype.saveDraft,
      ),
    ).toEqual(['after_sales_cases:read', 'after_sales_cases:create']);
  });
  it('DTO rejects forged actor/version/extra top-level fields', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { entityId: 'test', version: 0, data: brand, actorId: 'forged' },
        { type: 'body', metatype: SaveBrandDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('scopes listing and compare-and-swap by company', async () => {
    const { prisma, service } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await service.brands('company-a')).toEqual([]);
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual(['company-a']);
    await expect(
      service.saveBrand('company-a', 'actor', 2, brand),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('replays only the same payload and actor without touching source records', async () => {
    const { prisma, legacy, service } = setup();
    const hash = createHash('sha256')
      .update(JSON.stringify(parseQuote(input)))
      .digest('hex');
    prisma.$queryRaw.mockResolvedValue([
      { request_hash: hash, created_by: 'actor', data: { id: 'same' } },
    ]);
    expect(await service.saveDraft('company-a', 'actor', 'key', input)).toEqual(
      { id: 'same' },
    );
    expect(legacy.getWorkbenchCase).not.toHaveBeenCalled();
    await expect(
      service.saveDraft('company-a', 'different-actor', 'key', input),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.saveDraft('company-a', 'actor', 'key', {
        ...input,
        customerNote: 'changed',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects stale or disabled brands instead of falling back', async () => {
    const { prisma, tx, service } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    tx.$queryRaw.mockResolvedValue([{ data: brand, version: 2 }]);
    await expect(
      service.saveDraft('company-a', 'actor', 'key', input),
    ).rejects.toBeInstanceOf(ConflictException);
    tx.$queryRaw.mockResolvedValue([
      { data: { ...brand, active: false }, version: 1 },
    ]);
    await expect(
      service.saveDraft('company-a', 'actor', 'key', input),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects brand changes on a bound case', async () => {
    const { prisma, tx, service } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    tx.$queryRaw
      .mockResolvedValueOnce([{ data: brand, version: 1 }])
      .mockResolvedValueOnce([{ brand_code: 'BONSON' }]);
    await expect(
      service.saveDraft('company-a', 'actor', 'key', input),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects source payment brand mismatch and closed/non-repair cases before storage', async () => {
    const { prisma, legacy, service } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    legacy.getWorkbenchCase.mockResolvedValue({
      ...source,
      sections: [
        {
          key: 'paymentRequests',
          records: [{ fields: [{ key: 'brand', value: 'MOZTECH' }] }],
        },
      ],
    });
    await expect(
      service.saveDraft('company-a', 'actor', 'key', input),
    ).rejects.toBeInstanceOf(ConflictException);
    legacy.getWorkbenchCase.mockResolvedValue({
      ...source,
      status: 'COMPLETED',
    });
    await expect(
      service.saveDraft('company-a', 'actor', 'key', input),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('stores an immutable draft snapshot without changing source workflow or financial state', async () => {
    const { prisma, tx, service } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    tx.$queryRaw
      .mockResolvedValueOnce([{ data: brand, version: 1 }])
      .mockResolvedValueOnce([{ brand_code: 'AIRITY' }])
      .mockImplementationOnce(async (_sql, ...args) => [
        { data: JSON.parse(args[4]), created_by: 'actor' },
      ]);
    const draft = await service.saveDraft('company-a', 'actor', 'key', input);
    expect(draft).toMatchObject({
      status: 'draft',
      brandCode: 'AIRITY',
      deliveryStatus: 'not_sent',
      invoiceStatus: 'not_issued',
    });
    expect((draft.brandSnapshot as any).invoiceMerchantLabel).toBe(
      'INTERNAL-ONLY',
    );
    expect(JSON.stringify(draft.customerPreview)).not.toContain(
      'INTERNAL-ONLY',
    );
  });
});
