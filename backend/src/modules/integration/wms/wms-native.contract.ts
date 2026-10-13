import {
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';

export const WMS_NATIVE_BODY_LIMIT = 30 * 1024 * 1024;
export const WMS_NATIVE_RESPONSE_LIMIT = 50 * 1024 * 1024;
export const WMS_NATIVE_ENTRIES = [
  'tasks',
  'picking',
  'packing',
  'completed',
  'dispatch',
  'marketplace',
  'intakes',
  'overview',
  'logs',
  'exceptions',
  'scan-errors',
  'defects',
  'logistics',
  'team',
  'users',
  'settings',
] as const;
// These are authenticated business routers in WMS. Keep this namespace list in
// step with the DEV preload guard; authentication and internal services are not
// included. Existing WMS controllers remain the authority for each operation.
export const WMS_NATIVE_BUSINESS_PATH =
  /^\/api\/(?:cartons|orders|tasks|comments|order-import-batches|order-reviews|order-change-notices|marketplace-products|marketplace-intakes|marketplace-batch-notices|warehouse-intakes|logistics|admin|analytics|reports|scan-errors|operation-logs|team)(?:\/[A-Za-z0-9_.,:@-]+)*\/?$/;
const protectedSegment =
  /(?:^|\/)(?:auth|integrations?|callbacks?|hooks?|webhooks?|migrations?|seeds?|bootstrap|maintenance|retention|internal|health|ready|readiness|staff|bind|exchange)(?:\/|$)/i;
export function nativeBusinessTarget(raw: string) {
  if (raw.length > 8192 || /[\x00-\x20\x7f#\\]/.test(raw))
    throw new BadRequestException('WMS_NATIVE_PATH_INVALID');
  const separator = raw.indexOf('?');
  const pathname = separator < 0 ? raw : raw.slice(0, separator);
  if (
    !WMS_NATIVE_BUSINESS_PATH.test(pathname) &&
    pathname !== '/api/users/basic'
  )
    throw new ForbiddenException('WMS_NATIVE_ROUTE_DENIED');
  if (
    pathname.includes('//') ||
    pathname.split('/').some((part) => part === '.' || part === '..') ||
    protectedSegment.test(pathname)
  )
    throw new ForbiddenException('WMS_NATIVE_ROUTE_DENIED');
  // The dedicated file endpoint keeps the short-lived HttpOnly download cookie
  // inside the backend and never exposes it to browser JavaScript.
  if (/^\/api\/marketplace-intakes\/[^/]+\/download-link\/?$/.test(pathname))
    throw new ForbiddenException('WMS_NATIVE_USE_FILE_ENDPOINT');
  return raw;
}
export function nativeSessionToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 8192 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  )
    throw new ForbiddenException('WMS_NATIVE_SESSION_REQUIRED');
  return value;
}
export function nativeEntity(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new ForbiddenException('WMS_NATIVE_ENTITY_REQUIRED');
  return value;
}
export function nativeBody(value: Buffer | undefined) {
  if (value && value.length > WMS_NATIVE_BODY_LIMIT)
    throw new PayloadTooLargeException('WMS_NATIVE_BODY_TOO_LARGE');
  return value;
}
export function nativeDisposition(
  value: string | null,
  fallback = 'WMS-download',
) {
  let filename = fallback;
  const encoded = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(value || '');
  const quoted = /(?:^|;)\s*filename="([^"]*)"/i.exec(value || '');
  const plain = /(?:^|;)\s*filename=([^;\s]+)/i.exec(value || '');
  try {
    filename = encoded
      ? decodeURIComponent(encoded[1])
      : quoted?.[1] || plain?.[1] || fallback;
  } catch {
    filename = fallback;
  }
  filename =
    Array.from(filename.replace(/[\\/\x00-\x1f\x7f]/g, '_'))
      .slice(0, 240)
      .join('') || fallback;
  // Repair a malformed upstream surrogate without splitting valid code points.
  filename = filename.replace(/[\uD800-\uDFFF]/gu, '_');
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase())}`;
}
