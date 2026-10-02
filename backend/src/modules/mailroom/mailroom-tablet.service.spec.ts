import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { MailroomTabletAcceptDto } from './mailroom-tablet.dto';
import { MailroomTabletService } from './mailroom-tablet.service';

const actor = (id: string, permissions: string[], entityIds = ['company']) => ({
  id,
  name: id,
  entityIds,
  permissions: new Set(permissions),
});

describe('MailroomTabletService', () => {
  let prisma: any;
  let mailroom: any;
  let auth: any;
  let service: MailroomTabletService;
  let body: MailroomTabletAcceptDto;
  beforeEach(() => {
    prisma = {
      mailroomItem: {
        findUnique: jest.fn().mockResolvedValue({
          entityId: 'company',
          version: 4,
          status: 'WAITING_REPAIR_ACCEPTANCE',
          custodianId: 'clerk',
          nextUserId: 'repair',
          receipt: { category: 'REPAIR' },
        }),
      },
      mailroomAction: { findFirst: jest.fn().mockResolvedValue(null) },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 'employee' }) },
    };
    mailroom = {
      enabled: jest.fn(),
      actor: jest.fn(async (id: string) =>
        actor(
          id,
          id === 'clerk' ? ['mailroom:update'] : ['repair_workbench:update'],
        ),
      ),
      command: jest.fn().mockResolvedValue({ id: 'item', duplicate: false }),
    };
    auth = {
      login: jest.fn().mockResolvedValue({
        user: { id: 'repair', name: '維修人員' },
        access_token: 'recipient-jwt-must-never-leave-server',
      }),
    };
    service = new MailroomTabletService(prisma, mailroom, auth);
    body = {
      entityId: 'company',
      requestId: 'tablet-request-0001',
      expectedVersion: 4,
      employeeNo: ' 0002 ',
      password: 'fixture-password',
      confirmedItems: true,
      location: ' 維修部待檢區 ',
    };
  });

  it('authenticates only the assigned employee and returns no identity, JWT or credentials', async () => {
    body.twoFactorToken = '123456';
    expect(await service.accept('clerk', 'item', body)).toEqual({
      id: 'item',
      duplicate: false,
    });
    expect(auth.login).toHaveBeenCalledWith({
      entityId: 'company',
      employeeNo: '0002',
      password: 'fixture-password',
      twoFactorToken: '123456',
    });
    expect(mailroom.command).toHaveBeenCalledWith(
      'repair',
      'item',
      {
        entityId: 'company',
        requestId: 'tablet-request-0001',
        expectedVersion: 4,
        action: 'accept',
        confirmedItems: true,
        location: '維修部待檢區',
      },
      { tabletClerkId: 'clerk' },
    );
    expect(JSON.stringify(mailroom.command.mock.calls)).not.toContain(
      'fixture-password',
    );
    expect(JSON.stringify(mailroom.command.mock.calls)).not.toContain(
      'recipient-jwt',
    );
  });

  it('denies a caller without mailroom permission before trying recipient credentials', async () => {
    mailroom.actor.mockResolvedValue(
      actor('clerk', ['repair_workbench:update']),
    );
    await expect(service.accept('clerk', 'item', body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('denies a different custodian, cross-company item or stale version before authentication', async () => {
    const baseline = await prisma.mailroomItem.findUnique();
    for (const patch of [
      { custodianId: 'other' },
      { entityId: 'other-company' },
      { version: 5 },
      { status: 'INSPECTING' },
      { receipt: { category: 'LETTER' } },
    ]) {
      prisma.mailroomItem.findUnique.mockResolvedValue({
        ...baseline,
        ...patch,
      });
      await expect(service.accept('clerk', 'item', body)).rejects.toThrow();
    }
    expect(auth.login).not.toHaveBeenCalled();
    expect(mailroom.command).not.toHaveBeenCalled();
  });

  it('rejects valid credentials belonging to somebody other than the assigned recipient', async () => {
    auth.login.mockResolvedValue({
      user: { id: 'other-repair' },
      access_token: 'private',
    });
    await expect(service.accept('clerk', 'item', body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mailroom.command).not.toHaveBeenCalled();
  });

  it('preserves the existing second-factor requirement and never signs on a failed login', async () => {
    const twoFactorError = new UnauthorizedException({
      code: 'TWO_FACTOR_REQUIRED',
      message: '請輸入驗證器的六位數驗證碼',
    });
    auth.login.mockRejectedValue(twoFactorError);
    await expect(service.accept('clerk', 'item', body)).rejects.toBe(
      twoFactorError,
    );
    expect(mailroom.command).not.toHaveBeenCalled();
  });

  it('rechecks disabled accounts, company membership, employee binding and repair permission', async () => {
    mailroom.actor.mockImplementation(async (id: string) => {
      if (id !== 'clerk') throw new ForbiddenException('帳號已停用');
      return actor(id, ['mailroom:update']);
    });
    await expect(service.accept('clerk', 'item', body)).rejects.toThrow(
      '帳號已停用',
    );
    mailroom.actor.mockImplementation(async (id: string) =>
      actor(
        id,
        id === 'clerk' ? ['mailroom:update'] : ['repair_workbench:update'],
        id === 'clerk' ? ['company'] : ['other-company'],
      ),
    );
    await expect(service.accept('clerk', 'item', body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    mailroom.actor.mockImplementation(async (id: string) =>
      actor(id, id === 'clerk' ? ['mailroom:update'] : []),
    );
    await expect(service.accept('clerk', 'item', body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    mailroom.actor.mockImplementation(async (id: string) =>
      actor(
        id,
        id === 'clerk' ? ['mailroom:update'] : ['repair_workbench:update'],
      ),
    );
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.accept('clerk', 'item', body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mailroom.command).not.toHaveBeenCalled();
  });

  it('allows the original clerk to retry a committed signature using the original signer', async () => {
    prisma.mailroomItem.findUnique.mockResolvedValue({
      entityId: 'company',
      version: 5,
      status: 'REPAIR_RECEIVED',
      custodianId: 'repair',
      nextUserId: 'next-person',
      receipt: { category: 'REPAIR' },
    });
    prisma.mailroomAction.findFirst.mockResolvedValue({
      actorId: 'repair',
      version: 5,
      fromStatus: 'WAITING_REPAIR_ACCEPTANCE',
      snapshot: { tabletHandoff: { clerkId: 'clerk', signerId: 'repair' } },
    });
    mailroom.command.mockResolvedValue({ id: 'item', duplicate: true });
    expect(await service.accept('clerk', 'item', body)).toEqual({
      id: 'item',
      duplicate: true,
    });
    expect(mailroom.command.mock.calls[0][0]).toBe('repair');
  });

  it("does not treat an ordinary signature or somebody else's tablet signature as a retry", async () => {
    const baseline = await prisma.mailroomItem.findUnique();
    prisma.mailroomItem.findUnique.mockResolvedValue({
      ...baseline,
      version: 5,
      custodianId: 'repair',
    });
    for (const snapshot of [
      {},
      { tabletHandoff: { clerkId: 'other-clerk', signerId: 'repair' } },
      { tabletHandoff: { clerkId: 'clerk', signerId: 'someone-else' } },
    ]) {
      prisma.mailroomAction.findFirst.mockResolvedValue({
        actorId: 'repair',
        version: 5,
        fromStatus: 'WAITING_REPAIR_ACCEPTANCE',
        snapshot,
      });
      await expect(
        service.accept('clerk', 'item', body),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('lets the atomic command reject a race or changed retry payload', async () => {
    mailroom.command.mockRejectedValue(new ConflictException('物件已更新'));
    await expect(service.accept('clerk', 'item', body)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('allows refurbishment handoff through the same personal confirmation path', async () => {
    const baseline = await prisma.mailroomItem.findUnique();
    prisma.mailroomItem.findUnique.mockResolvedValue({
      ...baseline,
      status: 'PENDING_REFURBISH',
      receipt: { category: 'RETURN' },
    });
    await expect(service.accept('clerk', 'item', body)).resolves.toEqual({
      id: 'item',
      duplicate: false,
    });
  });

  it('limits repeated failed credentials and stops issuing login attempts at the limit', async () => {
    auth.login.mockRejectedValue(
      new UnauthorizedException('Invalid credentials'),
    );
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(
        service.accept('clerk', 'item', body),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.accept('clerk', 'item', body)).rejects.toMatchObject({
      status: 429,
    });
    expect(auth.login).toHaveBeenCalledTimes(5);
  });

  it('bounds repeated failed recipients per clerk and permits successful sequential handoffs', async () => {
    auth.login.mockRejectedValue(
      new UnauthorizedException('Invalid credentials'),
    );
    for (let attempt = 0; attempt < 10; attempt++)
      await expect(
        service.accept('clerk', 'item', {
          ...body,
          employeeNo: String(attempt),
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.accept('clerk', 'item', { ...body, employeeNo: 'next' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(auth.login).toHaveBeenCalledTimes(10);
    service = new MailroomTabletService(prisma, mailroom, auth);
    auth.login.mockResolvedValue({
      user: { id: 'repair' },
      access_token: 'private',
    });
    for (let attempt = 0; attempt < 12; attempt++)
      await expect(service.accept('clerk', 'item', body)).resolves.toEqual({
        id: 'item',
        duplicate: false,
      });
  });

  it('requires explicit physical confirmation and a location, and rejects malformed DTO fields', async () => {
    await expect(
      service.accept('clerk', 'item', {
        ...body,
        confirmedItems: false,
      } as any),
    ).rejects.toThrow();
    await expect(
      service.accept('clerk', 'item', { ...body, location: ' ' }),
    ).rejects.toThrow();
    expect(auth.login).not.toHaveBeenCalled();
    const invalid = Object.assign(new MailroomTabletAcceptDto(), body, {
      twoFactorToken: 'x',
      confirmedItems: false,
      expectedVersion: 0,
      password: 'short',
    });
    const properties = (await validate(invalid)).map((x) => x.property);
    expect(properties).toEqual(
      expect.arrayContaining([
        'twoFactorToken',
        'confirmedItems',
        'expectedVersion',
        'password',
      ]),
    );
  });
});
