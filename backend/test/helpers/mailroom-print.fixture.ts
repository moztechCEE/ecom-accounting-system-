/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- This test-only mutable repository deliberately models dynamic Prisma query shapes and async delegate promises; it is excluded from the production build. */
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MailroomService } from '../../src/modules/mailroom/mailroom.service';
import { MailroomPrintService } from '../../src/modules/mailroom/printing/mailroom-print.service';
import { capabilityHash } from '../../src/modules/mailroom/printing/mailroom-print.contract';

export const COMPANY = 'synthetic-company',
  OTHER_COMPANY = 'synthetic-other';
export const OWNER = 'synthetic-owner',
  CREATOR = 'synthetic-creator';
export const ITEM = '11111111-1111-4111-8111-111111111111';
export const ITEM2 = '22222222-2222-4222-8222-222222222222';
export const DEVICE = '33333333-3333-4333-8333-333333333333';
export const DEVICE2 = '44444444-4444-4444-8444-444444444444';
export const TOKEN = Buffer.alloc(32, 9).toString('base64url');
type Row = Record<string, any>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'entityId_createdById_requestId')
      return matches(row, condition);
    const value = row[key];
    if (
      condition &&
      typeof condition === 'object' &&
      !(condition instanceof Date) &&
      !Array.isArray(condition)
    ) {
      if ('in' in condition) return condition.in.includes(value);
      if ('hasSome' in condition)
        return value.some((item: string) => condition.hasSome.includes(item));
      if ('not' in condition) return value !== condition.not;
      if ('gt' in condition) return value > condition.gt;
      if ('lte' in condition) return value <= condition.lte;
      return !!value && matches(value, condition);
    }
    return value === condition;
  });
}
export function printFixture() {
  const devices = new Map<string, Row>(),
    jobs = new Map<string, Row>();
  const items = new Map<string, Row>(
    [ITEM, ITEM2].map((id) => [
      id,
      { id, entityId: COMPANY, version: 3, receipt: { entityId: COMPANY } },
    ]),
  );
  const users = new Map<string, Row>(
    [OWNER, CREATOR].map((id) => [
      id,
      {
        id,
        active: true,
        employeeActive: true,
        permissions: ['mailroom:read', 'mailroom:update'],
        entities: [COMPANY],
      },
    ]),
  );
  const oldBusiness = jest.fn(() => {
    throw new Error('unexpected business read/write');
  });
  function delegate(rows: Map<string, Row>, job: boolean) {
    const select = (where: Row) =>
      [...rows.values()].filter((row) => matches(row, where));
    return {
      findUnique: jest.fn(async ({ where }: Row) =>
        structuredClone(select(where)[0] || null),
      ),
      findFirst: jest.fn(async ({ where, orderBy }: Row) => {
        const values = select(where);
        if (orderBy?.createdAt)
          values.sort((a, b) => a.createdAt - b.createdAt);
        return structuredClone(values[0] || null);
      }),
      findMany: jest.fn(async ({ where, take }: Row) =>
        structuredClone(select(where).slice(0, take)),
      ),
      create: jest.fn(async ({ data }: Row) => {
        if (
          [...rows.values()].some(
            (row) =>
              row.id === data.id ||
              (job &&
                ((data.activeKey && row.activeKey === data.activeKey) ||
                  (row.entityId === data.entityId &&
                    row.createdById === data.createdById &&
                    row.requestId === data.requestId))),
          )
        )
          throw Object.assign(new Error('unique constraint'), {
            code: 'P2002',
          });
        const row = {
          id: randomUUID(),
          pairHash: null,
          pairExpiresAt: null,
          tokenHash: null,
          pairedAt: null,
          revokedAt: null,
          lastSeenAt: null,
          cupsJobId: null,
          errorCode: null,
          reprintOf: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.set(row.id, structuredClone(row));
        return structuredClone(row);
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const found = select(where);
        for (const row of found)
          rows.set(row.id, {
            ...row,
            ...structuredClone(data),
            updatedAt: new Date(),
          });
        return { count: found.length };
      }),
    };
  }
  let lock = Promise.resolve();
  const db: Row = {
    mailroomPrintDevice: delegate(devices, false),
    mailroomPrintJob: delegate(jobs, true),
    user: {
      findUnique: jest.fn(async ({ where }: Row) => {
        const user = users.get(where.id);
        return user
          ? {
              id: user.id,
              name: 'Synthetic clerk',
              isActive: user.active,
              mustChangePassword: !!user.mustChangePassword,
              employee:
                user.employeeBound === false
                  ? null
                  : {
                      isActive: user.employeeActive,
                      entityId: user.entities[0],
                      department: null,
                    },
              entityMemberships: user.entities.map((entityId: string) => ({
                entityId,
              })),
              roles: [
                {
                  role: {
                    code: user.role || 'STAFF',
                    permissions: user.permissions.map((key: string) => {
                      const [resource, action] = key.split(':');
                      return { permission: { resource, action } };
                    }),
                  },
                },
              ],
            }
          : null;
      }),
    },
    employee: {
      findFirst: jest.fn(async ({ where }: Row) => {
        const user = users.get(where.userId);
        return user?.employeeBound !== false &&
          user?.employeeActive &&
          user.entities.includes(where.entityId)
          ? { id: 'employee' }
          : null;
      }),
    },
    mailroomItem: {
      findMany: jest.fn(async ({ where }: Row) =>
        structuredClone(
          [...items.values()].filter((row) => matches(row, where)),
        ),
      ),
      update: oldBusiness,
    },
    mailroomReceipt: { update: oldBusiness },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      let release!: () => void;
      const previous = lock;
      lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const before = {
        devices: structuredClone(devices),
        jobs: structuredClone(jobs),
      };
      try {
        return await fn(db);
      } catch (error) {
        devices.clear();
        jobs.clear();
        for (const [id, row] of before.devices) devices.set(id, row);
        for (const [id, row] of before.jobs) jobs.set(id, row);
        throw error;
      } finally {
        release();
      }
    }),
  };
  const mailroom = new MailroomService(
    db as any,
    { sendToUser: oldBusiness } as any,
    {} as any,
  );
  const labels = {
    read: jest.fn(async (userId: string, entityId: string, id: string) => {
      if (entityId !== COMPANY || !items.has(id))
        throw new ForbiddenException();
      return {
        id,
        unit: 'MR-SYNTHETIC',
        caseNumber: 'SYNTHETIC-CASE',
        customerName: 'SYNTHETIC-NAME',
        customerPhone: '0900000000',
        customerIssue: 'SYNTHETIC-ISSUE',
        productName: '合成商品',
        qrLink:
          'https://erp.example.test/operations/repair?entityId=' +
          COMPANY +
          '&itemId=' +
          id,
        version: items.get(id)!.version,
      };
    }),
  };
  const exporter = {
    pdfMany: jest.fn(async () => Buffer.from('%PDF-SYNTHETIC-PDF')),
  };
  const service = new MailroomPrintService(
    db as any,
    mailroom,
    labels as any,
    exporter as any,
  );
  function seedDevice(id = DEVICE, entityId = COMPANY, token = TOKEN) {
    const row = {
      id,
      entityId,
      registeredById: OWNER,
      name: 'Synthetic Mac',
      pairedAt: new Date(),
      tokenHash: capabilityHash('token', token),
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
      pairHash: null,
      pairExpiresAt: null,
      revokedAt: null,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    devices.set(id, row);
    return row;
  }
  const identity = () => ({
    deviceId: DEVICE,
    entityId: COMPANY,
    registeredById: OWNER,
    tokenHash: capabilityHash('token', TOKEN),
  });
  const body = (overrides: Row = {}) => ({
    entityId: COMPANY,
    deviceId: DEVICE,
    requestId: randomUUID(),
    itemIds: [ITEM],
    ...overrides,
  });
  return {
    db,
    devices,
    jobs,
    items,
    users,
    oldBusiness,
    labels,
    exporter,
    mailroom,
    service,
    seedDevice,
    identity,
    body,
  };
}
