import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as OTPAuth from 'otpauth';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthMailService } from './auth-mail.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const ENTITY_ID = 'doa-dev-qa-20261002';
const USER_ID = 'doa-dev-tech-20261002';
const EMPLOYEE_ID = 'c7585674-980b-4fb2-afb9-7f2adcca413e';
const fixture = () => ({
  entityId: ENTITY_ID,
  employeeNo: 'DEV121',
  password: '123',
});

describe('isolated DEV technician login compatibility', () => {
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

  it.each(['DEV121', 'dev121', ' Dev121 '])(
    'accepts the exact technician alias %s with the requested password',
    async (employeeNo) => {
      await expect(input({ ...fixture(), employeeNo })).resolves.toBeInstanceOf(
        LoginDto,
      );
    },
  );

  it('retains the previous technician password predicate during deployment', async () => {
    await expect(
      input({ ...fixture(), password: 'dev' }),
    ).resolves.toBeInstanceOf(LoginDto);
  });

  it.each([undefined, 'false', 'TRUE', '1'])(
    'rejects the short password outside the exact sandbox flag (%s)',
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
    { entityId: ENTITY_ID + '-other' },
    { entityId: undefined },
    { employeeNo: 'QA7001' },
    { employeeNo: 'DEV1210' },
    { employeeNo: 'DEV122' },
    { employeeNo: 'DEV123' },
    { employeeNo: undefined },
    { email: 'technician@example.test' },
    { email: '' },
    { email: null },
    { platformLoginId: 'DEV121' },
    { platformLoginId: '' },
    { platformLoginId: null },
    { userId: USER_ID },
    { employeeId: EMPLOYEE_ID },
  ])('does not broaden the fixture exception to %j', async (override) => {
    await expect(input({ ...fixture(), ...override })).rejects.toThrow();
  });

  it.each([
    '',
    'DEV',
    'dev ',
    ' dev',
    '123 ',
    ' 123',
    '00123',
    '1234567',
    '😀😀😀😀',
    undefined,
    null,
    123,
    12345678,
    true,
    ['dev'],
    ['123'],
    { value: 'dev' },
    { value: '123' },
  ])('rejects other short or malformed passwords (%j)', async (password) => {
    await expect(input({ ...fixture(), password })).rejects.toThrow();
  });

  it.each([
    { entityId: [ENTITY_ID] },
    { entityId: { value: ENTITY_ID } },
    { employeeNo: ['DEV121'] },
    { employeeNo: { value: 'DEV121' } },
    { employeeNo: 121 },
  ])('rejects malformed identity fields (%j)', async (override) => {
    await expect(input({ ...fixture(), ...override })).rejects.toThrow();
  });

  describe('fresh employee linkage and stored-password authentication', () => {
    type FixtureUser = {
      id: string;
      email: string;
      name: string;
      passwordHash?: string | null;
      isActive: boolean;
      isTwoFactorEnabled: boolean;
      twoFactorSecret?: string;
    };
    type FixtureEmployee = {
      id: string;
      userId: string;
      entityId: string;
      employeeNo: string;
      isActive: boolean;
      user: FixtureUser | null;
    };
    let service: AuthService;
    let user: FixtureUser;
    let employee: FixtureEmployee | null;
    const createDb = () => ({
      employee: {
        findFirst: jest.fn((): Promise<FixtureEmployee | null> => {
          return Promise.resolve(employee);
        }),
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
    let previousHash: string;
    let differentHash: string;
    beforeAll(async () => {
      fixtureHash = await bcrypt.hash('123', 4);
      previousHash = await bcrypt.hash('dev', 4);
      differentHash = await bcrypt.hash('different-password', 4);
    });
    beforeEach(() => {
      user = {
        id: USER_ID,
        email: 'synthetic-technician@example.test',
        name: 'Synthetic technician',
        passwordHash: fixtureHash,
        isActive: true,
        isTwoFactorEnabled: false,
      };
      employee = {
        id: EMPLOYEE_ID,
        userId: USER_ID,
        entityId: ENTITY_ID,
        employeeNo: 'DEV121',
        isActive: true,
        user,
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

    it.each(['DEV121', 'dev121', ' Dev121 '])(
      'authenticates %s only through the exact current employee and user',
      async (employeeNo) => {
        const result = await service.login(
          await input({ ...fixture(), employeeNo }),
        );
        expect(db.employee.findFirst).toHaveBeenCalledWith({
          where: {
            id: EMPLOYEE_ID,
            userId: USER_ID,
            entityId: ENTITY_ID,
            employeeNo: 'DEV121',
            isActive: true,
          },
          include: { user: true },
        });
        expect(users.findForAuthByEmail).not.toHaveBeenCalled();
        expect(result.user.id).toBe(USER_ID);
        expect(jwt.signAsync).toHaveBeenCalledWith({
          sub: USER_ID,
          email: user.email,
        });
      },
    );

    it.each([
      { id: 'another-employee' },
      { userId: 'doa-dev-clerk-20261002' },
      { userId: 'another-user' },
      { entityId: 'another-company' },
      { employeeNo: 'QA7001' },
      { employeeNo: 'DEV123' },
      { isActive: false },
      { user: null },
    ])('rejects a changed employee mapping (%j)', async (override) => {
      Object.assign(employee!, override);
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        'Invalid credentials',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('rejects a missing original employee', async () => {
      employee = null;
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        'Invalid credentials',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it.each(['doa-dev-clerk-20261002', 'another-user'])(
      'rejects a different linked user even if its stored password matches (%s)',
      async (id) => {
        user.id = id;
        await expect(service.login(await input(fixture()))).rejects.toThrow(
          'Invalid credentials',
        );
        expect(jwt.signAsync).not.toHaveBeenCalled();
      },
    );

    it('does not cache employee linkage across logins', async () => {
      await service.login(await input(fixture()));
      employee!.userId = 'another-user';
      jwt.signAsync.mockClear();
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        'Invalid credentials',
      );
      expect(db.employee.findFirst).toHaveBeenCalledTimes(2);
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('still compares the stored bcrypt hash', async () => {
      user.passwordHash = differentHash;
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        'Invalid credentials',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('rejects the previous password after the stored password is changed', async () => {
      await expect(
        service.login(await input({ ...fixture(), password: 'dev' })),
      ).rejects.toThrow('Invalid credentials');
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('uses the existing stored password until the password transition', async () => {
      user.passwordHash = previousHash;
      await expect(
        service.login(await input({ ...fixture(), password: 'dev' })),
      ).resolves.toMatchObject({ user: { id: USER_ID } });
      jwt.signAsync.mockClear();
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        'Invalid credentials',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it.each([undefined, '', null])(
      'rejects a missing password hash (%j)',
      async (hash) => {
        user.passwordHash = hash;
        await expect(service.login(await input(fixture()))).rejects.toThrow(
          'Invalid credentials',
        );
        expect(jwt.signAsync).not.toHaveBeenCalled();
      },
    );

    it('rejects a disabled original user', async () => {
      user.isActive = false;
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        'disabled',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('retains enrolled two-factor verification', async () => {
      user.isTwoFactorEnabled = true;
      user.twoFactorSecret = 'SYNTHETICSECRET';
      const verify = jest
        .spyOn(service, 'verifyTwoFactorToken')
        .mockReturnValue(false);
      await expect(service.login(await input(fixture()))).rejects.toThrow(
        '六位數',
      );
      expect(verify).not.toHaveBeenCalled();
      await expect(
        service.login(await input({ ...fixture(), twoFactorToken: '123456' })),
      ).rejects.toThrow('不正確');
      expect(jwt.signAsync).not.toHaveBeenCalled();
      verify.mockRestore();
      const twoFactorToken = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
      }).generate();
      await expect(
        service.login(await input({ ...fixture(), twoFactorToken })),
      ).resolves.toMatchObject({ user: { id: USER_ID } });
    });

    it.each([
      { entityId: 'another-company' },
      { employeeNo: 'DEV122' },
      { employeeNo: 'QA7001' },
      { employeeNo: 'DEV123' },
      { email: 'synthetic-technician@example.test' },
      { platformLoginId: 'DEV121' },
    ])(
      'rejects direct service short-password bypass (%j)',
      async (override) => {
        await expect(
          service.login({ ...fixture(), ...override }),
        ).rejects.toThrow('Invalid credentials');
        expect(db.employee.findFirst).not.toHaveBeenCalled();
        expect(jwt.signAsync).not.toHaveBeenCalled();
      },
    );

    it('rejects direct service use outside DEV', async () => {
      process.env.ERP_DEV_SANDBOX = 'false';
      await expect(service.login(fixture())).rejects.toThrow(
        'Invalid credentials',
      );
      expect(db.employee.findFirst).not.toHaveBeenCalled();
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('preserves ordinary employee code case and the existing lookup', async () => {
      user.passwordHash = differentHash;
      await service.login({
        entityId: 'another-company',
        employeeNo: ' lowerCaseCode ',
        password: 'different-password',
      });
      expect(db.employee.findFirst).toHaveBeenCalledWith({
        where: {
          entityId: 'another-company',
          employeeNo: 'lowerCaseCode',
          isActive: true,
        },
        include: { user: true },
      });
    });
  });
});
