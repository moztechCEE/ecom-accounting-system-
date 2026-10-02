import {
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { signRequest, verifySignature } from './mailroom.contract';
export const MAILROOM_SERVICE_AUTH = 'mailroomServiceAuth';
export const MailroomServiceAuth = () =>
  SetMetadata(MAILROOM_SERVICE_AUTH, true);
export function authenticateMailroomReader(
  req: any,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.MAILROOM_ENABLED !== 'true')
    throw new ServiceUnavailableException('MAILROOM_DISABLED');
  try {
    const entries = JSON.parse(env.MAILROOM_READERS || '[]');
    const keyId = req.headers['x-mailroom-key'];
    const entityId = req.headers['x-mailroom-entity'];
    const entry =
      Array.isArray(entries) &&
      entries.find((x) => x.keyId === keyId && x.entityId === entityId);
    const timestamp = req.headers['x-mailroom-time'];
    const signature = req.headers['x-mailroom-signature'];
    const path = req.originalUrl;
    if (
      !entry ||
      typeof entry.secret !== 'string' ||
      entry.secret.length < 32 ||
      req.method !== 'GET' ||
      !/^\/api\/v1\/mailroom\/integration\/cases\/[^/?]+$/.test(path) ||
      typeof timestamp !== 'string' ||
      !/^\d{10}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 ||
      typeof signature !== 'string' ||
      !verifySignature(
        entry.secret,
        signRequest(entry.secret, 'GET', path, timestamp, '', entityId),
        signature,
      )
    )
      throw Error();
    req.mailroomEntityId = entityId;
    return true;
  } catch {
    throw new UnauthorizedException('MAILROOM_SIGNATURE_INVALID');
  }
}
