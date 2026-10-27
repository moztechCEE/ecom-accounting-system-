import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { canonical } from '../mailroom.contract';
import { labelOrigin } from '../mailroom-label.contract';

export const PRINT_PROFILE = 'xp235b-50x30-v1';
export const PAIR_TTL_MS = 5 * 60_000;
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
export const JOB_TTL_MS = 2 * 60_000;
export const HEARTBEAT_MS = 30_000;
export const MAX_PDF_BYTES = 2 * 1024 * 1024;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
export const TERMINAL_STATES = ['SUBMITTED', 'FAILED', 'UNKNOWN'] as const;
export const RECEIPT_STATES = ['SUBMITTING', ...TERMINAL_STATES] as const;
export const ERROR_CODES = [
  'PRINTER_UNAVAILABLE',
  'PDF_INVALID',
  'LOCAL_STORAGE_FAILURE',
  'SUBMISSION_UNCERTAIN',
  'SUBMISSION_FAILED',
  'EXPIRED',
  'DEVICE_REVOKED',
  'AUTHORIZATION_REVOKED',
] as const;
export type ReceiptState = (typeof RECEIPT_STATES)[number];
export type PrintIdentity = {
  deviceId: string;
  entityId: string;
  registeredById: string;
  tokenHash: string;
};
export type RedeemIdentity = { deviceId: string; pairHash: string };

export function printEnabled() {
  if (
    process.env.ERP_DEV_SANDBOX !== 'true' ||
    process.env.MAILROOM_PRINT_ENABLED !== 'true'
  )
    throw new ServiceUnavailableException('DEV 直接列印尚未啟用');
}
export function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
export function capabilityHash(kind: 'pair' | 'token', value: string): string {
  return hash(kind + '\0' + value);
}
export function equalHash(a: string | null | undefined, b: string): boolean {
  return (
    typeof a === 'string' &&
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  );
}
export function requireUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new BadRequestException('列印代碼格式不符');
}
export function requestFingerprint(body: {
  entityId: string;
  deviceId: string;
  itemIds: string[];
  reprintOf?: string;
}) {
  return hash(
    canonical({
      entityId: body.entityId,
      deviceId: body.deviceId,
      itemIds: body.itemIds,
      reprintOf: body.reprintOf || null,
      profile: PRINT_PROFILE,
    }),
  );
}
export function itemSetFingerprint(itemIds: string[]) {
  return hash(canonical([...itemIds].sort()));
}
export function requireBrowserOrigin(origin: unknown) {
  if (typeof origin !== 'string' || origin !== labelOrigin())
    throw new ForbiddenException('不允許的列印來源');
}
