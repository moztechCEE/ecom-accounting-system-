/* eslint-disable @typescript-eslint/no-unsafe-member-access -- The existing synthetic repository deliberately uses mutable Prisma-shaped rows. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  COMPANY,
  CREATOR,
  ITEM,
  ITEM2,
  OTHER_COMPANY,
  printFixture,
} from '../../../../test/helpers/mailroom-print.fixture';
import { canonical } from '../mailroom.contract';
import {
  hash,
  PRINT_PROFILE,
  requestFingerprint,
} from './mailroom-print.contract';
import {
  LABEL_EDIT_LIMITS,
  normalizeLabelEdit,
  normalizeLabelEdits,
} from './mailroom-print-label-edit.contract';

describe('display-only label edits and preview', () => {
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

  it('retains the exact legacy request hash for omitted/empty/no-op edits', async () => {
    const f = printFixture();
    f.seedDevice();
    const body = f.body();
    const legacyHash = hash(
      canonical({
        entityId: body.entityId,
        deviceId: body.deviceId,
        itemIds: body.itemIds,
        reprintOf: null,
        profile: PRINT_PROFILE,
      }),
    );
    expect(requestFingerprint(body)).toBe(legacyHash);
    const job = await f.service.create(CREATOR, body);
    expect(f.jobs.get(job.id)!.requestHash).toBe(legacyHash);
    expect(
      (await f.service.create(CREATOR, { ...body, labelEdits: [] })).id,
    ).toBe(job.id);
    expect(
      (
        await f.service.create(CREATOR, {
          ...body,
          labelEdits: [{ itemId: ITEM, expectedVersion: 1 }],
        })
      ).id,
    ).toBe(job.id);
    expect(f.jobs.size).toBe(1);
  });

  it('fingerprints normalized edits, treats equivalent retries identically and rejects changed print text', async () => {
    const f = printFixture();
    f.seedDevice();
    const body = f.body({
      labelEdits: [
        {
          itemId: ITEM.toUpperCase(),
          expectedVersion: 3,
          customerIssue: '  充電  異常  ',
        },
      ],
    });
    const job = await f.service.create(CREATOR, body);
    const normalized = {
      ...body,
      labelEdits: [
        { itemId: ITEM, expectedVersion: 3, customerIssue: '充電 異常' },
      ],
    };
    expect((await f.service.create(CREATOR, normalized)).id).toBe(job.id);
    expect(f.jobs.get(job.id)!.requestHash).toBe(
      requestFingerprint(normalized),
    );
    await expect(
      f.service.create(CREATOR, {
        ...body,
        labelEdits: [
          { itemId: ITEM, expectedVersion: 3, customerIssue: '無法開機' },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      f.service.create(CREATOR, {
        ...normalized,
        labelEdits: [{ ...normalized.labelEdits[0], expectedVersion: 4 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.jobs.size).toBe(1);
  });

  it('has deterministic edit ordering without changing selected page ordering', () => {
    const first = normalizeLabelEdits(
      [
        { itemId: ITEM2, expectedVersion: 3, customerIssue: '第二件' },
        { itemId: ITEM, expectedVersion: 3, customerIssue: '第一件' },
      ],
      [ITEM2, ITEM],
    );
    expect(first.map((edit) => edit.itemId)).toEqual([ITEM, ITEM2]);
    expect(normalizeLabelEdits([...first].reverse(), [ITEM, ITEM2])).toEqual(
      first,
    );
  });

  it.each(Object.entries(LABEL_EDIT_LIMITS))(
    'enforces the %s unicode length limit and preserves explicit empty text',
    (field, max) => {
      expect(
        normalizeLabelEdit({
          itemId: ITEM,
          expectedVersion: 3,
          [field]: '字'.repeat(max),
        }),
      ).toHaveProperty(field, '字'.repeat(max));
      expect(
        normalizeLabelEdit({ itemId: ITEM, expectedVersion: 3, [field]: '' }),
      ).toHaveProperty(field, '');
      expect(() =>
        normalizeLabelEdit({
          itemId: ITEM,
          expectedVersion: 3,
          [field]: '字'.repeat(max + 1),
        }),
      ).toThrow(BadRequestException);
    },
  );

  it.each([
    null,
    {},
    'text',
    [{ itemId: ITEM, customerIssue: null }],
    [{ itemId: ITEM, customerIssue: 12 }],
    [{ itemId: ITEM, customerIssue: 'A\nB' }],
    [{ itemId: ITEM, customerIssue: 'A\u0000B' }],
    [{ itemId: ITEM, customerName: 'A\u202eB' }],
    [{ itemId: ITEM, qrLink: 'https://evil.test' }],
    [{ itemId: ITEM, id: ITEM2 }],
    [{ itemId: ITEM, unit: 'forged' }],
    [{ itemId: ITEM, version: 99 }],
    [{ customerName: 'No item' }],
    [{ itemId: ITEM2, expectedVersion: 3, customerName: 'Unselected' }],
    [{ itemId: ITEM }, { itemId: ITEM.toUpperCase() }],
  ])(
    'rejects malformed, unsafe, duplicate or unselected edits before source reads: %j',
    async (labelEdits) => {
      const f = printFixture();
      await expect(
        f.service.create(CREATOR, f.body({ labelEdits })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(f.labels.read).not.toHaveBeenCalled();
      expect(f.exporter.pdfMany).not.toHaveBeenCalled();
      expect(f.jobs.size).toBe(0);
    },
  );

  it.each([undefined, null, 0, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1])(
    'requires a positive integer loaded version for edited text: %j',
    async (expectedVersion) => {
      const f = printFixture();
      await expect(
        f.service.create(
          CREATOR,
          f.body({
            labelEdits: [
              {
                itemId: ITEM,
                expectedVersion,
                customerName: '王小明',
              },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(f.labels.read).not.toHaveBeenCalled();
      expect(f.jobs.size).toBe(0);
    },
  );

  it('rejects stale edited previews and jobs before rendering, with no job or original-case writes', async () => {
    const f = printFixture();
    f.seedDevice();
    const edit = {
      itemId: ITEM,
      expectedVersion: 2,
      customerIssue: '舊版內容',
    };
    const before = JSON.stringify([...f.items.entries()]);
    for (const run of [
      () =>
        f.service.preview(CREATOR, {
          entityId: COMPANY,
          itemId: ITEM,
          labelEdit: edit,
        }),
      () => f.service.create(CREATOR, f.body({ labelEdits: [edit] })),
    ]) {
      await expect(run()).rejects.toMatchObject({
        response: {
          code: 'LABEL_VERSION_CHANGED',
          message: '物件已更新，請重新載入標籤',
        },
      });
    }
    expect(f.exporter.pdfMany).not.toHaveBeenCalled();
    expect(f.db.mailroomPrintJob.create).not.toHaveBeenCalled();
    expect(f.jobs.size).toBe(0);
    expect(JSON.stringify([...f.items.entries()])).toBe(before);
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });

  it('renders the same edited text for preview and real print, preserving trusted QR/id/version and original records', async () => {
    const f = printFixture();
    f.seedDevice();
    const before = JSON.stringify([...f.items.entries()]);
    const edit = {
      itemId: ITEM,
      expectedVersion: 3,
      caseNumber: 'R-短號',
      customerName: '王小明',
      customerPhone: '0912345678',
      productName: '萬能充 Pro',
      customerIssue: 'Type-C 線無輸出',
    };
    const preview = await f.service.preview(CREATOR, {
      entityId: COMPANY,
      itemId: ITEM,
      labelEdit: edit,
    });
    expect(preview.toString()).toBe('%PDF-SYNTHETIC-PDF');
    expect(f.jobs.size).toBe(0);
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.db.mailroomPrintJob.updateMany).not.toHaveBeenCalled();
    expect(f.db.mailroomPrintDevice.findFirst).not.toHaveBeenCalled();
    await f.service.create(CREATOR, f.body({ labelEdits: [edit] }));
    const calls = f.exporter.pdfMany.mock.calls as unknown as [unknown][];
    expect(calls[0][0]).toEqual(calls[1][0]);
    expect(calls[0][0]).toEqual([
      expect.objectContaining({
        id: ITEM,
        version: 3,
        unit: 'MR-SYNTHETIC',
        caseNumber: 'R-短號',
        customerName: '王小明',
        customerPhone: '0912345678',
        productName: '萬能充 Pro',
        customerIssue: 'Type-C 線無輸出',
        qrLink:
          'https://erp.example.test/operations/repair?entityId=' +
          COMPANY +
          '&itemId=' +
          ITEM,
      }),
    ]);
    expect(JSON.stringify([...f.items.entries()])).toBe(before);
    expect(f.oldBusiness).not.toHaveBeenCalled();
  });

  it('keeps omitted fields and accepts preview edits with implicit outer item identity', async () => {
    const f = printFixture();
    await f.service.preview(CREATOR, {
      entityId: COMPANY,
      itemId: ITEM,
      labelEdit: { expectedVersion: 3, customerIssue: '' },
    });
    const calls = f.exporter.pdfMany.mock.calls as unknown as [unknown][];
    expect(calls[0][0]).toEqual([
      expect.objectContaining({
        customerName: 'SYNTHETIC-NAME',
        customerIssue: '',
        productName: '合成商品',
      }),
    ]);
    await expect(
      f.service.preview(CREATOR, {
        entityId: COMPANY,
        itemId: ITEM,
        labelEdit: { itemId: ITEM2 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['company', 'employee', 'permission'])(
    'denies unauthorized preview %s before source reads',
    async (mode) => {
      const f = printFixture();
      if (mode === 'employee') f.users.get(CREATOR)!.employeeActive = false;
      if (mode === 'permission')
        f.users.get(CREATOR)!.permissions = ['mailroom:read'];
      await expect(
        f.service.preview(CREATOR, {
          entityId: mode === 'company' ? OTHER_COMPANY : COMPANY,
          itemId: ITEM,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.labels.read).not.toHaveBeenCalled();
      expect(f.jobs.size).toBe(0);
    },
  );

  it.each(['version', 'company', 'permission'])(
    'rechecks preview %s after render without job or business writes',
    async (mode) => {
      const f = printFixture();
      f.exporter.pdfMany.mockImplementation(() => {
        if (mode === 'version') f.items.get(ITEM)!.version++;
        if (mode === 'company') f.items.get(ITEM)!.entityId = OTHER_COMPANY;
        if (mode === 'permission')
          f.users.get(CREATOR)!.permissions = ['mailroom:read'];
        return Promise.resolve(Buffer.from('%PDF-synthetic'));
      });
      await expect(
        f.service.preview(CREATOR, { entityId: COMPANY, itemId: ITEM }),
      ).rejects.toThrow();
      expect(f.jobs.size).toBe(0);
      expect(f.oldBusiness).not.toHaveBeenCalled();
      expect(f.db.mailroomPrintJob.updateMany).not.toHaveBeenCalled();
    },
  );
});
