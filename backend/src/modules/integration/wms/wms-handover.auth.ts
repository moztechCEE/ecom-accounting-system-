import {
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const WMS_HANDOVER_AUTH = 'wmsHandoverServiceAuth';
export const WmsHandoverAuth = () => SetMetadata(WMS_HANDOVER_AUTH, true);
export const HANDOVER_PATH = '/api/v1/integration/wms/events';
export function requireHandoverEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.WMS_HANDOVER_ENABLED !== 'true')
    throw new ServiceUnavailableException('WMS_HANDOVER_DISABLED');
}
export async function authenticateWmsHandover(
  req: any,
  env: NodeJS.ProcessEnv = process.env,
) {
  requireHandoverEnabled(env);
  let publicKey: string;
  try {
    publicKey =
      env.WMS_HANDOVER_PUBLIC_KEY ||
      readFileSync(env.WMS_HANDOVER_PUBLIC_KEY_FILE || '', 'utf8');
    const key = createPublicKey(publicKey);
    if (
      key.asymmetricKeyType !== 'rsa' ||
      (key.asymmetricKeyDetails?.modulusLength || 0) < 2048 ||
      !env.WMS_HANDOVER_JWT_ISSUER ||
      !env.WMS_HANDOVER_JWT_AUDIENCE
    )
      throw Error();
  } catch {
    throw new ServiceUnavailableException('WMS_HANDOVER_AUTH_NOT_CONFIGURED');
  }
  try {
    const authorization = req.headers?.authorization;
    if (
      typeof authorization !== 'string' ||
      !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization) ||
      !Buffer.isBuffer(req.rawBody) ||
      req.rawBody.length > 1048576
    )
      throw Error();
    const token = await new JwtService().verifyAsync(authorization.slice(7), {
      publicKey,
      algorithms: ['RS256'],
      issuer: env.WMS_HANDOVER_JWT_ISSUER,
      audience: env.WMS_HANDOVER_JWT_AUDIENCE,
    });
    const now = Math.floor(Date.now() / 1000);
    const bodyHash = createHash('sha256').update(req.rawBody).digest('hex');
    if (
      req.method !== 'POST' ||
      req.path !== HANDOVER_PATH ||
      token.method !== 'POST' ||
      token.path !== HANDOVER_PATH ||
      token.scope !== 'wms.shipment.handover' ||
      token.bodyHash !== bodyHash ||
      token.entityId !== req.body?.entityId ||
      typeof token.entityId !== 'string' ||
      !Number.isSafeInteger(token.iat) ||
      !Number.isSafeInteger(token.exp) ||
      token.exp <= now ||
      token.iat > now + 5 ||
      token.exp - token.iat > 120 ||
      token.exp <= token.iat
    )
      throw Error();
    req.wmsHandover = { entityId: token.entityId, bodyHash };
    return true;
  } catch {
    throw new UnauthorizedException('WMS_HANDOVER_SIGNATURE_INVALID');
  }
}
