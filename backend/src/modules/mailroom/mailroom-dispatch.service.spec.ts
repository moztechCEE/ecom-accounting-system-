/* Offline transaction fixtures exercise native writes and explicitly prohibit integrations. */
/* Async Prisma adapters intentionally return untyped synthetic boundary rows. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  ConflictException,
  ForbiddenException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MailroomService } from './mailroom.service';
import { MailroomCommandDto } from './mailroom.dto';
import { type Actor } from './mailroom.contract';
import { MailroomController } from './mailroom.controller';
import { MailroomIntakeService } from './mailroom-intake.service';

// Match all production ValidationPipe options in main.ts, including conversion.
function mainValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}

function fixture(replaced = false) {
  const actor: Actor = {
    id: 'clerk',
    name: '收發同仁',
    entityIds: ['company'],
    permissions: new Set(['mailroom:read', 'mailroom:update']),
  };
  const row: any = {
    id: 'piece',
    receiptId: 'receipt',
    entityId: 'company',
    version: 7,
    status: 'READY_FOR_DISPATCH',
    label: 'MR-DEMO-1',
    productName: '原件名稱',
    sku: 'ORIGINAL-SKU',
    serialNumber: 'ORIGINAL-SN',
    location: '寄回區',
    custodianId: 'clerk',
    recipientId: null,
    nextUserId: null,
    repairOwnerId: 'tech',
    matchResult: 'MATCH',
    grade: null,
    disposition: null,
    evidence: [],
    returnInspection: null,
    repairInspection: { technical: 'private' },
    repairWorkflow: {
      schema: 1,
      intake: {
        status: 'RESOLVED',
        sentToUserId: 'csr',
        sentToUserName: '客服',
        sentBy: 'clerk',
        sentAt: '2026-10-01T00:00:00Z',
        ownerId: 'csr',
        acceptedAt: '2026-10-01T00:01:00Z',
        resolvedAt: '2026-10-01T00:02:00Z',
        sourceCaseId: 'case',
        sourceItemId: 'source-line',
        note: '補建完成',
      },
      csr: { status: 'RESOLVED', ownerId: 'csr', decision: 'APPROVE' },
      factory: {
        stage: 'RETURNED',
        physicalCustody: 'TECHNICIAN',
        reference: 'FACTORY-OLD',
      },
      inventoryReceipt: { preserved: 'inventory provenance' },
      release: { purpose: 'REPAIRED', inspectionRevision: 3, note: '複驗完成' },
    },
    receipt: {
      id: 'receipt',
      entityId: 'company',
      number: 'MR-DEMO',
      category: 'REPAIR',
      sourceCaseId: 'case',
      sourceNumber: 'CASE-DEMO',
      sourceSnapshot: { status: 'PROCESSING' },
      customerServiceUserId: 'csr',
      receivedById: 'clerk',
      receivedAt: new Date('2026-10-01T00:00:00Z'),
      carrier: '來件物流',
      trackingNumber: 'IN-001',
      senderLabel: '顧客',
    },
  };
  const posted: any = {
    id: 'reservation',
    entityId: 'company',
    itemId: row.id,
    unitId: 'new-unit',
    status: 'POSTED',
    outTransactionId: 'formal-out',
    externalStatus: 'CONFIRMED',
    unit: {
      id: 'new-unit',
      entityId: 'company',
      productId: 'new-product',
      warehouseId: 'warehouse',
      unitLabel: 'UNIT-NEW',
      serialNumber: 'NEW-SN',
      status: 'CONSUMED',
      kind: 'NEW',
    },
    outTransaction: {
      id: 'formal-out',
      entityId: 'company',
      productId: 'new-product',
      warehouseId: 'warehouse',
      direction: 'OUT',
      quantity: '1',
      referenceType: 'AFTER_SALES_REPLACEMENT',
      referenceId: 'reservation',
    },
  };
  if (replaced) {
    row.repairReport = {
      status: 'SUBMITTED',
      inspectionRevision: 3,
      data: {
        outcome: 'REPLACED',
        qcResult: 'PASS',
        replacementCondition: 'NEW',
        replacementSku: 'NEW-SKU',
        replacementSerial: 'NEW-SN',
      },
    };
    row.repairWorkflow.release = {
      purpose: 'REPLACED',
      inspectionRevision: 3,
      note: '複驗完成',
      stock: {
        reservationId: 'reservation',
        postingId: 'formal-out',
        status: 'POSTED',
        quantity: 1,
        entityId: 'company',
        itemId: row.id,
        unitLabel: 'UNIT-NEW',
        replacementSN: 'NEW-SN',
        externalStatus: 'CONFIRMED',
      },
    };
  }
  const actions: any[] = [];
  const prisma: any = {
    employee: {
      findFirst: jest.fn().mockResolvedValue({ id: 'employee-clerk' }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'clerk', name: '收發同仁' },
        { id: 'tech', name: '維修同仁' },
      ]),
    },
    mailroomItem: {
      findUnique: jest.fn(async () => structuredClone(row)),
      findUniqueOrThrow: jest.fn(async () => structuredClone(row)),
      findMany: jest.fn(async () => [structuredClone(row)]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(row, data, {
          version: row.version + data.version.increment,
        });
        return structuredClone(row);
      }),
    },
    mailroomReceipt: { update: jest.fn() },
    mailroomAction: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          actions.find(
            (entry) =>
              entry.requestId === where.entityId_actorId_requestId.requestId,
          ) || null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const entry = {
          ...structuredClone(data),
          id: `action-${actions.length}`,
          createdAt: new Date('2026-10-08T00:00:00Z'),
        };
        actions.push(entry);
        return entry;
      }),
      findMany: jest.fn(async () => structuredClone(actions)),
    },
    mailroomTask: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    notification: { create: jest.fn() },
    mailroomDelivery: {
      createMany: jest.fn(),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'historical', status: 'DELIVERED', target: 'AFTER_SALES' },
        ]),
      groupBy: jest
        .fn()
        .mockResolvedValue([
          { target: 'AFTER_SALES', status: 'DELIVERED', _count: 1 },
        ]),
    },
    afterSalesStockReservation: {
      findFirst: jest.fn().mockImplementation(async () => posted),
      update: jest.fn(),
    },
    afterSalesStockUnit: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    product: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'new-product',
        entityId: 'company',
        name: '替換實物名稱',
        sku: 'NEW-SKU',
      }),
    },
    inventoryTransaction: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  let queue: Promise<unknown> = Promise.resolve();
  prisma.$transaction.mockImplementation((callback: any) => {
    const result = queue.then(async () => {
      const before = structuredClone(row),
        actionCount = actions.length;
      try {
        return await callback(prisma);
      } catch (error) {
        Object.keys(row).forEach((key) => delete row[key]);
        Object.assign(row, before);
        actions.length = actionCount;
        throw error;
      }
    });
    queue = result.catch(() => undefined);
    return result;
  });
  const gateway = { sendToUser: jest.fn() };
  const sync = { cases: jest.fn(), deliverPending: jest.fn() };
  const stock = { consumeForRepair: jest.fn() };
  const service = new MailroomService(
    prisma,
    gateway as any,
    sync as any,
    stock as any,
  );
  jest.spyOn(service, 'actor').mockImplementation(async () => actor);
  const input: MailroomCommandDto = {
    entityId: 'company',
    requestId: 'dispatch-001',
    expectedVersion: 7,
    action: 'dispatch',
    confirmedItems: true,
    carrier: ' 寄回物流 ',
    trackingNumber: ' OUT-001 ',
    note: '  已核對實物  ',
  };
  return {
    row,
    actor,
    prisma,
    service,
    actions,
    gateway,
    sync,
    stock,
    input,
    posted,
  };
}

describe('native mailroom dispatch transaction', () => {
  const originalEnabled = process.env.MAILROOM_ENABLED;
  beforeEach(() => {
    process.env.MAILROOM_ENABLED = 'true';
  });
  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = originalEnabled;
  });

  it('preserves all workflow namespaces and incoming tracking, with a server timestamp and immutable outgoing snapshot', async () => {
    const { service, row, prisma, input, actions, sync, gateway } = fixture();
    const beforeWorkflow = structuredClone(row.repairWorkflow),
      beforeReceipt = structuredClone(row.receipt);
    await expect(service.command('clerk', row.id, input)).resolves.toEqual({
      id: 'piece',
      duplicate: false,
    });
    expect(row.status).toBe('DISPATCHED');
    expect(row.version).toBe(8);
    const shipment = row.repairWorkflow.outboundShipment;
    expect(shipment).toMatchObject({
      status: 'HANDED_TO_CARRIER',
      carrier: '寄回物流',
      trackingNumber: 'OUT-001',
      fromVersion: 7,
      version: 8,
      dispatchedById: 'clerk',
      dispatchedByName: '收發同仁',
      dispatchedByEmployeeId: 'employee-clerk',
      note: '已核對實物',
      physicalItem: {
        kind: 'ORIGINAL',
        productName: '原件名稱',
        serialNumber: 'ORIGINAL-SN',
      },
      sourceSync: {
        status: 'PENDING_COMPATIBILITY',
        reason: 'DISPATCH_CONSUMER_NOT_CONFIGURED',
      },
    });
    expect(Number.isFinite(Date.parse(shipment.dispatchedAt))).toBe(true);
    const { outboundShipment: _, ...preserved } = row.repairWorkflow;
    void _;
    expect(preserved).toEqual(beforeWorkflow);
    expect(row.receipt).toEqual(beforeReceipt);
    expect(actions[0].snapshot).toMatchObject({
      status: 'DISPATCHED',
      physicalCustody: 'CUSTOMER_CARRIER',
      location: '寄回物流 · OUT-001',
      outboundShipment: shipment,
    });
    expect(row.location).toBe('寄回區');
    expect(prisma.mailroomDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.mailroomReceipt.update).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(gateway.sendToUser).not.toHaveBeenCalled();
    expect(sync.cases).not.toHaveBeenCalled();
    expect(sync.deliverPending).not.toHaveBeenCalled();
  });
  it('shows outgoing logistics on list/detail/Source read projection even when technical documents are redacted', async () => {
    const { service, row, input } = fixture();
    await service.command('clerk', row.id, input);
    const list = await service.list('clerk', {
      entityId: 'company',
      view: 'mailroom',
    });
    const detail = await service.detail('clerk', 'company', row.id);
    const progress = await service.caseProgress('company', 'case');
    for (const view of [list.items[0], detail, progress.items[0]]) {
      expect(view).toMatchObject({
        status: 'DISPATCHED',
        physicalCustody: 'CUSTOMER_CARRIER',
        location: '寄回物流 · OUT-001',
        outboundShipment: row.repairWorkflow.outboundShipment,
      });
    }
    expect(detail).not.toHaveProperty('repairWorkflow');
    expect(detail).not.toHaveProperty('repairInspection');
    expect(detail.history[0].snapshot).toHaveProperty('outboundShipment');
    expect(detail.history[0].snapshot).not.toHaveProperty('repairWorkflow');
    expect(detail.deliverySummary).toEqual([
      { target: 'AFTER_SALES', status: 'DELIVERED', count: 1 },
    ]);
    expect(detail.outboundShipment!.sourceSync.status).toBe(
      'PENDING_COMPATIBILITY',
    );
  });
  it('exact retry has one write/history entry and changed-payload retry conflicts', async () => {
    const { service, row, input, prisma, actions } = fixture();
    await service.command('clerk', row.id, input);
    const shipment = structuredClone(row.repairWorkflow.outboundShipment);
    await expect(service.command('clerk', row.id, input)).resolves.toEqual({
      id: 'piece',
      duplicate: true,
    });
    await expect(
      service.command('clerk', row.id, {
        ...input,
        trackingNumber: 'DIFFERENT',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row.repairWorkflow.outboundShipment).toEqual(shipment);
    expect(actions).toHaveLength(1);
    expect(prisma.mailroomItem.update).toHaveBeenCalledTimes(1);
  });
  it('replays still reject revoked update permission and revoked employee binding', async () => {
    const { service, row, input, actor, prisma, actions } = fixture();
    await service.command('clerk', row.id, input);
    actor.permissions.delete('mailroom:update');
    await expect(
      service.command('clerk', row.id, input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    actor.permissions.add('mailroom:update');
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(
      service.command('clerk', row.id, input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(actions).toHaveLength(1);
    expect(prisma.mailroomItem.update).toHaveBeenCalledTimes(1);
  });
  it('concurrent different requests ship the piece once and reject the stale second request', async () => {
    const { service, row, input, actions } = fixture();
    const outcomes = await Promise.allSettled([
      service.command('clerk', row.id, input),
      service.command('clerk', row.id, { ...input, requestId: 'dispatch-002' }),
    ]);
    expect(outcomes.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(actions).toHaveLength(1);
    expect(row.version).toBe(8);
  });
  it('replacement dispatch reads its real product/SN and POSTED OUT without posting inventory again', async () => {
    const { service, row, input, prisma, stock } = fixture(true);
    await service.command('clerk', row.id, input);
    expect(row.repairWorkflow.outboundShipment.physicalItem).toMatchObject({
      kind: 'REPLACEMENT',
      productName: '替換實物名稱',
      sku: 'NEW-SKU',
      serialNumber: 'NEW-SN',
      stock: {
        reservationId: 'reservation',
        postingId: 'formal-out',
        unitId: 'new-unit',
      },
    });
    expect(row.serialNumber).toBe('ORIGINAL-SN');
    expect(prisma.afterSalesStockReservation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'reservation',
          entityId: 'company',
          itemId: 'piece',
          status: 'POSTED',
        },
      }),
    );
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(prisma.afterSalesStockReservation.update).not.toHaveBeenCalled();
    expect(prisma.afterSalesStockUnit.update).not.toHaveBeenCalled();
    expect(stock.consumeForRepair).not.toHaveBeenCalled();
  });
  it('blocks unproven replacement shipment without an item/history/outbox write', async () => {
    const { service, row, input, posted, prisma } = fixture(true);
    posted.outTransaction.quantity = '2';
    await expect(
      service.command('clerk', row.id, input),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row.status).toBe('READY_FOR_DISPATCH');
    expect(row.version).toBe(7);
    expect(row.repairWorkflow).not.toHaveProperty('outboundShipment');
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
    expect(prisma.mailroomAction.create).not.toHaveBeenCalled();
    expect(prisma.mailroomDelivery.createMany).not.toHaveBeenCalled();
  });
  it('HTTP DTO accepts dispatch logistics but rejects forged timestamp and overlength tracking', async () => {
    const { input } = fixture();
    const pipe = mainValidationPipe();
    const metadata = { type: 'body' as const, metatype: MailroomCommandDto };
    await expect(pipe.transform(input, metadata)).resolves.toMatchObject({
      action: 'dispatch',
      carrier: input.carrier,
    });
    await expect(
      pipe.transform({ ...input, dispatchedAt: 'forged' }, metadata),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ ...input, trackingNumber: 'x'.repeat(101) }, metadata),
    ).rejects.toThrow();
  });
});

describe('production-pipe HTTP physical confirmation', () => {
  const originalEnabled = process.env.MAILROOM_ENABLED;
  let current: ReturnType<typeof fixture>;
  let app: INestApplication;
  let command: jest.SpyInstance;
  beforeEach(async () => {
    process.env.MAILROOM_ENABLED = 'true';
    current = fixture();
    current.sync.deliverPending.mockResolvedValue(undefined);
    command = jest.spyOn(current.service, 'command');
    const module = await Test.createTestingModule({
      controllers: [MailroomController],
      providers: [
        { provide: MailroomService, useValue: current.service },
        { provide: MailroomIntakeService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    // Authentication is synthetic; the real controller, DTO, pipe and service run.
    app.use(
      (req: { user?: { id: string } }, _res: unknown, next: () => void) => {
        req.user = { id: 'clerk' };
        next();
      },
    );
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(mainValidationPipe());
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    if (originalEnabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = originalEnabled;
  });

  it.each([
    ['boolean true', true],
    ['boolean false', false],
    ['string false', 'false'],
    ['string true', 'true'],
    ['number zero', 0],
    ['number one', 1],
    ['null', null],
    ['omitted', undefined],
    ['array', [true]],
    ['object', { confirmed: true }],
  ])('dispatch accepts only explicit true: %s', async (_label, value) => {
    const body: Record<string, unknown> = {
      ...current.input,
      expectedVersion: '7',
    };
    delete body.confirmedItems;
    if (value !== undefined) body.confirmedItems = value;
    const response = await request(app.getHttpServer())
      .post('/api/v1/mailroom/items/piece/actions')
      .send(body);

    if (value === true) {
      expect(response.status).toBe(201);
      expect(current.row.status).toBe('DISPATCHED');
      expect(current.actions).toHaveLength(1);
      expect(command).toHaveBeenCalledWith(
        'clerk',
        'piece',
        expect.objectContaining({ confirmedItems: true, expectedVersion: 7 }),
      );
    } else {
      expect(response.status).toBe(400);
      expect(current.row.status).toBe('READY_FOR_DISPATCH');
      expect(current.row.version).toBe(7);
      expect(current.actions).toHaveLength(0);
      expect(current.prisma.mailroomItem.update).not.toHaveBeenCalled();
      expect(current.prisma.mailroomAction.create).not.toHaveBeenCalled();
      expect(current.prisma.mailroomDelivery.createMany).not.toHaveBeenCalled();
      if (typeof value !== 'boolean' && value != null) {
        expect(command).not.toHaveBeenCalled();
        expect(response.body.message).toContain(
          'confirmedItems must be a boolean value',
        );
      } else {
        expect(command).toHaveBeenCalledWith(
          'clerk',
          'piece',
          expect.objectContaining({ expectedVersion: 7 }),
        );
        expect(command.mock.calls[0][2].confirmedItems).toBe(value);
      }
    }
    expect(current.gateway.sendToUser).not.toHaveBeenCalled();
    expect(current.sync.cases).not.toHaveBeenCalled();
    expect(current.sync.deliverPending).not.toHaveBeenCalled();
  });

  it.each([
    ['accept', true, 'COLLECTED'],
    ['accept', false, 'WAITING_PICKUP'],
    ['accept_return', true, 'READY_FOR_DISPATCH'],
    ['accept_return', false, 'WAITING_RETURN_ACCEPTANCE'],
  ] as const)(
    '%s keeps valid boolean %s unchanged',
    async (action, confirmedItems, expectedStatus) => {
      current.row.status =
        action === 'accept' ? 'WAITING_PICKUP' : 'WAITING_RETURN_ACCEPTANCE';
      current.row.nextUserId = 'clerk';
      if (action === 'accept') {
        current.row.recipientId = 'clerk';
        current.row.receipt.category = 'PARCEL';
        current.row.receipt.sourceCaseId = null;
      }
      const response = await request(app.getHttpServer())
        .post('/api/v1/mailroom/items/piece/actions')
        .send({
          entityId: 'company',
          requestId: 'acceptance-001',
          expectedVersion: '7',
          action,
          confirmedItems,
          location: '本人核對位置',
        });
      expect(response.status).toBe(confirmedItems ? 201 : 400);
      expect(current.row.status).toBe(expectedStatus);
      expect(command).toHaveBeenCalledWith(
        'clerk',
        'piece',
        expect.objectContaining({ confirmedItems, expectedVersion: 7 }),
      );
      expect(current.prisma.mailroomItem.update).toHaveBeenCalledTimes(
        confirmedItems ? 1 : 0,
      );
      if (confirmedItems) {
        expect(current.row.location).toBe('本人核對位置');
        expect(current.row.custodianId).toBe('clerk');
      }
    },
  );
});
