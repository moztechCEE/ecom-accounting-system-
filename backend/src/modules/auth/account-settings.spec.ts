import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as OTPAuth from 'otpauth';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateProfileDto } from './dto/account-settings.dto';

describe('personal profile and two factor enrollment', () => {
  const jwt = new JwtService({ secret: 'isolated-test-signing-key' });
  let service: AuthService, user: any, db: any, users: any;
  beforeEach(async () => {
    user = { id: 'self', name: 'Self', email: 'self@example.test', isActive: true, isTwoFactorEnabled: false, passwordHash: await bcrypt.hash('Test-password-123', 4) };
    users = { findForAuthById: jest.fn(async () => user), findForAuthByEmail: jest.fn(async () => user) };
    db = { user: { update: jest.fn(async ({ data }) => ({ id: 'self', ...data })), updateMany: jest.fn(async ({ data }) => { Object.assign(user, data); return { count: 1 }; }) } };
    service = new AuthService(users, jwt, { get: () => 'isolated-test-signing-key' } as any, {} as any, db);
  });
  const otp = (secret: string) => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
  it('saves only a name for the authenticated user, without an employee record or 2FA', async () => {
    await service.updateProfile('self', 'Updated');
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'self' }, data: { name: 'Updated' }, select: { id: true, name: true, email: true } });
    const input = plainToInstance(UpdateProfileDto, { name: '  ' });
    expect((await validate(input)).length).toBeGreaterThan(0);
  });
  it('validates password, short lived enrollment and OTP before enabling; login then requires OTP', async () => {
    const setup = await service.generateTwoFactorSecret('self');
    expect(user.isTwoFactorEnabled).toBe(false);
    const token = otp(setup.secret);
    await expect(service.enableTwoFactor('self', token, setup.setupToken, 'wrong-password')).rejects.toThrow();
    await expect(service.enableTwoFactor('self', token, 'invalid', 'Test-password-123')).rejects.toThrow();
    await service.enableTwoFactor('self', token, setup.setupToken, 'Test-password-123');
    await expect(service.enableTwoFactor('self', token, setup.setupToken, 'Test-password-123')).rejects.toThrow('已啟用');
    await expect(service.login({ email: user.email, password: 'Test-password-123' })).rejects.toThrow('六位數');
    const result = await service.login({ email: user.email, password: 'Test-password-123', twoFactorToken: token });
    expect(result.access_token).toBeTruthy();
  });
  it('cannot replay enrollment for another account, after password changes or expiry', async () => {
    const setup = await service.generateTwoFactorSecret('self');
    const token = otp(setup.secret);
    await expect(service.enableTwoFactor('other', token, setup.setupToken, 'Test-password-123')).rejects.toThrow('失效');
    user.passwordHash = await bcrypt.hash('new-password', 4);
    await expect(service.enableTwoFactor('self', token, setup.setupToken, 'new-password')).rejects.toThrow('失效');
    const expired = await jwt.signAsync({ sub: 'self' }, { audience: 'corely-2fa-setup', expiresIn: -1 });
    await expect(service.enableTwoFactor('self', token, expired, 'new-password')).rejects.toThrow('逾時');
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it('setup tokens never authenticate protected API requests', async () => {
    const strategy = new JwtStrategy({ get: () => 'isolated-test-signing-key' } as any, service);
    const setup = await service.generateTwoFactorSecret('self');
    await expect(strategy.validate(await jwt.verifyAsync(setup.setupToken))).rejects.toThrow();
  });
});
