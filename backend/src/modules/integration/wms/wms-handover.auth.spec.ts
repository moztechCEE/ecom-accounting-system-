import { generateKeyPairSync, createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { authenticateWmsHandover, HANDOVER_PATH } from './wms-handover.auth';
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const env = {
  WMS_HANDOVER_ENABLED: 'true',
  WMS_HANDOVER_PUBLIC_KEY: keys.publicKey,
  WMS_HANDOVER_JWT_ISSUER: 'qa-wms',
  WMS_HANDOVER_JWT_AUDIENCE: 'qa-erp',
};
async function request(overrides = {}, options = {}) {
  const body = { entityId: 'e', eventId: 'qa' },
    rawBody = Buffer.from(JSON.stringify(body));
  const token = await new JwtService().signAsync(
    {
      entityId: 'e',
      scope: 'wms.shipment.handover',
      method: 'POST',
      path: HANDOVER_PATH,
      bodyHash: createHash('sha256').update(rawBody).digest('hex'),
      ...overrides,
    },
    {
      privateKey: keys.privateKey,
      algorithm: 'RS256',
      issuer: env.WMS_HANDOVER_JWT_ISSUER,
      audience: env.WMS_HANDOVER_JWT_AUDIENCE,
      expiresIn: 45,
      ...options,
    },
  );
  return {
    body,
    rawBody,
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
    path: HANDOVER_PATH,
  };
}
describe('WMS handover service authentication', () => {
  it('accepts a short-lived RS256 request bound to exact raw bytes and company', async () => {
    const req: any = await request();
    expect(await authenticateWmsHandover(req, env)).toBe(true);
    expect(req.wmsHandover.entityId).toBe('e');
    expect(req.user).toBeUndefined();
  });
  it.each([
    { scope: 'wms.workspace.command' },
    { method: 'GET' },
    { path: '/events' },
    { entityId: 'other' },
    { bodyHash: 'a'.repeat(64) },
  ])('rejects altered signed claims %o', async (claims) => {
    await expect(
      authenticateWmsHandover(await request(claims), env),
    ).rejects.toThrow('SIGNATURE_INVALID');
  });
  it.each([
    { expiresIn: -1 },
    { expiresIn: 3600 },
    { issuer: 'other' },
    { audience: 'other' },
  ])('rejects invalid lifetime or authority %o', async (options) => {
    await expect(
      authenticateWmsHandover(await request({}, options), env),
    ).rejects.toThrow('SIGNATURE_INVALID');
  });
  it('rejects changed wire bytes and missing rawBody', async () => {
    const req = await request();
    req.rawBody = Buffer.from(
      JSON.stringify({ ...req.body, eventId: 'changed' }),
    );
    await expect(authenticateWmsHandover(req, env)).rejects.toThrow(
      'SIGNATURE_INVALID',
    );
    delete (req as any).rawBody;
    await expect(authenticateWmsHandover(req, env)).rejects.toThrow(
      'SIGNATURE_INVALID',
    );
  });
  it('remains closed without the flag and without configured keys', async () => {
    await expect(authenticateWmsHandover(await request(), {})).rejects.toThrow(
      'DISABLED',
    );
    await expect(
      authenticateWmsHandover(await request(), {
        WMS_HANDOVER_ENABLED: 'true',
      }),
    ).rejects.toThrow('NOT_CONFIGURED');
  });
  it('does not accept HS256 tokens signed with public key text', async () => {
    const req = await request();
    req.headers.authorization =
      'Bearer ' +
      (await new JwtService().signAsync(
        { entityId: 'e' },
        { secret: keys.publicKey, algorithm: 'HS256' },
      ));
    await expect(authenticateWmsHandover(req, env)).rejects.toThrow(
      'SIGNATURE_INVALID',
    );
  });
});
