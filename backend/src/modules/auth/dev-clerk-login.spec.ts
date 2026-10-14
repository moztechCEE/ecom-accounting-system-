import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthMailService } from './auth-mail.service';

const ENTITY_ID = 'doa-dev-qa-20261002';
const USER_ID = 'doa-dev-clerk-20261002';
const fixture = () => ({
  entityId: ENTITY_ID,
  employeeNo: 'dev123',
  password: 'dev',
});

describe('isolated DEV clerk login compatibility', () => {
  const sandboxBefore = process.env.ERP_DEV_SANDBOX;
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const input = async (body: Record<string, unknown>): Promise<LoginDto> => {
    const result: unknown = await pipe.transform(body, {
      type: 'body',
      metatype: LoginDto,
    });
    return result as LoginDto;
  };

  beforeEach(() => {
    process.env.ERP_DEV_SANDBOX = 'true';
  });
  afterEach(() => {
    if (sandboxBefore === undefined) delete process.env.ERP_DEV_SANDBOX;
    else process.env.ERP_DEV_SANDBOX = sandboxBefore;
  });

  it.each(['dev123', 'DEV123', ' Dev123 '])(
    'accepts only the requested short fixture password for %s',
    async (employeeNo) => {
      await expect(input({ ...fixture(), employeeNo })).resolves.toBeInstanceOf(
        LoginDto,
      );
    },
  );

  it.each([undefined, 'false', 'TRUE', '1'])(
    'keeps the normal minimum outside the exact sandbox flag (%s)',
    async (flag) => {
      if (flag === undefined) delete process.env.ERP_DEV_SANDBOX;
      else process.env.ERP_DEV_SANDBOX = flag;
      await expect(input(fixture())).rejects.toThrow();
      await expect(
        input({ ...fixture(), password: 'normal-password' }),
      ).resolves.toBeInstanceOf(LoginDto);
    },
  );

  it.each([
    { entityId: 'tw-entity-001' },
    { entityId: 'doa-dev-qa-20261002-other' },
    { entityId: undefined },
    { employeeNo: 'QA7002' },
    { employeeNo: 'DEV1234' },
    { employeeNo: undefined },
    { email: 'clerk@example.test' },
    { email: '' },
    { platformLoginId: 'dev123' },
    { platformLoginId: '' },
    { userId: USER_ID },
  ])('does not extend the fixture exception to %j', async (override) => {
    await expect(input({ ...fixture(), ...override })).rejects.toThrow();
  });

  it.each([
    '',
    'DEV',
    'dev ',
    ' dev',
    '1234567',
    '😀😀😀😀',
    undefined,
    null,
    123,
    12345678,
    true,
    ['dev'],
    { value: 'dev' },
  ])('rejects other short or malformed passwords (%j)', async (password) => {
    await expect(input({ ...fixture(), password })).rejects.toThrow();
  });

  it.each([
    { entityId: [ENTITY_ID] },
    { entityId: { value: ENTITY_ID } },
    { employeeNo: ['dev123'] },
    { employeeNo: { value: 'dev123' } },
    { employeeNo: 123 },
  ])(
    'does not treat malformed identity fields as the fixture (%j)',
    async (override) => {
      await expect(input({ ...fixture(), ...override })).rejects.toThrow();
    },
  );

  it('leaves account creation, password changes and resets at eight characters', async () => {
    const dtos = [
      plainToInstance(RegisterDto, {
        email: 'clerk@example.test',
        name: 'Synthetic clerk',
        password: 'dev',
      }),
      plainToInstance(UpdateUserDto, { password: 'dev' }),
      plainToInstance(ChangePasswordDto, {
        currentPassword: 'normal-password',
        newPassword: 'dev',
      }),
      plainToInstance(ConfirmPasswordResetDto, {
        token: 'synthetic-token',
        newPassword: 'dev',
      }),
    ];
    for (const dto of dtos) {
      const errors = await validate(dto);
      expect(
        errors.some((error) => error.constraints?.minLength !== undefined),
      ).toBe(true);
    }
  });

  describe('existing employee and stored-password authentication', () => {
    type FixtureUser = {
      id: string;
      email: string;
      name: string;
      passwordHash?: string;
      isActive: boolean;
      isTwoFactorEnabled: boolean;
      twoFactorSecret?: string;
    };
    let service: AuthService;
    let user: FixtureUser;
    const createDb = () => ({
      employee: {
        findFirst: jest.fn(
          (where: unknown): Promise<{ user: FixtureUser | null } | null> => {
            void where;
            return Promise.resolve({ user });
          },
        ),
      },
    });
    const createUsers = () => ({ findForAuthByEmail: jest.fn() });
    const createJwt = () => ({
      signAsync: jest.fn((payload: { sub: string; email: string }) => {
        void payload;
        return Promise.resolve('synthetic-jwt');
      }),
    });
    let db: ReturnType<typeof createDb>;
    let users: ReturnType<typeof createUsers>;
    let jwt: ReturnType<typeof createJwt>;
    let fixtureHash: string;
    let differentHash: string;
    beforeAll(async () => {
      fixtureHash = await bcrypt.hash('dev', 4);
      differentHash = await bcrypt.hash('different-password', 4);
    });
    beforeEach(() => {
      user = {
        id: USER_ID,
        email: 'synthetic-clerk@example.test',
        name: 'Synthetic clerk',
        passwordHash: fixtureHash,
        isActive: true,
        isTwoFactorEnabled: false,
      };
      db = createDb();
      users = createUsers();
      jwt = createJwt();
      service = new AuthService(
        users as unknown as UsersService,
        jwt as unknown as JwtService,
        {} as ConfigService,
        {} as AuthMailService,
        db as unknown as PrismaService,
      );
    });

    it('uses the existing active employee, canonical code and bcrypt hash', async () => {
      const result = await service.login(await input(fixture()));
      expect(db.employee.findFirst).toHaveBeenCalledWith({
        where: { entityId: ENTITY_ID, employeeNo: 'DEV123', isActive: true },
        include: { user: true },
      });
      expect(users.findForAuthByEmail).not.toHaveBeenCalled();
      expect(result.user.id).toBe(USER_ID);
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: USER_ID,
        email: user.email,
      });
    });

    it('cannot authenticate a different user linked to that employee code', async () => {
      user.id = 'some-other-user';
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        'Invalid credentials',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('does not bypass a different stored password', async () => {
      user.passwordHash = differentHash;
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        'Invalid credentials',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it.each([null, { user: null }])(
      'does not authenticate without an active linked employee (%j)',
      async (employee) => {
        db.employee.findFirst.mockResolvedValue(employee);
        await expect(service.login(await input(fixture()))).rejects.toThrow(
          'Invalid credentials',
        );
        expect(jwt.signAsync).not.toHaveBeenCalled();
      },
    );

    it.each([undefined, ''])(
      'does not bypass a missing password hash (%j)',
      async (hash) => {
        user.passwordHash = hash;
        await expect(service.login(await input(fixture()))).rejects.toThrow(
          'Invalid credentials',
        );
        expect(jwt.signAsync).not.toHaveBeenCalled();
      },
    );

    it('still rejects a disabled existing user', async () => {
      user.isActive = false;
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        'disabled',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('still requires enrolled two factor verification', async () => {
      user.isTwoFactorEnabled = true;
      user.twoFactorSecret = 'SYNTHETICSECRET';
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        '六位數',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('also rejects the short password on direct service calls outside the fixture', async () => {
      await expect(
        service.login({ ...fixture(), entityId: 'other-company' }),
      ).rejects.toThrow('Invalid credentials');
      process.env.ERP_DEV_SANDBOX = 'false';
      await expect(service.login(fixture())).rejects.toThrow(
        'Invalid credentials',
      );
      expect(db.employee.findFirst).not.toHaveBeenCalled();
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('preserves case-sensitive employee codes for every other account', async () => {
      user.passwordHash = differentHash;
      await service.login({
        entityId: 'other-company',
        employeeNo: ' lowerCaseCode ',
        password: 'different-password',
      });
      expect(db.employee.findFirst).toHaveBeenCalledWith({
        where: {
          entityId: 'other-company',
          employeeNo: 'lowerCaseCode',
          isActive: true,
        },
        include: { user: true },
      });
    });
  });
});
