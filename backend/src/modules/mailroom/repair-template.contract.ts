import { BadRequestException, ConflictException } from '@nestjs/common';
import { fingerprint } from './mailroom.contract';

export type RepairTemplateBinding = {
  id: string;
  revision: number;
  contentHash: string;
};
export type RepairTemplateCheck = {
  key: string;
  name: string;
  requiredForInspection: boolean;
  requiredForCompletion: boolean;
  requiresCalibration: boolean;
  equipmentType?: string;
  standard: {
    kind: 'OBSERVATION' | 'NUMBER' | 'BOOLEAN';
    instruction: string;
    unit?: string;
    min?: string;
    max?: string;
    expected?: boolean;
  };
};
export type RepairTestTemplate = RepairTemplateBinding & {
  schema: 1;
  status: 'REVIEWED';
  entityId: string;
  productId: string;
  sku: string;
  modelNumber?: string;
  reviewedById: string;
  reviewedAt: string;
  checks: RepairTemplateCheck[];
};
export type RepairTemplateContext = {
  entityId: string;
  productId: string;
  sku: string;
  binding: RepairTemplateBinding;
};
export type RepairMeasuredCheck = {
  key?: string;
  name: string;
  result: 'PASS' | 'FAIL' | 'NOT_TESTED';
  observation: string;
  measurementValue?: string | boolean;
  unit?: string;
  instrumentId?: string;
  calibrationRecordId?: string;
  measuredAt?: string;
};
export type RepairCalibrationProof = {
  id: string;
  entityId: string;
  instrumentId: string;
  equipmentType: string;
  status: 'VALID';
  validFrom: string;
  validUntil: string;
};
export type RepairTemplateValidationPolicy = { now?: Date };
export type RepairTemplatePhase = 'RECORD' | 'INSPECTION' | 'COMPLETION';
const text = (v: unknown, max = 160): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= max;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const timestamp = (v: unknown): number => {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      v,
    )
  )
    return NaN;
  const time = Date.parse(v),
    midnight = new Date(v.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(time) &&
    Number.isFinite(midnight.getTime()) &&
    midnight.toISOString().slice(0, 10) === v.slice(0, 10)
    ? time
    : NaN;
};
const numeric = (v: unknown): bigint => {
  if (typeof v !== 'string' || !/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(v))
    throw new BadRequestException('量測值與基準格式不符');
  const sign = v.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = v.replace(/^-/, '').split('.');
  return sign * (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0')));
};

export function repairTemplateHash(
  template: Omit<RepairTestTemplate, 'contentHash'> | RepairTestTemplate,
): string {
  const { contentHash: _hash, ...definition } = template as RepairTestTemplate;
  void _hash;
  return fingerprint(definition);
}

/** A supplied draft definition is not a reviewed SKU standard. Caller resolves the central registry. */
export function validateRepairTemplate(
  value: unknown,
  context?: RepairTemplateContext,
): RepairTestTemplate {
  if (
    !object(value) ||
    value.schema !== 1 ||
    value.status !== 'REVIEWED' ||
    !text(value.id, 128) ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !text(value.entityId, 128) ||
    !text(value.productId, 128) ||
    !text(value.sku, 100) ||
    !text(value.reviewedById, 128) ||
    !Number.isFinite(timestamp(value.reviewedAt)) ||
    !Array.isArray(value.checks) ||
    !value.checks.length ||
    value.checks.length > 50 ||
    !/^[a-f0-9]{64}$/.test(String(value.contentHash))
  )
    throw new ConflictException('機種檢測基準尚未確認');
  const keys = new Set<string>();
  for (const row of value.checks) {
    if (
      !object(row) ||
      !text(row.key, 128) ||
      keys.has(row.key) ||
      !text(row.name) ||
      typeof row.requiredForInspection !== 'boolean' ||
      typeof row.requiredForCompletion !== 'boolean' ||
      typeof row.requiresCalibration !== 'boolean' ||
      (row.requiresCalibration && !text(row.equipmentType, 100)) ||
      !object(row.standard) ||
      !text(row.standard.instruction, 2000)
    )
      throw new BadRequestException('機種測項定義不完整');
    keys.add(row.key);
    const standard = row.standard;
    if (standard.kind === 'NUMBER') {
      if (
        !text(standard.unit, 30) ||
        (standard.min === undefined && standard.max === undefined)
      )
        throw new BadRequestException('數值測項缺少單位或上下限');
      const low =
          standard.min === undefined ? undefined : numeric(standard.min),
        high = standard.max === undefined ? undefined : numeric(standard.max);
      if (low !== undefined && high !== undefined && low > high)
        throw new BadRequestException('測項上下限順序不符');
    } else if (standard.kind === 'BOOLEAN') {
      if (typeof standard.expected !== 'boolean')
        throw new BadRequestException('功能測項缺少判定基準');
    } else if (standard.kind !== 'OBSERVATION')
      throw new BadRequestException('測項判定類型不符');
  }
  const template = value as unknown as RepairTestTemplate;
  if (repairTemplateHash(template) !== template.contentHash)
    throw new ConflictException('機種檢測基準版本雜湊不符');
  if (
    context &&
    (template.entityId !== context.entityId ||
      template.productId !== context.productId ||
      template.sku !== context.sku ||
      template.id !== context.binding?.id ||
      template.revision !== context.binding?.revision ||
      template.contentHash !== context.binding?.contentHash)
  )
    throw new ConflictException('工作單與機種檢測基準不符');
  return template;
}

export function validateTemplateChecks(
  templateValue: unknown,
  checks: unknown,
  context: RepairTemplateContext,
  phase: RepairTemplatePhase,
  calibrations: unknown = [],
  policy: RepairTemplateValidationPolicy = {},
): RepairTestTemplate {
  const template = validateRepairTemplate(templateValue, context);
  const now = policy.now ?? new Date();
  if (
    !['RECORD', 'INSPECTION', 'COMPLETION'].includes(phase) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Array.isArray(checks) ||
    !Array.isArray(calibrations)
  )
    throw new BadRequestException('測項或設備校正資料不符');
  const rows = new Map<string, RepairMeasuredCheck>();
  for (const value of checks) {
    if (
      !object(value) ||
      !text(value.key, 128) ||
      rows.has(value.key) ||
      !template.checks.some((check) => check.key === value.key) ||
      !text(value.observation, 1000) ||
      typeof value.result !== 'string' ||
      !['PASS', 'FAIL', 'NOT_TESTED'].includes(value.result)
    )
      throw new BadRequestException('測項遺漏、重複或結果不完整');
    rows.set(value.key, value as unknown as RepairMeasuredCheck);
  }
  for (const spec of template.checks) {
    const required =
      phase === 'RECORD'
        ? false
        : phase === 'INSPECTION'
          ? spec.requiredForInspection
          : spec.requiredForCompletion;
    const check = rows.get(spec.key);
    if (!check) {
      if (required) throw new ConflictException('必要測項尚未完成');
      else continue;
    }
    if (check.name !== spec.name)
      throw new ConflictException('測項名稱與機種基準不符');
    if (check.unit !== undefined && check.unit !== spec.standard.unit)
      throw new ConflictException('量測單位與機種基準不符');
    if (
      check.measuredAt !== undefined &&
      (!Number.isFinite(timestamp(check.measuredAt)) ||
        timestamp(check.measuredAt) > now.getTime())
    )
      throw new ConflictException('量測時間不符或尚未發生');
    if (check.result === 'NOT_TESTED') {
      if (required && phase === 'COMPLETION')
        throw new ConflictException('必要測項尚未完成');
      else continue;
    }
    if (spec.requiresCalibration) {
      const matched = calibrations.filter(
        (proof) => object(proof) && proof.id === check.calibrationRecordId,
      );
      const proof: unknown = matched.length === 1 ? matched[0] : undefined;
      const at = timestamp(check.measuredAt);
      if (
        !text(check.calibrationRecordId, 128) ||
        !object(proof) ||
        !text(proof.id, 128) ||
        proof.id !== check.calibrationRecordId ||
        proof.status !== 'VALID' ||
        proof.entityId !== context.entityId ||
        !text(check.instrumentId, 128) ||
        proof.instrumentId !== check.instrumentId ||
        proof.equipmentType !== spec.equipmentType ||
        !Number.isFinite(at) ||
        at > now.getTime() ||
        !Number.isFinite(timestamp(proof.validFrom)) ||
        !Number.isFinite(timestamp(proof.validUntil)) ||
        at < timestamp(proof.validFrom) ||
        at > timestamp(proof.validUntil)
      )
        throw new ConflictException('量測設備校正證明缺失或已失效');
    }
    let passes = true;
    if (spec.standard.kind === 'NUMBER') {
      const measured = numeric(check.measurementValue);
      if (check.unit !== spec.standard.unit)
        throw new ConflictException('量測單位與機種基準不符');
      passes =
        (spec.standard.min === undefined ||
          measured >= numeric(spec.standard.min)) &&
        (spec.standard.max === undefined ||
          measured <= numeric(spec.standard.max));
    } else if (spec.standard.kind === 'BOOLEAN') {
      if (typeof check.measurementValue !== 'boolean')
        throw new BadRequestException('功能測項須填寫實際結果');
      passes = check.measurementValue === spec.standard.expected;
    }
    if (
      spec.standard.kind !== 'OBSERVATION' &&
      (check.result === 'PASS') !== passes
    )
      throw new ConflictException('測項判定與實際量測不符');
    if (phase === 'COMPLETION' && required && check.result !== 'PASS')
      throw new ConflictException('必要複驗尚未通過');
  }
  return template;
}

export function templateReadiness(
  template: unknown,
  checks: unknown,
  context: RepairTemplateContext,
  phase: 'INSPECTION' | 'COMPLETION',
  calibrations: unknown = [],
  policy: RepairTemplateValidationPolicy = {},
): 'READY' | 'BLOCKED' | 'UNKNOWN' {
  if (template === undefined || template === null) return 'UNKNOWN';
  try {
    validateTemplateChecks(
      template,
      checks,
      context,
      phase,
      calibrations,
      policy,
    );
    if (
      phase === 'INSPECTION' &&
      (template as RepairTestTemplate).checks.some(
        (spec) =>
          spec.requiredForInspection &&
          (checks as RepairMeasuredCheck[]).some(
            (check) => check.key === spec.key && check.result === 'NOT_TESTED',
          ),
      )
    )
      return 'UNKNOWN';
    return 'READY';
  } catch {
    return 'BLOCKED';
  }
}
