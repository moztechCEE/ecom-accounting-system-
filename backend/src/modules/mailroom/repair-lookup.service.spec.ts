import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Actor } from './mailroom.contract';
import { MAILROOM_SERVICE_AUTH } from './mailroom.auth';
import type { MailroomService } from './mailroom.service';
import type { MailroomSyncService } from './mailroom-sync.service';
import {
  repairCustomerContext,
  repairLookupCode,
  repairLookupResult,
  type RepairLookupRow,
} from './repair-lookup.contract';
import { RepairLookupQuery } from './repair-lookup.dto';
import { repairConditions } from './repair-list.contract';
import type { RepairTodoService } from './repair-todo.service';
import { RepairWorkbenchController } from './repair-workbench.controller';
import { RepairWorkbenchService } from './repair-workbench.service';

const company = 'synthetic-company';
const code = 'CASE-20261029-SYNTHETIC';
const reader = (permissions = ['repair_workbench:read']): Actor => ({
  id: 'synthetic-technician',
  name: 'Synthetic technician',
  entityIds: [company],
  permissions: new Set(permissions),
});
const row = (id = 'synthetic-item'): RepairLookupRow => ({
  id,
  entityId: company,
  receiptId: 'synthetic-receipt',
  productName: 'Synthetic repair product',
  label: 'SYNTHETIC-PHYSICAL-UNIT',
  status: 'WAITING_REPAIR_ACCEPTANCE',
  repairOwnerId: null,
  receipt: {
    id: 'synthetic-receipt',
    entityId: company,
    number: 'SYNTHETIC-MR-1',
    category: 'REPAIR',
    sourceCaseId: 'synthetic-source',
    sourceNumber: code,
    sourceSnapshot: {
      sourceSync: { sourceInstance: 'https://synthetic-source.invalid' },
    },
  },
});
const fixture = () => {
  const item = {
    ...row(),
    version: 2,
    custodianId: 'synthetic-clerk',
    repairInspection: null,
    repairReport: null,
  };
  const db = {
    mailroomItem: {
      findMany: jest.fn().mockResolvedValue([row()]),
      findUnique: jest
        .fn()
        .mockImplementation(() => Promise.resolve(structuredClone(item))),
      update: jest.fn(),
    },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    warehouse: { findMany: jest.fn().mockResolvedValue([]) },
    mailroomAction: { create: jest.fn() },
  };
  const mailroom = {
    enabled: jest.fn(),
    actor: jest.fn().mockImplementation(() => Promise.resolve(reader())),
    detail: jest
      .fn()
      .mockImplementation(() => Promise.resolve(structuredClone(item))),
    command: jest.fn(),
    record: jest.fn(),
    publish: jest.fn(),
  };
  const sync = {
    cases: jest.fn().mockResolvedValue({
      items: [
        {
          id: 'synthetic-source',
          type: 'REPAIR',
          number: code,
          status: 'PENDING_PAYMENT',
          repairAllowed: false,
          customerIssue: '第一行顧客原文\n 第二行，尚未確認原因。 ',
        },
      ],
    }),
  };
  const service = new RepairWorkbenchService(
    db as unknown as PrismaService,
    mailroom as unknown as MailroomService,
    sync as unknown as MailroomSyncService,
  );
  return { item, db, mailroom, sync, service };
};

describe('native repair case-number lookup DTO and controller', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const parse = (value: unknown) =>
    pipe.transform(value, { type: 'query', metatype: RepairLookupQuery });

  it('accepts native case numbers and trims scanner terminators without broadening item URL parsing', async () => {
    expect(await parse({ entityId: company, code: ` ${code}\r\n` })).toEqual({
      entityId: company,
      code,
    });
    expect(repairLookupCode('DEV-R-002')).toBe('DEV-R-002');
    expect(repairLookupCode('R-短號')).toBe('R-短號');
  });

  it.each([
    { entityId: company },
    { entityId: '', code },
    { entityId: company, code: '' },
    { entityId: company, code: ['A', 'B'] },
    { entityId: [company, 'another-company'], code },
    { entityId: company, code: 'A'.repeat(201) },
    { entityId: company, code: 'CASE\nOTHER' },
    { entityId: company, code: 'CASE\u0000OTHER' },
    { entityId: company, code: 'https://external.invalid/CASE-1' },
    { entityId: company, code: '/operations/repair?itemId=other' },
    { entityId: company, code: 'CASE-1&entityId=other' },
    { entityId: company, code, itemId: 'other' },
  ])('rejects malformed or injected query %j', async (value) => {
    await expect(parse(value)).rejects.toThrow();
  });

  it('is a native authenticated GET route and passes only the current requester to the service', async () => {
    const f = fixture();
    const controller = new RepairWorkbenchController(
      f.service,
      {} as RepairTodoService,
    );
    const handler = Object.getOwnPropertyDescriptor(
      RepairWorkbenchController.prototype,
      'lookup',
    )?.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('lookup');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    for (const target of [handler, RepairWorkbenchController]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, target)).toBeUndefined();
      expect(
        Reflect.getMetadata(MAILROOM_SERVICE_AUTH, target),
      ).toBeUndefined();
    }
    const lookup = jest.spyOn(f.service, 'lookup');
    await controller.lookup(
      { user: { id: 'synthetic-technician' } },
      { entityId: company, code },
    );
    expect(lookup).toHaveBeenCalledWith('synthetic-technician', {
      entityId: company,
      code,
    });
  });
});

