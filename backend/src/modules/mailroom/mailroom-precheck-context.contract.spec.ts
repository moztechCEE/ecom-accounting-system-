import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SavePrecheckDto } from './mailroom-precheck.dto';
import {
  precheckContext,
  savePrecheckContext,
} from './mailroom-precheck-context.contract';

const actor = { id: 'clerk-a', name: 'SYNTHETIC CLERK' };
const now = new Date('2026-10-27T09:00:00.000Z');
const legacy = { checks: [], evidence: [], notRequiredReason: null };
describe('explicit optional mailroom intake observations', () => {
  it('preserves legacy documents, stamps a manual observation, and never claims a warranty write', () => {
    expect(precheckContext(legacy)).toEqual({});
    expect(savePrecheckContext({}, legacy, actor, now)).toEqual({});
    const value = savePrecheckContext(
      {
        warrantyReview: {
          status: 'CORRECTED_EXTERNALLY',
          note: '  人員於原後台核對  ',
        },
        mailroomIssue: {
          symptom: '  線材無輸出  ',
          preliminaryReason: '  尚待技師確認  ',
        },
      },
      legacy,
      actor,
      now,
    );
    expect(value).toEqual({
      warrantyReview: {
        schema: 1,
        method: 'MANUAL_EXTERNAL',
        status: 'CORRECTED_EXTERNALLY',
        note: '人員於原後台核對',
        warrantyNumber: null,
        recordedById: actor.id,
        recordedByName: actor.name,
        recordedAt: now.toISOString(),
      },
      mailroomIssue: {
        schema: 1,
        symptom: '線材無輸出',
        preliminaryReason: '尚待技師確認',
      },
    });
    expect(precheckContext({ ...legacy, ...value })).toEqual(value);
    expect(JSON.stringify(value)).not.toMatch(
      /SYNCED|warrantyId|expires_at|isUnderWarranty/,
    );
  });
  it('preserves omitted fields and the review author/time when a later test save repeats the same note', () => {
    const saved = savePrecheckContext(
      {
        warrantyReview: { status: 'CHECKED' },
        mailroomIssue: { symptom: '故障' },
      },
      legacy,
      actor,
      now,
    );
    expect(
      savePrecheckContext(
        {},
        { ...legacy, ...saved },
        { id: 'clerk-b', name: 'B' },
        new Date(),
      ),
    ).toEqual(saved);
    expect(
      savePrecheckContext(
        { warrantyReview: { status: 'CHECKED', note: ' ' } },
        { ...legacy, ...saved },
        { id: 'clerk-b', name: 'B' },
        new Date(),
      ),
    ).toEqual(saved);
    const cleared = savePrecheckContext(
      { warrantyReview: null, mailroomIssue: null },
      { ...legacy, ...saved },
      actor,
      now,
    );
    expect(cleared).toEqual({ warrantyReview: null, mailroomIssue: null });
  });
  it('bounds a warranty reference and retains or explicitly clears it without guessing a master identity', () => {
    const saved = savePrecheckContext(
      {
        warrantyReview: { status: 'CHECKED', warrantyNumber: 'W'.repeat(200) },
      },
      legacy,
      actor,
      now,
    );
    expect(saved.warrantyReview?.warrantyNumber).toHaveLength(200);
    expect(
      savePrecheckContext(
        { warrantyReview: { status: 'CHECKED' } },
        { ...legacy, ...saved },
        actor,
        now,
      ),
    ).toEqual(saved);
    expect(
      savePrecheckContext(
        { warrantyReview: { status: 'CHECKED', warrantyNumber: null } },
        { ...legacy, ...saved },
        actor,
        now,
      ).warrantyReview?.warrantyNumber,
    ).toBeNull();
    expect(() =>
      savePrecheckContext(
        {
          warrantyReview: {
            status: 'CHECKED',
            warrantyNumber: 'W'.repeat(201),
          },
        },
        legacy,
        actor,
        now,
      ),
    ).toThrow('保固編號過長');
  });
  it('rejects fabricated audit identity, unknown status/structure and oversized text', () => {
    for (const warrantyReview of [
      { status: 'SYNCED' },
      { status: 'CHECKED', recordedById: 'admin' },
      { status: 'CHECKED', note: 'x'.repeat(2001) },
      [],
      'CHECKED',
    ])
      expect(() =>
        savePrecheckContext({ warrantyReview } as never, legacy, actor, now),
      ).toThrow();
    expect(() =>
      savePrecheckContext(
        { mailroomIssue: { customerIssue: 'overwrite' } } as never,
        legacy,
        actor,
        now,
      ),
    ).toThrow('未定義');
    expect(() =>
      precheckContext({ ...legacy, warrantyReview: { schema: 2 } }),
    ).toThrow();
  });
  it('validates optional/null DTO fields and rejects nested injected server stamps', async () => {
    const body = {
      entityId: 'company-a',
      requestId: '00000000-0000-4000-8000-000000000020',
      expectedVersion: 1,
      expectedRevision: 1,
      status: 'DRAFT',
      templateBinding: null,
      checks: [],
      warrantyReview: null,
      mailroomIssue: null,
    };
    const options = { whitelist: true, forbidNonWhitelisted: true };
    expect(
      await validate(plainToInstance(SavePrecheckDto, body), options),
    ).toHaveLength(0);
    const errors = await validate(
      plainToInstance(SavePrecheckDto, {
        ...body,
        warrantyReview: { status: 'CHECKED', recordedById: 'admin' },
      }),
      options,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].children?.[0].property).toBe('recordedById');
  });
});
