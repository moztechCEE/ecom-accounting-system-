import {
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { signRequest, verifySignature } from './mailroom.contract';
export const MAILROOM_SERVICE_AUTH = 'mailroomServiceAuth';
export const MailroomServiceAuth = () =>
  SetMetadata(MAILROOM_SERVICE_AUTH, true);
export type MailroomReaderRequest = {
  headers: Record<string, string | string[] | undefined>;
  originalUrl: string;
  method: string;
  mailroomEntityId?: string;
};
const readerEntry = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export function authenticateMailroomReader(
  req: MailroomReaderRequest,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.MAILROOM_ENABLED !== 'true')
    throw new ServiceUnavailableException('MAILROOM_DISABLED');
  try {
    const parsed: unknown = JSON.parse(env.MAILROOM_READERS || '[]');
    const entries: Record<string, unknown>[] = Array.isArray(parsed)
      ? parsed.filter(readerEntry)
      : [];
    const keyId = req.headers['x-mailroom-key'];
    const entityId = req.headers['x-mailroom-entity'];
    const entry = entries.find(
      (x) => x.keyId === keyId && x.entityId === entityId,
    );
    const timestamp = req.headers['x-mailroom-time'];
    const signature = req.headers['x-mailroom-signature'];
    const path = req.originalUrl;
    const assessmentPath =
      /^\/api\/v1\/mailroom\/integration\/cases\/[^/?]+\/repair-assessments$/.test(
        path,
      );
    if (
      assessmentPath &&
      (entries.filter((x) => x.keyId === keyId && x.entityId === entityId)
        .length !== 1 ||
        (req.headers['content-length'] !== undefined &&
          req.headers['content-length'] !== '0') ||
        req.headers['transfer-encoding'] !== undefined)
    )
      throw Error();
    if (
      !entry ||
      typeof entityId !== 'string' ||
      typeof entry.secret !== 'string' ||
      entry.secret.length < 32 ||
      req.method !== 'GET' ||
      (!/^\/api\/v1\/mailroom\/integration\/cases\/[^/?]+$/.test(path) &&
        !assessmentPath) ||
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
