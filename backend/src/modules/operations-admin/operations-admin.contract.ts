import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
export const CATEGORIES = [
  'LINE',
  'COMMERCE',
  'ADS',
  'INVOICE',
  'AFTER_SALES',
] as const;
export const PROVIDERS: Record<string, string> = {
  LINE: 'LINE',
  SHOPIFY: 'COMMERCE',
  SHOPLINE: 'COMMERCE',
  ONESHOP: 'COMMERCE',
  META: 'ADS',
  GOOGLE_ADS: 'ADS',
  GA4: 'ADS',
  ECPAY: 'INVOICE',
  AFTER_SALES: 'AFTER_SALES',
};
export const METADATA_KEYS = new Set([
  'officialId',
  'messagingChannelId',
  'loginChannelId',
  'liffId',
  'webhookUrl',
  'storeDomain',
  'accountName',
  'propertyId',
  'legalName',
  'taxId',
  'merchantKey',
  'runtimeOwner',
  'contractVersion',
]);
const identifier = (value: unknown, max = 128) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_.:@/-]+$/.test(value) &&
  value.length <= max;
export function connectionInput(input: Record<string, unknown>) {
  const allowed = new Set([
    'id',
    'entityId',
    'category',
    'provider',
    'brand',
    'accountId',
    'displayName',
    'environment',
    'credentialRef',
    'metadata',
    'version',
    'enabled',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new BadRequestException('不支援的串接欄位');
  const {
    provider,
    category,
    environment,
    brand = '',
    credentialRef,
    metadata = {},
  } = input;
  if (
    typeof provider !== 'string' ||
    PROVIDERS[provider] !== category ||
    !['DEV', 'STAGE', 'PRODUCTION'].includes(String(environment))
  )
    throw new BadRequestException('串接類別或環境不符');
  if (
    !identifier(input.accountId) ||
    typeof input.displayName !== 'string' ||
    !input.displayName.trim() ||
    input.displayName.length > 100 ||
    !['', 'MOZTECH', 'BONSON'].includes(String(brand))
  )
    throw new BadRequestException('串接帳號或品牌不符');
  if (provider === 'LINE' && !brand)
    throw new BadRequestException('LINE 串接必須選擇品牌');
  if (
    credentialRef &&
    (typeof credentialRef !== 'string' ||
      !/^projects\/[a-z][a-z0-9-]{4,63}\/secrets\/[A-Za-z0-9_-]{1,255}\/versions\/(latest|[1-9]\d*)$/.test(
        credentialRef,
      ))
  )
    throw new BadRequestException('請使用 Secret Manager 憑證參照');
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    Object.keys(metadata).some((key) => !METADATA_KEYS.has(key))
  )
    throw new BadRequestException('串接資料包含不支援的欄位');
  for (const value of Object.values(metadata))
    if (typeof value !== 'string' || value.length > 300 || /[\r\n]/.test(value))
      throw new BadRequestException('串接資料格式不符');
  return {
    provider,
    category: String(category),
    brand: String(brand),
    accountId: String(input.accountId),
    displayName: input.displayName.trim(),
    environment: String(environment),
    credentialRef: credentialRef ? String(credentialRef) : null,
    metadata,
    enabled: input.enabled !== false,
  };
}
export function interactionInput(
  value: Record<string, unknown>,
  now = Date.now(),
) {
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'id',
          'actionId',
          'workbench',
          'brand',
          'recordId',
          'requestId',
          'outcome',
          'occurredAt',
        ].includes(key),
    )
  )
    throw new BadRequestException('操作紀錄包含不支援的欄位');
  if (
    !/^[a-f0-9-]{36}$/i.test(String(value.id)) ||
    !/^[a-z][a-z0-9_.-]{2,79}$/.test(String(value.actionId)) ||
    ![
      'AFTER_SALES',
      'MAILROOM',
      'REPAIR',
      'ADMIN',
      'INVENTORY',
      'FINANCE',
      'OTHER',
    ].includes(String(value.workbench)) ||
    !['INTENT', 'CANCELLED', 'VALIDATION_BLOCKED'].includes(
      String(value.outcome),
    )
  )
    throw new BadRequestException('操作紀錄格式不符');
  if (value.brand && !['MOZTECH', 'BONSON'].includes(String(value.brand)))
    throw new BadRequestException('操作品牌不符');
  for (const key of ['recordId', 'requestId'])
    if (value[key] && !identifier(value[key]))
      throw new BadRequestException('操作關聯格式不符');
  const occurred = new Date(String(value.occurredAt));
  if (
    !Number.isFinite(occurred.getTime()) ||
    Math.abs(occurred.getTime() - now) > 86400000
  )
    throw new BadRequestException('操作時間超過可記錄範圍');
  const normalized = {
    id: String(value.id),
    actionId: String(value.actionId),
    workbench: String(value.workbench),
    brand: value.brand ? String(value.brand) : null,
    recordId: value.recordId ? String(value.recordId) : null,
    requestId: value.requestId ? String(value.requestId) : null,
    outcome: String(value.outcome),
    occurredAt: occurred,
  };
  return {
    ...normalized,
    requestHash: createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex'),
  };
}
export function logRange(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 7 * 86400000);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end ||
    end.getTime() - start.getTime() > 31 * 86400000
  )
    throw new BadRequestException('查詢範圍最長 31 天');
  return { start, end };
}
export function fieldNames(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
        .filter(
          (key) =>
            /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) &&
            !/password|secret|token|cookie|authorization/i.test(key),
        )
        .slice(0, 40)
    : [];
}