describe('read-only exact repair case lookup', () => {
  it('checks company and repair read permission before any physical-item read', async () => {
    for (const current of [
      reader([]),
      { ...reader(), entityIds: ['other-company'] },
    ]) {
      const f = fixture();
      f.mailroom.actor.mockResolvedValue(current);
      await expect(
        f.service.lookup('synthetic-technician', { entityId: company, code }),
      ).rejects.toThrow();
      expect(f.db.mailroomItem.findMany).not.toHaveBeenCalled();
      expect(f.sync.cases).not.toHaveBeenCalled();
    }
    const f = fixture();
    f.mailroom.actor.mockRejectedValue(new Error('inactive actor'));
    await expect(
      f.service.lookup('inactive', { entityId: company, code }),
    ).rejects.toThrow('inactive actor');
    expect(f.db.mailroomItem.findMany).not.toHaveBeenCalled();
  });

  it('queries exact authoritative sourceNumber and existing repair eligibility with a 201 sentinel', async () => {
    const f = fixture();
    const result = await f.service.lookup('synthetic-technician', {
      entityId: company,
      code: ` ${code} `,
    });
    expect(f.db.mailroomItem.findMany).toHaveBeenCalledWith({
      where: {
        entityId: company,
        receipt: { entityId: company, sourceNumber: code },
        AND: repairConditions('all', 'synthetic-technician'),
      },
      select: {
        id: true,
        entityId: true,
        receiptId: true,
        productName: true,
        label: true,
        status: true,
        repairOwnerId: true,
        receipt: {
          select: {
            id: true,
            entityId: true,
            number: true,
            category: true,
            sourceCaseId: true,
            sourceNumber: true,
            sourceSnapshot: true,
          },
        },
      },
      orderBy: [{ receiptId: 'asc' }, { id: 'asc' }],
      take: 201,
    });
    expect(result).toEqual({
      kind: 'MATCH',
      entityId: company,
      matches: [
        {
          itemId: 'synthetic-item',
          entityId: company,
          productName: 'Synthetic repair product',
          label: 'SYNTHETIC-PHYSICAL-UNIT',
          sourceNumber: code,
          receiptNumber: 'SYNTHETIC-MR-1',
          status: 'WAITING_REPAIR_ACCEPTANCE',
          statusLabel: '待維修簽收',
        },
      ],
    });
    expect(f.sync.cases).not.toHaveBeenCalled();
    expect(f.db.mailroomItem.update).not.toHaveBeenCalled();
    expect(f.db.mailroomAction.create).not.toHaveBeenCalled();
    expect(f.mailroom.command).not.toHaveBeenCalled();
    expect(f.mailroom.record).not.toHaveBeenCalled();
    expect(f.mailroom.publish).not.toHaveBeenCalled();
  });

  it('does not fall back to a physical label, SKU, SN, partial case number or another company', () => {
    const candidates = [
      {
        ...row('same-label'),
        label: code,
        receipt: { ...row().receipt, sourceNumber: 'OTHER' },
      },
      {
        ...row('partial-case'),
        receipt: { ...row().receipt, sourceNumber: code + '-OTHER' },
      },
      { ...row('other-company'), entityId: 'other-company' },
      {
        ...row('other-receipt-company'),
        receipt: { ...row().receipt, entityId: 'other-company' },
      },
      {
        ...row('general-parcel'),
        receipt: { ...row().receipt, category: 'PARCEL' },
      },
      {
        ...row('unassigned-return'),
        status: 'RECEIVED',
        receipt: { ...row().receipt, category: 'RETURN' },
      },
    ];
    expect(repairLookupResult(company, code, candidates)).toEqual({
      kind: 'NOT_FOUND',
      entityId: company,
      matches: [],
    });
  });

  it('distinguishes same-case physical units without guessing the first one', () => {
    const first = row('first');
    const second = {
      ...row('second'),
      receiptId: 'another-receipt',
      receipt: {
        ...row().receipt,
        id: 'another-receipt',
        number: 'SYNTHETIC-MR-2',
      },
    };
    const result = repairLookupResult(company, code, [first, second]);
    expect(result.kind).toBe('MULTIPLE');
    expect(result.matches.map((match) => match.itemId)).toEqual([
      'first',
      'second',
    ]);
    expect(result.matches.map((match) => match.receiptNumber)).toEqual([
      'SYNTHETIC-MR-1',
      'SYNTHETIC-MR-2',
    ]);
  });

  it.each(['case', 'site', 'unknown-site', 'category', 'unbound-receipt'])(
    'returns AMBIGUOUS for distinct %s identities sharing one display case number',
    (kind) => {
      const first = row('first');
      const second = row('second');
      if (kind === 'case') second.receipt.sourceCaseId = 'other-source';
      if (kind === 'site')
        second.receipt.sourceSnapshot = {
          sourceSync: { sourceInstance: 'https://other-source.invalid' },
        };
      if (kind === 'unknown-site') second.receipt.sourceSnapshot = null;
      if (kind === 'category') {
        second.receipt.category = 'RETURN';
        second.status = 'PENDING_REFURBISH';
      }
      if (kind === 'unbound-receipt') {
        first.receipt.sourceCaseId = second.receipt.sourceCaseId = null;
        second.receiptId = second.receipt.id = 'other-receipt';
      }
      expect(repairLookupResult(company, code, [first, second]).kind).toBe(
        'AMBIGUOUS',
      );
    },
  );

  it('handles empty, exactly 200 and overflow without treating a truncated result as unique', async () => {
    const f = fixture();
    f.db.mailroomItem.findMany.mockResolvedValueOnce([]);
    expect(
      await f.service.lookup('synthetic-technician', {
        entityId: company,
        code,
      }),
    ).toEqual({ kind: 'NOT_FOUND', entityId: company, matches: [] });
    const twoHundred = Array.from({ length: 200 }, (_, index) =>
      row(`unit-${index}`),
    );
    const full = repairLookupResult(company, code, twoHundred);
    expect(full.kind).toBe('MULTIPLE');
    expect(full.matches).toHaveLength(200);
    f.db.mailroomItem.findMany.mockResolvedValueOnce([
      ...twoHundred,
      row('sentinel'),
    ]);
    expect(
      await f.service.lookup('synthetic-technician', {
        entityId: company,
        code,
      }),
    ).toEqual({
      kind: 'AMBIGUOUS',
      entityId: company,
      matches: [],
      limitExceeded: true,
    });
  });

  it('does not infer a shared Source site across independent legacy receipts when both lack site evidence', () => {
    const first = row('first');
    const second = row('second');
    first.receipt.sourceSnapshot = null;
    second.receipt.sourceSnapshot = {};
    expect(repairLookupResult(company, code, [first, second]).kind).toBe(
      'MULTIPLE',
    );
    second.receiptId = second.receipt.id = 'independent-legacy-receipt';
    expect(repairLookupResult(company, code, [first, second]).kind).toBe(
      'AMBIGUOUS',
    );
  });

  it('validates direct service callers before querying and propagates database failures', async () => {
    const f = fixture();
    await expect(
      f.service.lookup('synthetic-technician', {
        entityId: company,
        code: 'https://invalid.test',
      }),
    ).rejects.toThrow('案件編號格式不符');
    expect(f.db.mailroomItem.findMany).not.toHaveBeenCalled();
    f.db.mailroomItem.findMany.mockRejectedValueOnce(
      new Error('synthetic database unavailable'),
    );
    await expect(
      f.service.lookup('synthetic-technician', { entityId: company, code }),
    ).rejects.toThrow('synthetic database unavailable');
  });
});

