/* Synthetic snapshots only; the service separately proves stock.verify's transaction provenance. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import {
  buildExchangeReadyEvent,
  exchangeReadyHash,
  validateExchangeReadyEvent,
} from './mailroom-exchange-ready.contract';

const UNIT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EVENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GOLDEN =
  'abce5a39c47c5d2e2dea42782351def6d2f2f94ec7fc3a4f694da6458d158e29';

function fixture() {
  const source: any = {
    id: 'case-exchange',
    number: 'CASE-EX-001',
    type: 'EXCHANGE_RETURN',
    version: '2026-10-13T10:00:00.000Z',
    sourceChannel: 'synthetic',
    brand: 'Unverified client label',
    customerLabel: 'synthetic customer',
    dispatchAllowed: true,
    blockReason: null,
    items: [
      {
        id: 'source-line',
        name: '申報品項別名',
        sku: 'REPLACE-SKU',
        quantity: 2,
        dispatchedQuantity: 0,
        dispatchedUnitIds: [],
      },
    ],
    recipient: { name: 'synthetic', phone: 'synthetic', address: 'synthetic' },
  };
  const order: any = {
    id: ORDER,
    entityId: 'company',
    sourceCaseId: source.id,
    sourceNumber: source.number,
    sourceVersion: source.version,
    caseType: 'EXCHANGE_RETURN',
    status: 'READY_FOR_DISPATCH',
    version: 3,
    stockRequestId: REQUEST,
    preparedById: 'warehouse',
    custodianId: 'clerk',
  };
  const unit: any = {
    unitId: UNIT,
    sourceCaseItemId: 'source-line',
    productName: '申報品項別名',
    sku: 'REPLACE-SKU',
    quantity: 1,
    productId: 'product-1',
    warehouseId: 'warehouse-1',
    serialNumber: 'NEW-SN',
    postingId: 'OUT-1',
    referenceType: 'AFTER_SALES_OUTBOUND',
    externalInventoryPosted: false,
  };
  const proof: any = {
    ...unit,
    schema: 'corely.mailroom.outbound-stock.v1',
    actorId: 'warehouse',
    entityId: 'company',
    orderId: ORDER,
    requestId: REQUEST,
    sourceCaseId: source.id,
    caseType: 'EXCHANGE_RETURN',
    requestHash: 'a'.repeat(64),
  };
  const product: any = {
    id: 'product-1',
    entityId: 'company',
    name: '正式商品名稱',
    sku: 'REPLACE-SKU',
    isActive: true,
  };
  const actor: any = {
    id: 'clerk',
    name: '收發同仁',
    entityIds: ['company'],
    permissions: new Set(['mailroom:update']),
  };
  return {
    eventId: EVENT,
    occurredAt: '2026-10-14T00:00:00.000Z',
    actor,
    source,
    order,
    unit,
    proof,
    product,
  };
}

describe('authoritative exchange-ready event builder', () => {
  it('binds an accepted exchange unit to the same formal OUT and real catalog title', () => {
    const f = fixture();
    const event = buildExchangeReadyEvent(f);
    expect(event).toEqual({
      schema: 'corely.aftersales.workflow.v1',
      kind: 'EXCHANGE_READY',
      eventId: EVENT,
      entityId: 'company',
      sourceCaseId: 'case-exchange',
      sourceNumber: 'CASE-EX-001',
      sourceVersion: f.source.version,
      itemId: UNIT,
      receiptId: ORDER,
      version: 3,
      occurredAt: f.occurredAt,
      actor: { id: 'clerk', name: '收發同仁' },
      replacementRelease: {
        schema: 'corely.mailroom.exchange-ready.v1',
        orderId: ORDER,
        itemId: UNIT,
        sourceCaseItemId: 'source-line',
        prepareRequestId: REQUEST,
        generation: 3,
        readyAt: f.occurredAt,
        productName: '正式商品名稱',
        sku: 'REPLACE-SKU',
        serialNumber: 'NEW-SN',
        quantity: 1,
        stock: {
          postingId: 'OUT-1',
          referenceType: 'AFTER_SALES_OUTBOUND',
          referenceId: ORDER,
          productId: 'product-1',
          warehouseId: 'warehouse-1',
          externalInventoryPosted: false,
        },
        readyHash: GOLDEN,
      },
    });
    expect(event.replacementRelease.productName).not.toBe(
      f.source.items[0].name,
    );
    expect(event.replacementRelease).not.toHaveProperty('brand');
    expect(event.replacementRelease).not.toHaveProperty('condition');
    expect(event.replacementRelease.stock).not.toHaveProperty('reservationId');
    expect(validateExchangeReadyEvent(event)).toEqual(event);
  });

  it('preserves the actual catalog name without trimming or mutating inputs', () => {
    const f = fixture();
    f.product.name = ' 正式商品名稱 ';
    const snapshot = () =>
      JSON.stringify({
        ...f,
        actor: { ...f.actor, permissions: [...f.actor.permissions] },
      });
    const before = snapshot();
    expect(buildExchangeReadyEvent(f).replacementRelease.productName).toBe(
      ' 正式商品名稱 ',
    );
    expect(snapshot()).toBe(before);
  });

  it('allows a verified non-serial product with an explicit null wire SN', () => {
    const f = fixture();
    delete f.unit.serialNumber;
    f.proof.serialNumber = null;
    expect(
      buildExchangeReadyEvent(f).replacementRelease.serialNumber,
    ).toBeNull();
  });

  it('each unit keeps its own proof, event ID, and ready hash in a multi-piece generation', () => {
    const first = fixture(),
      second = fixture();
    second.unit.unitId = second.proof.unitId = OTHER;
    second.unit.postingId = second.proof.postingId = 'OUT-2';
    second.unit.serialNumber = second.proof.serialNumber = 'NEW-SN-2';
    second.eventId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const events = [
      buildExchangeReadyEvent(first),
      buildExchangeReadyEvent(second),
    ];
    expect(events.map((event) => event.replacementRelease.generation)).toEqual([
      3, 3,
    ]);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(2);
    expect(
      new Set(events.map((event) => event.replacementRelease.readyHash)).size,
    ).toBe(2);
  });

  it.each(['REPAIR', 'RESHIPMENT', 'PRIVATE_PURCHASE'])(
    'never selects EXCHANGE_READY for %s',
    (caseType) => {
      const f = fixture();
      f.source.type = f.order.caseType = f.proof.caseType = caseType;
      expectRejected(() => buildExchangeReadyEvent(f));
    },
  );

  it.each([
    'PENDING_PICK',
    'WAITING_MAILROOM_ACCEPTANCE',
    'WAITING_RETURN_ACCEPTANCE',
    'DISPATCHED',
    'CANCELLED',
  ])(
    'rejects status %s rather than treating it as accepted and ready',
    (status) => {
      const f = fixture();
      f.order.status = status;
      expectRejected(() => buildExchangeReadyEvent(f));
    },
  );

  it.each([
    [
      'unreleased Source',
      (f: any) => {
        f.source.dispatchAllowed = false;
      },
    ],
    [
      'Source blocker',
      (f: any) => {
        f.source.blockReason = 'not allowed';
      },
    ],
    [
      'Source case',
      (f: any) => {
        f.source.id = 'other-case';
      },
    ],
    [
      'Source number',
      (f: any) => {
        f.source.number = 'other-number';
      },
    ],
    [
      'Source version',
      (f: any) => {
        f.source.version = '2026-10-13T11:00:00.000Z';
      },
    ],
    [
      'Source line',
      (f: any) => {
        f.source.items[0].id = 'other-line';
      },
    ],
    [
      'Source SKU',
      (f: any) => {
        f.source.items[0].sku = 'other-sku';
      },
    ],
    [
      'Source name',
      (f: any) => {
        f.source.items[0].name = 'other-name';
      },
    ],
    [
      'Source quantity',
      (f: any) => {
        f.source.items[0].quantity = 0;
      },
    ],
    [
      'already dispatched line',
      (f: any) => {
        f.source.items[0].dispatchedQuantity = 2;
      },
    ],
    [
      'already dispatched unit',
      (f: any) => {
        f.source.items[0].dispatchedUnitIds = [UNIT];
      },
    ],
    [
      'malformed Source lines',
      (f: any) => {
        f.source.items = {};
      },
    ],
    [
      'foreign actor company',
      (f: any) => {
        f.actor.entityIds = ['other-company'];
      },
    ],
    [
      'read-only actor',
      (f: any) => {
        f.actor.permissions.clear();
      },
    ],
    [
      'custodian',
      (f: any) => {
        f.order.custodianId = 'other-clerk';
      },
    ],
    [
      'prepared actor',
      (f: any) => {
        f.order.preparedById = 'other-warehouse';
      },
    ],
    [
      'missing prepared actor',
      (f: any) => {
        f.order.preparedById = null;
      },
    ],
    [
      'prepare request',
      (f: any) => {
        f.order.stockRequestId = OTHER;
      },
    ],
    [
      'non-UUID prepare request',
      (f: any) => {
        f.order.stockRequestId = 'request';
      },
    ],
    [
      'missing catalog',
      (f: any) => {
        f.product = null;
      },
    ],
    [
      'empty catalog',
      (f: any) => {
        f.product = {};
      },
    ],
    [
      'catalog title',
      (f: any) => {
        f.product.name = '';
      },
    ],
    [
      'catalog product',
      (f: any) => {
        f.product.id = 'other-product';
      },
    ],
    [
      'catalog company',
      (f: any) => {
        f.product.entityId = 'other-company';
      },
    ],
    [
      'catalog SKU',
      (f: any) => {
        f.product.sku = 'other-sku';
      },
    ],
    [
      'inactive catalog',
      (f: any) => {
        f.product.isActive = false;
      },
    ],
    [
      'string catalog active',
      (f: any) => {
        f.product.isActive = 'true';
      },
    ],
    [
      'missing proof',
      (f: any) => {
        f.proof = undefined;
      },
    ],
  ])(
    'fails closed for %s without fallback or guessed data',
    (_name, change) => {
      const f = fixture();
      change(f);
      expectRejected(() => buildExchangeReadyEvent(f));
    },
  );

  it.each([
    ['schema', 'legacy-stock'],
    ['caseType', 'REPAIR'],
    ['entityId', 'other-company'],
    ['orderId', OTHER],
    ['sourceCaseId', 'other-case'],
    ['requestId', OTHER],
    ['actorId', 'other-warehouse'],
    ['requestHash', 'NOT-SHA'],
    ['unitId', OTHER],
    ['sourceCaseItemId', 'other-line'],
    ['productId', 'other-product'],
    ['warehouseId', 'other-warehouse'],
    ['sku', 'other-sku'],
    ['serialNumber', 'other-SN'],
    ['postingId', 'other-posting'],
    ['quantity', 2],
    ['referenceType', 'AFTER_SALES_REPLACEMENT'],
    ['externalInventoryPosted', true],
  ])('requires exact verified stock %s', (field, value) => {
    const f = fixture();
    f.proof[field] = value;
    expectRejected(() => buildExchangeReadyEvent(f));
  });
});

function expectRejected(action: () => unknown) {
  expect(action).toThrow();
}

describe('immutable exchange ready wire and hash', () => {
  it('ignores transport event ID and actor but retains all physical/source release fields', () => {
    const event = buildExchangeReadyEvent(fixture());
    event.eventId = OTHER;
    event.actor = { id: 'different-sender', name: '不同人員' };
    expect(exchangeReadyHash(event)).toBe(GOLDEN);
    expect(validateExchangeReadyEvent(event).replacementRelease.readyHash).toBe(
      GOLDEN,
    );
  });

  it.each([
    'entityId',
    'sourceCaseId',
    'sourceNumber',
    'sourceVersion',
    'itemId',
    'receiptId',
    'version',
    'occurredAt',
  ])('hashes envelope field %s', (field) => {
    const event: any = buildExchangeReadyEvent(fixture());
    event[field] = 'different';
    expect(exchangeReadyHash(event)).not.toBe(GOLDEN);
    expectRejected(() => validateExchangeReadyEvent(event));
  });

  it.each([
    'schema',
    'orderId',
    'itemId',
    'sourceCaseItemId',
    'prepareRequestId',
    'generation',
    'readyAt',
    'productName',
    'sku',
    'serialNumber',
    'quantity',
  ])('hashes release field %s', (field) => {
    const event: any = buildExchangeReadyEvent(fixture());
    event.replacementRelease[field] = 'different';
    expect(exchangeReadyHash(event)).not.toBe(GOLDEN);
    expectRejected(() => validateExchangeReadyEvent(event));
  });

  it.each([
    'postingId',
    'referenceType',
    'referenceId',
    'productId',
    'warehouseId',
    'externalInventoryPosted',
  ])('hashes stock field %s', (field) => {
    const event: any = buildExchangeReadyEvent(fixture());
    event.replacementRelease.stock[field] = 'different';
    expect(exchangeReadyHash(event)).not.toBe(GOLDEN);
    expectRejected(() => validateExchangeReadyEvent(event));
  });

  it.each([
    'schema',
    'kind',
    'eventId',
    'entityId',
    'sourceCaseId',
    'sourceNumber',
    'sourceVersion',
    'itemId',
    'receiptId',
    'version',
    'occurredAt',
    'actor',
    'replacementRelease',
  ])('requires envelope key %s', (key) => {
    const event: any = buildExchangeReadyEvent(fixture());
    delete event[key];
    expectRejected(() => validateExchangeReadyEvent(event));
  });

  it.each([
    [
      'wrong workflow kind',
      (event: any) => {
        event.kind = 'REPAIR_PROPOSAL';
      },
    ],
    [
      'non-UUID event',
      (event: any) => {
        event.eventId = 'event';
      },
    ],
    [
      'unsafe actor ID',
      (event: any) => {
        event.actor.id = '../actor';
      },
    ],
    [
      'extra actor fields',
      (event: any) => {
        event.actor.employeeId = 'employee';
      },
    ],
    [
      'extra envelope fields',
      (event: any) => {
        event.brand = 'MOZTECH';
      },
    ],
    [
      'extra condition fields',
      (event: any) => {
        event.replacementRelease.condition = 'NEW';
      },
    ],
    [
      'extra reservation fields',
      (event: any) => {
        event.replacementRelease.stock.reservationId = 'reservation';
      },
    ],
    [
      'missing release key',
      (event: any) => {
        delete event.replacementRelease.serialNumber;
      },
    ],
    [
      'missing stock key',
      (event: any) => {
        delete event.replacementRelease.stock.postingId;
      },
    ],
    [
      'non-UUID receipt',
      (event: any) => {
        event.receiptId = event.replacementRelease.orderId = 'order';
      },
    ],
    [
      'non-UUID unit',
      (event: any) => {
        event.itemId = event.replacementRelease.itemId = 'unit';
      },
    ],
    [
      'different receipt/order',
      (event: any) => {
        event.replacementRelease.orderId = OTHER;
      },
    ],
    [
      'different item/unit',
      (event: any) => {
        event.replacementRelease.itemId = OTHER;
      },
    ],
    [
      'non-UUID prepare request',
      (event: any) => {
        event.replacementRelease.prepareRequestId = 'request';
      },
    ],
    [
      'generation mismatch',
      (event: any) => {
        event.replacementRelease.generation = 4;
      },
    ],
    [
      'readyAt mismatch',
      (event: any) => {
        event.replacementRelease.readyAt = '2026-10-14T00:01:00.000Z';
      },
    ],
    [
      'invalid calendar',
      (event: any) => {
        event.occurredAt = event.replacementRelease.readyAt =
          '2026-02-31T00:00:00.000Z';
      },
    ],
    [
      'noncanonical Source date',
      (event: any) => {
        event.sourceVersion = '2026-10-13T10:00:00Z';
      },
    ],
    [
      'null SKU',
      (event: any) => {
        event.replacementRelease.sku = null;
      },
    ],
    [
      'empty serial',
      (event: any) => {
        event.replacementRelease.serialNumber = '';
      },
    ],
    [
      'quantity two',
      (event: any) => {
        event.replacementRelease.quantity = 2;
      },
    ],
    [
      'repair OUT',
      (event: any) => {
        event.replacementRelease.stock.referenceType =
          'AFTER_SALES_REPLACEMENT';
      },
    ],
    [
      'stock order mismatch',
      (event: any) => {
        event.replacementRelease.stock.referenceId = OTHER;
      },
    ],
    [
      'unsafe stock product ID',
      (event: any) => {
        event.replacementRelease.stock.productId = '../product';
      },
    ],
    [
      'external confirmed',
      (event: any) => {
        event.replacementRelease.stock.externalInventoryPosted = true;
      },
    ],
    [
      'string external false',
      (event: any) => {
        event.replacementRelease.stock.externalInventoryPosted = 'false';
      },
    ],
  ])(
    'rejects %s even if the caller recalculates a matching hash',
    (_name, change) => {
      const event: any = buildExchangeReadyEvent(fixture());
      change(event);
      event.replacementRelease.readyHash = exchangeReadyHash(event);
      expectRejected(() => validateExchangeReadyEvent(event));
    },
  );

  it('never hashes readyHash itself and rejects an incorrect or uppercase digest', () => {
    const event = buildExchangeReadyEvent(fixture());
    event.replacementRelease.readyHash = 'b'.repeat(64);
    expect(exchangeReadyHash(event)).toBe(GOLDEN);
    expectRejected(() => validateExchangeReadyEvent(event));
    event.replacementRelease.readyHash = GOLDEN.toUpperCase();
    expectRejected(() => validateExchangeReadyEvent(event));
  });

  it('returns a cloned immutable snapshot without mutating the event provided for validation', () => {
    const event = buildExchangeReadyEvent(fixture());
    const validated = validateExchangeReadyEvent(event);
    validated.replacementRelease.productName = 'local reader change';
    expect(event.replacementRelease.productName).toBe('正式商品名稱');
    expect(event.replacementRelease.readyHash).toBe(GOLDEN);
  });
});
