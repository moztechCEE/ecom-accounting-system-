/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Tests intentionally mutate dynamic synthetic repository rows to exercise authorization, concurrency and crash boundaries. */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  COMPANY,
  CREATOR,
  DEVICE,
  DEVICE2,
  ITEM,
  ITEM2,
  OTHER_COMPANY,
  OWNER,
  printFixture,
  TOKEN,
} from '../../../../test/helpers/mailroom-print.fixture';
import { capabilityHash, hash } from './mailroom-print.contract';

describe('durable mailroom print capability and job semantics (synthetic repository)', () => {
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    env = { ...process.env };
    Object.assign(process.env, {
      MAILROOM_ENABLED: 'true',
      MAILROOM_PRINT_ENABLED: 'true',
      ERP_DEV_SANDBOX: 'true',
    });
  });
  afterEach(() => {
    process.env = env;
  });

  it('stores only hashes, atomically redeems a 256-bit pairing code once, and never returns secrets from listing', async () => {
    const f = printFixture();
    const pair = await f.service.pair(OWNER, {
      entityId: COMPANY,
      name: 'Desk Mac',
    });
    expect(pair.pairCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = f.devices.get(pair.deviceId)!;
    expect(row.pairHash).toBe(capabilityHash('pair', pair.pairCode));
    expect(JSON.stringify(row)).not.toContain(pair.pairCode);
    const capability = await f.service.authorizeRedeem(
      pair.deviceId,
      pair.pairCode,
    );
    const results = await Promise.allSettled([
      f.service.redeem(capability, {
        deviceId: pair.deviceId,
        code: pair.pairCode,
      }),
      f.service.redeem(capability, {
        deviceId: pair.deviceId,
        code: pair.pairCode,
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const redeemed = (
      results.find(
        (result) => result.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ deviceId: string; token: string }>
    ).value;
    expect(f.devices.get(pair.deviceId)!.tokenHash).toBe(
      capabilityHash('token', redeemed.token),
    );
    expect(f.devices.get(pair.deviceId)!.pairHash).toBeNull();
    expect(JSON.stringify(await f.service.devices(OWNER, COMPANY))).not.toMatch(
      /tokenHash|pairHash|pairCode/,
    );
  });
  it('rejects bad/expired capabilities before employee, item, job or PDF reads', async () => {
    const f = printFixture();
    f.seedDevice();
    await expect(
      f.service.authenticateDevice(
        DEVICE,
        Buffer.alloc(32, 8).toString('base64url'),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    f.devices.get(DEVICE)!.tokenExpiresAt = new Date(Date.now() - 1);
    await expect(
      f.service.authenticateDevice(DEVICE, TOKEN),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    f.devices.get(DEVICE)!.pairHash = capabilityHash('pair', TOKEN);
    f.devices.get(DEVICE)!.pairExpiresAt = new Date(Date.now() - 1);
    await expect(
      f.service.authorizeRedeem(DEVICE, TOKEN),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.db.user.findUnique).not.toHaveBeenCalled();
    expect(f.db.employee.findFirst).not.toHaveBeenCalled();
    expect(f.db.mailroomPrintJob.findFirst).not.toHaveBeenCalled();
    expect(f.labels.read).not.toHaveBeenCalled();
  });
  it.each(['permissions', 'employee', 'active', 'password'])(
    'rechecks current device owner %s on every authenticated poll',
    async (mode) => {
      const f = printFixture();
      f.seedDevice();
      const user = f.users.get(OWNER)!;
      if (mode === 'permissions') user.permissions = ['mailroom:read'];
      if (mode === 'employee') user.employeeActive = false;
      if (mode === 'active') user.active = false;
      if (mode === 'password') user.mustChangePassword = true;
      await expect(f.service.claim(f.identity())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(f.db.mailroomPrintJob.findFirst).not.toHaveBeenCalled();
      expect(f.oldBusiness).not.toHaveBeenCalled();
    },
  );
  it('requires a recent device heartbeat and rejects a cross-company target before rendering', async () => {
    const f = printFixture();
    f.seedDevice().lastSeenAt = new Date(Date.now() - 30_001);
    await expect(f.service.create(CREATOR, f.body())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    f.devices.get(DEVICE)!.entityId = OTHER_COMPANY;
    await expect(f.service.create(CREATOR, f.body())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(f.labels.read).not.toHaveBeenCalled();
    expect(f.jobs.size).toBe(0);
  });
  it.each([true, false])(
    'keeps Super Admin print participation subject to active company employee binding: %s',
    async (bound) => {
      const f = printFixture();
      f.seedDevice();
      for (const id of [OWNER, CREATOR])
        Object.assign(f.users.get(id)!, {
          role: 'SUPER_ADMIN',
          employeeBound: bound,
          permissions: [],
        });
      if (bound) {
        expect(
          (
            await f.service.pair(OWNER, {
              entityId: COMPANY,
              name: 'Admin desk',
            })
          ).deviceId,
        ).toMatch(/^[a-f0-9-]{36}$/);
        expect((await f.service.create(CREATOR, f.body())).status).toBe(
          'QUEUED',
        );
        expect(
          (await f.service.authenticateDevice(DEVICE, TOKEN)).deviceId,
        ).toBe(DEVICE);
      } else {
        await expect(
          f.service.pair(OWNER, { entityId: COMPANY, name: 'Admin desk' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          f.service.create(CREATOR, f.body()),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          f.service.authenticateDevice(DEVICE, TOKEN),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(f.labels.read).not.toHaveBeenCalled();
        expect(f.jobs.size).toBe(0);
      }
    },
  );
  it('returns one original job for concurrent request retries and rejects a changed request body', async () => {
    const f = printFixture();
    f.seedDevice();
    const body = f.body();
    const [one, two] = await Promise.all([
      f.service.create(CREATOR, body),
      f.service.create(CREATOR, body),
    ]);
    expect(one.id).toBe(two.id);
    expect(f.jobs.size).toBe(1);
    await expect(
      f.service.create(CREATOR, { ...body, itemIds: [ITEM2] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await f.service.byRequest(CREATOR, COMPANY, body.requestId)).id,
    ).toBe(one.id);
    const stored = f.jobs.get(one.id)!;
    expect(stored.pdfSha256).toBe(hash(Buffer.from(stored.pdfBytes)));
    expect(stored.itemVersions).toEqual([{ id: ITEM, version: 3 }]);
    expect(JSON.stringify(one)).not.toMatch(
      /SYNTHETIC-NAME|0900000000|pdfBytes|qrLink/,
    );
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });
  it('blocks simultaneous distinct requests for an identical item set on the same device', async () => {
    const f = printFixture();
    f.seedDevice();
    const results = await Promise.allSettled([
      f.service.create(CREATOR, f.body({ itemIds: [ITEM, ITEM2] })),
      f.service.create(CREATOR, f.body({ itemIds: [ITEM2, ITEM] })),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(f.jobs.size).toBe(1);
    expect(
      (
        results.find(
          (result) => result.status === 'rejected',
        ) as PromiseRejectedResult
      ).reason,
    ).toBeInstanceOf(ConflictException);
  });
  it('blocks concurrent overlapping batch and row requests across actors and devices', async () => {
    const f = printFixture();
    f.seedDevice();
    f.seedDevice(DEVICE2);
    const results = await Promise.allSettled([
      f.service.create(CREATOR, f.body({ itemIds: [ITEM, ITEM2] })),
      f.service.create(OWNER, f.body({ deviceId: DEVICE2, itemIds: [ITEM] })),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(f.jobs.size).toBe(1);
    expect(
      (
        results.find(
          (result) => result.status === 'rejected',
        ) as PromiseRejectedResult
      ).reason,
    ).toBeInstanceOf(ConflictException);
  });
  it('an explicit UNKNOWN reprint excludes only that original and still blocks other overlapping work', async () => {
    const f = printFixture();
    f.seedDevice();
    f.seedDevice(DEVICE2);
    const original = await f.service.create(CREATOR, f.body());
    await f.service.claim(f.identity());
    await f.service.receipt(f.identity(), original.id, {
      state: 'UNKNOWN',
      errorCode: 'SUBMISSION_UNCERTAIN',
    });
    // An additional durable active row models pre-existing work from another station.
    const old = f.jobs.get(original.id)!;
    const otherId = randomUUID();
    f.jobs.set(otherId, {
      ...old,
      id: otherId,
      deviceId: DEVICE2,
      status: 'CLAIMED',
      activeKey: hash('synthetic-other-active'),
      itemIds: [ITEM, ITEM2],
    });
    await expect(
      f.service.create(CREATOR, f.body({ reprintOf: original.id })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.jobs.get(original.id)!.activeKey).not.toBeNull();
    expect(f.jobs.size).toBe(2);
  });
  it.each(['revoked', 'role', 'version'])(
    'rechecks %s after server label/PDF awaits and commits no job',
    async (mode) => {
      const f = printFixture();
      f.seedDevice();
      f.exporter.pdfMany.mockImplementation(() => {
        if (mode === 'revoked') f.devices.get(DEVICE)!.revokedAt = new Date();
        if (mode === 'role')
          f.users.get(CREATOR)!.permissions = ['mailroom:read'];
        if (mode === 'version') f.items.get(ITEM)!.version++;
        return Promise.resolve(Buffer.from('%PDF-synthetic'));
      });
      await expect(f.service.create(CREATOR, f.body())).rejects.toThrow();
      expect(f.jobs.size).toBe(0);
    },
  );
  it('correlates claim retries, never returns SUBMITTING to a printer, and accepts exact receipt retries', async () => {
    const f = printFixture();
    f.seedDevice();
    const job = await f.service.create(CREATOR, f.body());
    const [one, two] = await Promise.all([
      f.service.claim(f.identity()),
      f.service.claim(f.identity()),
    ]);
    expect(one.job?.id).toBe(job.id);
    expect(two.job?.id).toBe(job.id);
    expect((await f.service.document(f.identity(), job.id)).toString()).toBe(
      '%PDF-SYNTHETIC-PDF',
    );
    expect(
      (await f.service.receipt(f.identity(), job.id, { state: 'SUBMITTING' }))
        .status,
    ).toBe('SUBMITTING');
    expect(
      (await f.service.receipt(f.identity(), job.id, { state: 'SUBMITTING' }))
        .status,
    ).toBe('SUBMITTING');
    expect(await f.service.claim(f.identity())).toEqual({ job: null });
    await expect(
      f.service.document(f.identity(), job.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    const receipt = {
      state: 'SUBMITTED' as const,
      cupsJobId: 'Xprinter_XP-235B-37',
    };
    expect(
      (await f.service.receipt(f.identity(), job.id, receipt)).cupsJobId,
    ).toBe(receipt.cupsJobId);
    expect(
      (await f.service.receipt(f.identity(), job.id, receipt)).status,
    ).toBe('SUBMITTED');
    expect(
      (
        await f.service.create(CREATOR, {
          entityId: COMPANY,
          deviceId: DEVICE,
          requestId: job.requestId,
          itemIds: [ITEM],
        })
      ).status,
    ).toBe('SUBMITTED');
    expect(f.jobs.get(job.id)!.pdfBytes).toBeNull();
    await expect(
      f.service.receipt(f.identity(), job.id, {
        state: 'UNKNOWN',
        errorCode: 'SUBMISSION_UNCERTAIN',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('retains UNKNOWN deduplication until one explicit correlated reprint releases it', async () => {
    const f = printFixture();
    f.seedDevice();
    const original = await f.service.create(CREATOR, f.body());
    await f.service.claim(f.identity());
    await f.service.receipt(f.identity(), original.id, {
      state: 'UNKNOWN',
      errorCode: 'SUBMISSION_UNCERTAIN',
    });
    expect(f.jobs.get(original.id)!.pdfBytes).toBeNull();
    await expect(f.service.create(CREATOR, f.body())).rejects.toBeInstanceOf(
      ConflictException,
    );
    const results = await Promise.allSettled([
      f.service.create(CREATOR, f.body({ reprintOf: original.id })),
      f.service.create(CREATOR, f.body({ reprintOf: original.id })),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(f.jobs.size).toBe(2);
    expect(f.jobs.get(original.id)!.status).toBe('UNKNOWN');
  });
  it('returns bounded read-only terminal proof for a same-device expiry/receipt race without changing either result', async () => {
    const f = printFixture();
    f.seedDevice();
    const job = await f.service.create(CREATOR, f.body());
    await f.service.claim(f.identity());
    f.jobs.get(job.id)!.expiresAt = new Date(Date.now() - 1);
    await f.service.clearExpiredDocuments();
    const terminal = structuredClone(f.jobs.get(job.id)!);
    for (const state of ['FAILED', 'UNKNOWN'] as const) {
      const error = await f.service
        .receipt(f.identity(), job.id, {
          state,
          errorCode:
            state === 'FAILED' ? 'PRINTER_UNAVAILABLE' : 'SUBMISSION_UNCERTAIN',
        })
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ConflictException);
      const proof = (error as ConflictException).getResponse() as {
        message: string;
        current: Record<string, unknown>;
      };
      expect(proof.message).toBe('PRINT_RECEIPT_TERMINAL_CONFLICT');
      expect(proof.current).toMatchObject({
        id: job.id,
        deviceId: DEVICE,
        requestId: job.requestId,
        status: 'FAILED',
        pages: 1,
        cupsJobId: null,
        errorCode: 'EXPIRED',
      });
      expect(Object.keys(proof.current).sort()).toEqual(
        [
          'id',
          'requestId',
          'deviceId',
          'status',
          'pages',
          'expiresAt',
          'cupsJobId',
          'errorCode',
          'reprintOf',
        ].sort(),
      );
      expect(JSON.stringify(proof)).not.toMatch(
        /SYNTHETIC-NAME|0900000000|pdfBytes|qrLink|itemIds/,
      );
    }
    expect(f.jobs.get(job.id)).toEqual(terminal);
    f.seedDevice(DEVICE2);
    const denied = await f.service
      .receipt({ ...f.identity(), deviceId: DEVICE2 }, job.id, {
        state: 'UNKNOWN',
        errorCode: 'SUBMISSION_UNCERTAIN',
      })
      .catch((failure: unknown) => failure);
    expect(denied).toBeInstanceOf(NotFoundException);
    expect((denied as NotFoundException).getResponse()).not.toHaveProperty(
      'current',
    );
  });
  it('checks the original creator again before claim and before SUBMITTING', async () => {
    const f = printFixture();
    f.seedDevice();
    const job = await f.service.create(CREATOR, f.body());
    f.users.get(CREATOR)!.employeeActive = false;
    expect(await f.service.claim(f.identity())).toEqual({ job: null });
    expect(f.jobs.get(job.id)!.errorCode).toBe('AUTHORIZATION_REVOKED');
    f.users.get(CREATOR)!.employeeActive = true;
    const next = await f.service.create(CREATOR, f.body());
    await f.service.claim(f.identity());
    f.users.get(CREATOR)!.active = false;
    await expect(
      f.service.receipt(f.identity(), next.id, { state: 'SUBMITTING' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.jobs.get(next.id)!.status).toBe('CLAIMED');
  });
  it('expires only unsubmitted work and prevents cross-device document/receipt access', async () => {
    const f = printFixture();
    f.seedDevice();
    const job = await f.service.create(CREATOR, f.body());
    await f.service.claim(f.identity());
    f.seedDevice(DEVICE2);
    const other = { ...f.identity(), deviceId: DEVICE2 };
    await expect(f.service.document(other, job.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      f.service.receipt(other, job.id, { state: 'SUBMITTING' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    f.jobs.get(job.id)!.expiresAt = new Date(Date.now() - 1);
    expect((await f.service.status(CREATOR, COMPANY, job.id)).errorCode).toBe(
      'EXPIRED',
    );
    expect(f.jobs.get(job.id)!.pdfBytes).toBeNull();
    const next = await f.service.create(CREATOR, f.body());
    await f.service.claim(f.identity());
    await f.service.receipt(f.identity(), next.id, { state: 'SUBMITTING' });
    f.jobs.get(next.id)!.expiresAt = new Date(Date.now() - 1);
    expect((await f.service.status(CREATOR, COMPANY, next.id)).status).toBe(
      'SUBMITTING',
    );
    expect(await f.service.claim(f.identity())).toEqual({ job: null });
  });
  it('restricts revoke to the registered owner and preserves submitting uncertainty', async () => {
    const f = printFixture();
    f.seedDevice();
    const job = await f.service.create(CREATOR, f.body());
    await f.service.claim(f.identity());
    await f.service.receipt(f.identity(), job.id, { state: 'SUBMITTING' });
    await expect(
      f.service.revoke(CREATOR, COMPANY, DEVICE),
    ).rejects.toBeInstanceOf(NotFoundException);
    await f.service.revoke(OWNER, COMPANY, DEVICE);
    expect(f.devices.get(DEVICE)!.tokenHash).toBeNull();
    expect(f.jobs.get(job.id)!.status).toBe('UNKNOWN');
    await expect(
      f.service.authenticateDevice(DEVICE, TOKEN),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('does not permit production or disabled capability registration', async () => {
    const f = printFixture();
    process.env.ERP_DEV_SANDBOX = 'false';
    await expect(
      f.service.pair(OWNER, { entityId: COMPANY, name: 'Synthetic' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.devices.size).toBe(0);
  });
  it('clears expired unsubmitted PII even without a browser status read and leaves SUBMITTING untouched', async () => {
    const f = printFixture();
    f.seedDevice();
    const job = await f.service.create(CREATOR, f.body());
    f.jobs.get(job.id)!.expiresAt = new Date(Date.now() - 1);
    await f.service.clearExpiredDocuments();
    expect(f.jobs.get(job.id)!.pdfBytes).toBeNull();
    expect(f.jobs.get(job.id)!.status).toBe('FAILED');
    const next = await f.service.create(CREATOR, f.body());
    await f.service.claim(f.identity());
    await f.service.receipt(f.identity(), next.id, { state: 'SUBMITTING' });
    f.jobs.get(next.id)!.expiresAt = new Date(Date.now() - 1);
    await f.service.clearExpiredDocuments();
    expect(f.jobs.get(next.id)!.status).toBe('SUBMITTING');
    expect(f.jobs.get(next.id)!.pdfBytes).toBeNull();
    process.env.MAILROOM_PRINT_ENABLED = 'false';
    const count = f.db.mailroomPrintJob.updateMany.mock.calls.length;
    await f.service.clearExpiredDocuments();
    expect(f.db.mailroomPrintJob.updateMany.mock.calls.length).toBe(count);
  });
});