describe('source customer context in actual repair documents response', () => {
  it('preserves actual customer wording separately from technical forms and read-only precheck', async () => {
    const f = fixture();
    const before = structuredClone(f.item);
    const result = await f.service.documents(
      'synthetic-technician',
      company,
      f.item.id,
    );
    expect(result.customerContext).toEqual({
      state: 'AVAILABLE',
      sourceCaseId: 'synthetic-source',
      sourceNumber: code,
      customerIssue: '第一行顧客原文\n 第二行，尚未確認原因。 ',
    });
    expect(result.release).toMatchObject({
      available: true,
      repairAllowed: false,
      sourceStatus: 'PENDING_PAYMENT',
    });
    expect(f.item).toEqual(before);
    expect(f.db.mailroomItem.update).not.toHaveBeenCalled();
    expect(f.mailroom.command).not.toHaveBeenCalled();
    expect(f.mailroom.record).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', ' \n\t '])(
    'uses NOT_PROVIDED for Source customerIssue %j without technical/precheck fallback',
    async (issue) => {
      const f = fixture();
      f.sync.cases.mockResolvedValueOnce({
        items: [
          {
            id: 'synthetic-source',
            type: 'REPAIR',
            number: code,
            customerIssue: issue,
          },
        ],
      });
      const result = await f.service.documents(
        'synthetic-technician',
        company,
        f.item.id,
      );
      expect(result.customerContext).toEqual({
        state: 'NOT_PROVIDED',
        sourceCaseId: 'synthetic-source',
        sourceNumber: code,
      });
      expect(result.customerContext).not.toHaveProperty('customerIssue');
    },
  );

  it('does not fabricate a Source identity or perform a source fetch for an unbound receipt', async () => {
    const f = fixture();
    f.item.receipt.sourceCaseId = null;
    const result = await f.service.documents(
      'synthetic-technician',
      company,
      f.item.id,
    );
    expect(result.customerContext).toEqual({ state: 'NOT_PROVIDED' });
    expect(f.sync.cases).not.toHaveBeenCalled();
  });

  it.each(
    [
      [],
      [
        {
          id: 'other-source',
          type: 'REPAIR',
          customerIssue: 'other case secret',
        },
      ],
      [
        {
          id: 'synthetic-source',
          type: 'RETURN',
          customerIssue: 'other category secret',
        },
      ],
      [
        { id: 'synthetic-source', type: 'REPAIR', customerIssue: 'first' },
        { id: 'synthetic-source', type: 'REPAIR', customerIssue: 'second' },
      ],
      [
        {
          id: 'synthetic-source',
          type: 'REPAIR',
          customerIssue: { malformed: 'not customer words' },
        },
      ],
    ].map((items) => ({ items })),
  )(
    'keeps mismatched, ambiguous or malformed Source response unavailable %j',
    async ({ items }) => {
      const f = fixture();
      f.sync.cases.mockResolvedValueOnce({ items });
      const result = await f.service.documents(
        'synthetic-technician',
        company,
        f.item.id,
      );
      expect(result.customerContext).toEqual({
        state: 'UNAVAILABLE',
        sourceCaseId: 'synthetic-source',
      });
      expect(result.customerContext).not.toHaveProperty('customerIssue');
    },
  );

  it('keeps network failures unavailable and current-company denial before the source read', async () => {
    const f = fixture();
    f.sync.cases.mockRejectedValueOnce(new Error('synthetic source down'));
    expect(
      (await f.service.documents('synthetic-technician', company, f.item.id))
        .customerContext,
    ).toEqual({ state: 'UNAVAILABLE', sourceCaseId: 'synthetic-source' });
    f.sync.cases.mockClear();
    f.mailroom.actor.mockResolvedValueOnce({
      ...reader(),
      entityIds: ['other-company'],
    });
    await expect(
      f.service.documents('synthetic-technician', company, f.item.id),
    ).rejects.toThrow('無此公司');
    expect(f.sync.cases).not.toHaveBeenCalled();
  });

  it('preserves markup as customer text for the UI to escape, not as HTML or a substituted diagnosis', () => {
    expect(
      repairCustomerContext('source', 'REPAIR', {
        id: 'source',
        type: 'REPAIR',
        customerIssue: '<script>customer text</script>\n原文',
      }),
    ).toEqual({
      state: 'AVAILABLE',
      sourceCaseId: 'source',
      customerIssue: '<script>customer text</script>\n原文',
    });
  });
});
