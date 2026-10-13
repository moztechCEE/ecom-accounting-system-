import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SaveInspectionDto } from './repair-document.dto';
import {
  validateDocumentMediaReferences,
  validateDocumentV2,
} from './repair-document.contract';

describe('new repair document protocol and honest unpublished customer draft', () => {
  const v2 = () => ({
    protocol: 2,
    plan: 'SCRAP',
    checks: [],
    materialPlan: { mode: 'NONE', lines: [] },
    isUnderWarranty: false,
    isAccidentalDamage: true,
    customerVisibleSummary: 'Actual recorded fault',
    mediaRefs: [],
    customerReportDraft: {
      findings: 'Cause unknown',
      handling: 'No repair performed',
      verification: 'Not tested',
      mediaIds: [],
    },
  });
  it('does not attach an image to a non-existent check key', () => {
    const value = {
      ...v2(),
      mediaRefs: [
        { mediaId: 'photo', phase: 'BEFORE', checkKey: 'nonexistent' },
      ],
    };
    expect(() => validateDocumentV2(value, 'inspection')).toThrow('媒體關聯');
    const matching = {
      ...value,
      checks: [
        {
          key: 'nonexistent',
          name: 'power',
          result: 'FAIL',
          observation: 'recorded',
        },
      ],
    };
    expect(() => validateDocumentV2(matching, 'inspection')).not.toThrow();
  });
  it('requires explicit current protocol and material assessment on new submissions', () => {
    expect(validateDocumentV2(v2(), 'inspection')).toBeDefined();
    expect(() =>
      validateDocumentV2({ ...v2(), protocol: undefined }, 'inspection'),
    ).toThrow('目前工作單');
    expect(() =>
      validateDocumentV2(
        { ...v2(), materialPlan: { mode: 'UNASSESSED', lines: [] } },
        'inspection',
      ),
    ).toThrow('尚未確認');
    expect(() =>
      validateDocumentV2({ ...v2(), materialPlan: undefined }, 'inspection'),
    ).toThrow('材料');
  });
  it('client flags or unselected media cannot turn a draft into customer evidence', () => {
    expect(() =>
      validateDocumentV2(
        { ...v2(), isAccidentalDamage: 'false' },
        'inspection',
      ),
    ).toThrow('明確');
    expect(() =>
      validateDocumentV2(
        {
          ...v2(),
          customerReportDraft: {
            ...v2().customerReportDraft,
            mediaIds: ['foreign-media'],
          },
        },
        'inspection',
      ),
    ).toThrow('草稿');
    const ref = { mediaId: 'media', phase: 'AFTER' as const };
    expect(() =>
      validateDocumentMediaReferences([ref], {
        entityId: 'company',
        itemId: 'item',
        kind: 'repair',
        documentRevision: 2,
      }),
    ).toThrow('確認回執');
    expect(() =>
      validateDocumentMediaReferences(
        [ref],
        {
          entityId: 'company',
          itemId: 'item',
          kind: 'repair',
          documentRevision: 2,
        },
        [
          {
            ...ref,
            entityId: 'other',
            itemId: 'item',
            kind: 'repair',
            documentRevision: 2,
            status: 'FINALIZED',
            sha256: 'a'.repeat(64),
            sizeBytes: 100,
            contentType: 'video/mp4',
          },
        ],
      ),
    ).toThrow('確認回執');
  });
  it('production implicit conversion cannot coerce warranty/accidental/material flags or decimal strings', () => {
    const body = {
      entityId: 'company',
      requestId: 'valid-request',
      expectedVersion: 1,
      status: 'DRAFT',
      data: {
        ...v2(),
        isUnderWarranty: 'false',
        materialPlan: {
          mode: 'REQUIRED',
          lines: [
            {
              id: 'm',
              productId: 'p',
              warehouseId: 'w',
              requiredQuantity: 1,
              requiredForStart: 'false',
            },
          ],
        },
      },
    };
    const dto = plainToInstance(SaveInspectionDto, body, {
      enableImplicitConversion: true,
    });
    expect(dto.data.isUnderWarranty).toBe('false');
    expect(dto.data.materialPlan?.lines[0].requiredQuantity).toBe(1);
    expect(dto.data.materialPlan?.lines[0].requiredForStart).toBe('false');
    expect(JSON.stringify(validateSync(dto))).toContain('isBoolean');
    expect(JSON.stringify(validateSync(dto))).toContain('requiredQuantity');
  });
});
