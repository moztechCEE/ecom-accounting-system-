import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { signRequest } from './mailroom.contract';
import { MailroomSyncService } from './mailroom-sync.service';
import {
  exchangeReadyHash,
  type ExchangeReadyEvent,
} from './mailroom-exchange-ready.contract';
import {
  repairProposalHash,
  type RepairProposalEvent,
} from './repair-proposal.contract';
import {
  DISPATCH_SCHEMA,
  REPAIR_PROPOSAL_SCHEMA,
  MailroomDispatchEvent,
  assertMailroomDeliveryAck,
} from './mailroom-workflow-event.contract';

describe('Mailroom source search URL signatures', () => {
  const entry = {
    entityId: 'test-entity',
    target: 'AFTER_SALES',
    baseUrl: 'https://after-sales.example.invalid',
    keyId: 'test-key',
    secret: 'test-only-secret-with-at-least-32-characters',
  };
  let originalConnections: string | undefined;
  let fetchMock: jest.SpyInstance;
  let service: MailroomSyncService;

  beforeEach(() => {
    originalConnections = process.env.MAILROOM_CONNECTIONS;
    process.env.MAILROOM_CONNECTIONS = JSON.stringify([entry]);
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ items: [], nextCursor: null }),
    } as Response);
    service = new MailroomSyncService({} as PrismaService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
    if (originalConnections === undefined)
      delete process.env.MAILROOM_CONNECTIONS;
    else process.env.MAILROOM_CONNECTIONS = originalConnections;
  });

  function capturedRequest() {
    const [input, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const received = new URL(input.toString());
    // Reproduce the query normalization observed at the Next.js receiver.
    received.search = received.searchParams.toString();
    const headers = options.headers as Record<string, string>;
    expect(headers['x-mailroom-signature']).toBe(
      signRequest(
        entry.secret,
        'GET',
        received.pathname + received.search,
        headers['x-mailroom-time'],
        '',
        entry.entityId,
      ),
    );
    return received;
  }

  it.each(['T', ' t ', 'DEV 測試', "T +&! '()~"])(
    'preserves search text and its signature for %s',
    async (search) => {
      await service.cases(entry.entityId, search);
      expect(capturedRequest().searchParams.get('search')).toBe(search);
    },
  );

  it('preserves the awaiting filter and ordinary continuation cursor', async () => {
    await service.cases(entry.entityId, 'DEV 測試', undefined, {
      awaiting: true,
      cursor: 'case-previous',
    });
    expect(Array.from(capturedRequest().searchParams.entries())).toEqual([
      ['search', 'DEV 測試'],
      ['awaiting', 'true'],
      ['cursor', 'case-previous'],
    ]);
  });

  it('keeps direct case lookup independent of search and cursor', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          item: {
            id: 'case-1',
            number: 'R-1',
            type: 'REPAIR',
            version: '2026-10-05T00:00:00Z',
            items: [],
          },
        }),
    } as Response);
    await service.cases(entry.entityId, 'ignored', 'case-1', {
      cursor: 'ignored',
    });
    const received = capturedRequest();
    expect(received.pathname).toBe('/api/integration/mailroom/cases/case-1');
    expect(received.search).toBe('');
  });

  it('signs an exact GET changes path with a decimal bigint cursor, and validates before advancing it', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          events: [],
          nextCursor: '9007199254740995',
          hasMore: false,
        }),
    } as Response);
    const result = await service.changes(entry.entityId, '9007199254740995');
    expect(result.nextCursor).toBe('9007199254740995');
    const received = capturedRequest();
    expect(received.pathname).toBe('/api/integration/mailroom/changes');
    expect([...received.searchParams.entries()]).toEqual([
      ['cursor', '9007199254740995'],
      ['limit', '100'],
    ]);
    await expect(service.changes(entry.entityId, '1e20')).rejects.toThrow(
      '游標',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('signs the new outbound orders search and cursor path without changing the receipt endpoint', async () => {
    await service.outboundOrders(
      entry.entityId,
      "T +&! '()~",
      undefined,
      'case-before',
    );
    const received = capturedRequest();
    expect(received.pathname).toBe('/api/integration/mailroom/outbound-orders');
    expect([...received.searchParams.entries()]).toEqual([
      ['search', "T +&! '()~"],
      ['cursor', 'case-before'],
    ]);
  });

  it('pins outbound case lookup to the Source case ID and rejects an untrusted or oversized query before transport', async () => {
    await service.outboundOrders(entry.entityId, '', 'case-a');
    expect([...capturedRequest().searchParams.entries()]).toEqual([
      ['search', ''],
      ['caseId', 'case-a'],
    ]);
    for (const args of [
      [entry.entityId, 'x'.repeat(121)],
      [entry.entityId, '', '../case'],
      [entry.entityId, '', 'case-a', 'cursor'],
      [entry.entityId, '', undefined, '../cursor'],
    ] as const) {
      await expect(service.outboundOrders(...args)).rejects.toThrow('查詢格式');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a cursor that fails to progress and never returns malformed Source data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({ items: [], nextCursor: 'case-before' }),
    } as Response);
    await expect(
      service.outboundOrders(entry.entityId, '', undefined, 'case-before'),
    ).rejects.toThrow('游標未前進');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({ items: [], nextCursor: null, clientSnapshot: {} }),
    } as Response);
    await expect(service.outboundOrders(entry.entityId)).rejects.toThrow(
      '資料格式',
    );
  });

  it.each([
    ['network', new TypeError('fetch failed: PRIVATE network configuration')],
    ['timeout', new DOMException('PRIVATE request expired', 'TimeoutError')],
    [
      'redirect',
      new TypeError('unexpected redirect: PRIVATE login or customer data'),
    ],
  ])(
    'returns a readable 503 on GET outbound transport failure without retry, request body or DB writes: %s',
    async (_kind, failure) => {
      const query = jest.fn();
      const transaction = jest.fn();
      const update = jest.fn();
      service = new MailroomSyncService({
        $queryRaw: query,
        $transaction: transaction,
        mailroomDelivery: { updateMany: update },
      } as unknown as PrismaService);
      fetchMock.mockRejectedValueOnce(failure);
      const error = await service
        .outboundOrders(entry.entityId, 'SYNTHETIC', 'case-a')
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        statusCode: 503,
        message: '售後寄件來源暫時無法連線，請稍後重新整理',
        error: 'Service Unavailable',
      });
      expect(JSON.stringify(error)).not.toContain('PRIVATE');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
      expect(options.method).toBe('GET');
      expect(options.redirect).toBe('error');
      expect(options.body).toBeUndefined();
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(capturedRequest().pathname).toBe(
        '/api/integration/mailroom/outbound-orders',
      );
      expect(query).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      ok: false,
      status: 401,
      text: jest.fn(() => Promise.resolve('PRIVATE upstream body')),
    },
    { ok: true, text: () => Promise.resolve('PRIVATE malformed JSON') },
    {
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            items: [],
            nextCursor: null,
            untrustedSnapshot: {},
          }),
        ),
    },
  ])(
    'keeps upstream status and JSON/contract validation failures as 502 instead of reporting availability',
    async (response) => {
      fetchMock.mockResolvedValueOnce(response as unknown as Response);
      const error = await service
        .outboundOrders(entry.entityId)
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as BadGatewayException).getStatus()).toBe(502);
      expect(JSON.stringify(error)).not.toContain('PRIVATE');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      if (!response.ok) expect(response.text).not.toHaveBeenCalled();
    },
  );
});

describe('Mailroom dispatch delivery acknowledgment', () => {
  const entityId = 'doa-dev-qa-20261002';
  const eventId = '83362099-c6d6-4831-9d06-0b539ea9ad37';
  function readyFixture(): ExchangeReadyEvent {
    const event: ExchangeReadyEvent = {
      schema: REPAIR_PROPOSAL_SCHEMA,
      kind: 'EXCHANGE_READY',
      eventId,
      entityId,
      sourceCaseId: 'case-exchange',
      sourceNumber: 'SYNTHETIC-EXCHANGE',
      sourceVersion: '2026-10-13T04:00:00.000Z',
      itemId: 'aaad7cc6-7273-4000-8abc-333333333333',
      receiptId: 'aaad7cc6-7273-4000-8abc-444444444444',
      version: 3,
      occurredAt: '2026-10-13T04:01:00.000Z',
      actor: { id: 'clerk', name: 'SYNTHETIC Clerk' },
      replacementRelease: {
        schema: 'corely.mailroom.exchange-ready.v1',
        orderId: 'aaad7cc6-7273-4000-8abc-444444444444',
        itemId: 'aaad7cc6-7273-4000-8abc-333333333333',
        sourceCaseItemId: 'source-line',
        prepareRequestId: 'aaad7cc6-7273-4000-8abc-555555555555',
        generation: 3,
        readyAt: '2026-10-13T04:01:00.000Z',
        productName: 'SYNTHETIC Catalog Product',
        sku: 'EXCHANGE-SKU',
        serialNumber: 'EXCHANGE-SN',
        quantity: 1,
        stock: {
          postingId: 'synthetic-out-1',
          referenceType: 'AFTER_SALES_OUTBOUND',
          referenceId: 'aaad7cc6-7273-4000-8abc-444444444444',
          productId: 'synthetic-product',
          warehouseId: 'synthetic-warehouse',
          externalInventoryPosted: false,
        },
        readyHash: '',
      },
    };
    event.replacementRelease.readyHash = exchangeReadyHash(event);
    return event;
  }
  // Full supplier F19 fixture, with this suite's QA company/event identities rehashed.
  function proposalFixture(): RepairProposalEvent {
    const proposal: RepairProposalEvent = {
      schema: REPAIR_PROPOSAL_SCHEMA,
      kind: 'REPAIR_PROPOSAL',
      eventId,
      entityId,
      sourceCaseId: 'same-case',
      sourceNumber: 'CASE-001',
      itemId: 'aaad7cc6-7273-4000-8abc-333333333333',
      receiptId: 'aaad7cc6-7273-4000-8abc-444444444444',
      version: 9,
      occurredAt: '2026-10-13T04:01:00.000Z',
      actor: { id: 'technician', name: '維修師' },
      proposal: {
        inspectionDocumentId: 'INS-REPAIR-001',
        inspectionRevision: 3,
        planVersion: 3,
        planHash:
          '7f8471f0683ca2ef5e2d6039a17c9245e512782adfabf4700312731912b5d328',
        original: {
          productId: 'erp-product',
          sourceItemId: 'source-line',
          label: 'REPAIR-001',
          productName: '合成測試產品',
          sku: 'ORIGINAL-SKU',
          serialNumber: 'ORIGINAL-SN',
          quantity: 1,
        },
        plan: 'REPAIR',
        planNote: '更換電源模組後複驗',
        replacementSku: null,
        replacementCondition: null,
        isUnderWarranty: null,
        isAccidentalDamage: null,
        feeMode: 'PAID',
        amount: 500.01,
        currency: 'TWD',
        estimateNote: '電源模組與工資',
        summary: '電源模組故障',
        customerVisibleSummary: '',
        proposalHash: '',
      },
    };
    proposal.proposal.proposalHash = repairProposalHash(proposal);
    return proposal;
  }
  const payload: MailroomDispatchEvent = {
    schema: DISPATCH_SCHEMA,
    eventId,
    entityId,
    sourceCaseId: 'case-a',
    sourceNumber: 'SYNTHETIC-A',
    sourceVersion: '2026-10-13T01:00:00.000Z',
    itemId: 'c2ea3b22-0a95-47da-b4e3-38cfc33b5873',
    receiptId: 'dba55c14-ab03-4579-bf54-cadbf6244e80',
    version: 1,
    action: 'dispatch',
    occurredAt: '2026-10-13T01:00:00.000Z',
    actor: { id: 'staff-a', name: 'SYNTHETIC Clerk' },
    shipment: {
      purpose: 'RESHIPMENT',
      carrier: 'SYNTHETIC',
      trackingNumber: 'SYNTHETIC-T-1',
      shippedAt: '2026-10-13T01:00:00.000Z',
      declaredItemId: 'line-a',
      quantity: 1,
      productName: 'SYNTHETIC Product',
      sku: null,
      serialNumber: null,
      originalSerialNumber: null,
    },
  };
  const settings = {
    ERP_DEV_SANDBOX: 'true',
    RUNTIME_SCHEDULES_ENABLED: 'false',
    MAILROOM_ENABLED: 'true',
    MAILROOM_SYNC_ENABLED: 'true',
    MAILROOM_SOURCE_SYNC_ENABLED: 'false',
    ERP_DEV_MAILROOM_EVENTS_ENABLED: 'true',
    ERP_DEV_MAILROOM_SOURCE_ENABLED: 'true',
    ERP_DEV_MAILROOM_SOURCE_URL:
      'https://moztech-after-sales-dev-sp5g377smq-de.a.run.app',
    MAILROOM_CONNECTIONS: JSON.stringify([
      {
        entityId,
        target: 'AFTER_SALES',
        baseUrl: 'https://after-sales.example.invalid',
        keyId: 'test-key',
        secret: 'test-only-secret-with-at-least-32-characters',
      },
    ]),
  };
  let previous: Record<string, string | undefined>;
  let fetchMock: jest.SpyInstance;
  let query: jest.Mock;
  let update: jest.Mock;
  let service: MailroomSyncService;
  beforeEach(() => {
    previous = Object.fromEntries(
      Object.keys(settings).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, settings);
    query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'delivery-a',
          entity_id: entityId,
          target: 'AFTER_SALES',
          payload,
          attempts: 1,
        },
      ])
      .mockResolvedValue([]);
    update = jest.fn().mockResolvedValue({ count: 1 });
    service = new MailroomSyncService({
      $queryRaw: query,
      mailroomDelivery: { updateMany: update },
    } as unknown as PrismaService);
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          accepted: true,
          eventId,
          applied: true,
          sourceCaseId: 'case-a',
          shipmentId: 'source-shipment-a',
        }),
    } as Response);
  });
  afterEach(() => {
    fetchMock.mockRestore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it('uses the existing event route and marks DELIVERED only after exact applied dispatch acknowledgment', async () => {
    await service.deliverPending();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELIVERED' }),
      }),
    );
    const [input, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const url = new URL(input.toString());
    expect(url.pathname).toBe('/api/integration/mailroom/events');
    expect(JSON.parse(options.body as string)).toEqual(payload);
    // The existing DEV lease query stays restricted to QA AFTER_SALES, never AI delivery.
    expect(query.mock.calls[0][0].values).toEqual(
      expect.arrayContaining([entityId, 'AFTER_SALES']),
    );
  });
  it('keeps an unknown POST transport failure pending with the original delivery retry contract', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('PRIVATE unknown POST'));
    await service.deliverPending();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual(payload);
    expect(update).toHaveBeenCalledTimes(1);
    const [{ data }] = update.mock.calls[0] as [
      {
        data: {
          status: string;
          lastError: string;
          nextAttemptAt: Date;
          leaseUntil: null;
          leaseToken: null;
          deliveredAt?: Date;
        };
      },
    ];
    expect(data.status).toBe('PENDING');
    expect(data.lastError).toBe('傳送或回執失敗，等待重試');
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
    expect(data.leaseUntil).toBeNull();
    expect(data.leaseToken).toBeNull();
    expect(data.deliveredAt).toBeUndefined();
    expect(JSON.stringify(update.mock.calls)).not.toContain('PRIVATE');
  });
  it.each([
    { accepted: true, eventId },
    {
      accepted: true,
      eventId,
      applied: false,
      sourceCaseId: 'case-a',
      shipmentId: 'shipment-a',
    },
    {
      accepted: true,
      eventId,
      applied: true,
      sourceCaseId: 'case-other',
      shipmentId: 'shipment-a',
    },
    {
      accepted: true,
      eventId,
      applied: true,
      sourceCaseId: 'case-a',
      shipmentId: '',
    },
  ])(
    'retains PENDING on a receipt-only or mismatched dispatch ACK instead of claiming Source application',
    async (ack) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(ack),
      } as Response);
      await service.deliverPending();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
      expect(
        update.mock.calls.some(([input]) => input.data.status === 'DELIVERED'),
      ).toBe(false);
    },
  );
  it('retains the legacy progress-event ACK behavior', async () => {
    query
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 'delivery-a',
          entity_id: entityId,
          target: 'AFTER_SALES',
          payload: { schema: 'corely.mailroom.v1', eventId },
          attempts: 1,
        },
      ])
      .mockResolvedValue([]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ accepted: true, eventId }),
    } as Response);
    await service.deliverPending();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELIVERED' }),
      }),
    );
  });
  it('does not contact Source for an invalid new dispatch payload', async () => {
    query
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 'delivery-a',
          entity_id: entityId,
          target: 'AFTER_SALES',
          payload: {
            ...payload,
            shipment: { ...payload.shipment, quantity: 2 },
          },
          attempts: 1,
        },
      ])
      .mockResolvedValue([]);
    await service.deliverPending();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });
  it('routes repair proposals to the exact separate workflow endpoint and applies the hash ACK', async () => {
    const proposal = proposalFixture(),
      proposalHash = proposal.proposal.proposalHash;
    const connections = JSON.parse(process.env.MAILROOM_CONNECTIONS!);
    connections[0].eventsPath = '/custom/progress-events';
    process.env.MAILROOM_CONNECTIONS = JSON.stringify(connections);
    query
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 'delivery-a',
          entity_id: entityId,
          target: 'AFTER_SALES',
          payload: proposal,
          attempts: 1,
        },
      ])
      .mockResolvedValue([]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          accepted: true,
          eventId,
          acceptedProposalHash: proposalHash,
        }),
    } as Response);
    await service.deliverPending();
    const [input, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const url = new URL(input.toString());
    expect(url.pathname).toBe('/api/integration/mailroom/workflow-events');
    expect(JSON.parse(options.body as string)).toEqual(proposal);
    const headers = options.headers as Record<string, string>;
    expect(headers['x-mailroom-signature']).toBe(
      signRequest(
        connections[0].secret,
        'POST',
        url.pathname,
        headers['x-mailroom-time'],
        options.body as string,
        entityId,
      ),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELIVERED' }),
      }),
    );
  });
  it.each([undefined, 'b'.repeat(64)])(
    'retains a proposal PENDING on missing or mismatched hash %p',
    async (acceptedProposalHash) => {
      const proposal = proposalFixture();
      query
        .mockReset()
        .mockResolvedValueOnce([
          {
            id: 'delivery-a',
            entity_id: entityId,
            target: 'AFTER_SALES',
            payload: proposal,
            attempts: 1,
          },
        ])
        .mockResolvedValue([]);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ accepted: true, eventId, acceptedProposalHash }),
      } as Response);
      await service.deliverPending();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
      expect(
        update.mock.calls.some(([input]) => input.data.status === 'DELIVERED'),
      ).toBe(false);
    },
  );
  function useReady(event: unknown, target = 'AFTER_SALES') {
    query
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 'delivery-ready',
          entity_id: entityId,
          target,
          payload: event,
          attempts: 1,
        },
      ])
      .mockResolvedValue([]);
  }
  function deliveryWrites() {
    return update.mock.calls.map(
      ([input]) => (input as { data: Record<string, unknown> }).data,
    );
  }
  function expectReadyPending() {
    const writes = deliveryWrites();
    expect(writes.some((data) => data.status === 'PENDING')).toBe(true);
    expect(writes.some((data) => data.status === 'DELIVERED')).toBe(false);
    // Retrying delivery changes its lease only, never its immutable physical proof.
    expect(writes.every((data) => !('payload' in data))).toBe(true);
  }
  it('signs EXCHANGE_READY on the workflow route and accepts only its case-bound ready hash without requiring applied', async () => {
    const event = readyFixture();
    const ack = {
      accepted: true,
      eventId,
      sourceCaseId: event.sourceCaseId,
      acceptedReadyHash: event.replacementRelease.readyHash,
    };
    expect(assertMailroomDeliveryAck(event, ack)).toBeNull();
    const connections = JSON.parse(process.env.MAILROOM_CONNECTIONS!) as Array<{
      secret: string;
      eventsPath?: string;
    }>;
    connections[0].eventsPath = '/custom/progress-events';
    process.env.MAILROOM_CONNECTIONS = JSON.stringify(connections);
    useReady(event);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(ack)),
    } as Response);
    await service.deliverPending();
    const [input, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const url = new URL(input.toString());
    expect(url.pathname).toBe('/api/integration/mailroom/workflow-events');
    expect(JSON.parse(options.body as string)).toEqual(event);
    const headers = options.headers as Record<string, string>;
    expect(headers['x-mailroom-signature']).toBe(
      signRequest(
        connections[0].secret,
        'POST',
        url.pathname,
        headers['x-mailroom-time'],
        options.body as string,
        entityId,
      ),
    );
    expect(deliveryWrites().some((data) => data.status === 'DELIVERED')).toBe(
      true,
    );
  });
  it.each([
    'receipt-only',
    'proposal-hash',
    'missing-hash',
    'wrong-hash',
    'wrong-case',
    'wrong-event',
    'false-accepted',
  ] as const)(
    'keeps immutable EXCHANGE_READY PENDING for %s ACK',
    async (change) => {
      const event = readyFixture();
      const ack: Record<string, unknown> = {
        accepted: true,
        eventId,
        sourceCaseId: event.sourceCaseId,
        acceptedReadyHash: event.replacementRelease.readyHash,
      };
      if (change === 'receipt-only') {
        delete ack.sourceCaseId;
        delete ack.acceptedReadyHash;
      } else if (change === 'proposal-hash') {
        delete ack.acceptedReadyHash;
        ack.acceptedProposalHash = event.replacementRelease.readyHash;
      } else if (change === 'missing-hash') delete ack.acceptedReadyHash;
      else if (change === 'wrong-hash') ack.acceptedReadyHash = 'b'.repeat(64);
      else if (change === 'wrong-case') ack.sourceCaseId = 'case-other';
      else if (change === 'wrong-event')
        ack.eventId = 'aaad7cc6-7273-4000-8abc-666666666666';
      else ack.accepted = false;
      expect(() => assertMailroomDeliveryAck(event, ack)).toThrow();
      useReady(event);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(ack)),
      } as Response);
      await service.deliverPending();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expectReadyPending();
    },
  );
  it.each([
    'digest',
    'stock-reference',
    'unit-alias',
    'quantity',
    'AI-target',
    'company-scope',
  ] as const)(
    'blocks EXCHANGE_READY %s before any transport',
    async (change) => {
      const event = readyFixture();
      if (change === 'digest')
        event.replacementRelease.readyHash = 'b'.repeat(64);
      else if (change === 'stock-reference')
        event.replacementRelease.stock.referenceId =
          'aaad7cc6-7273-4000-8abc-666666666666';
      else if (change === 'unit-alias')
        event.replacementRelease.itemId =
          'aaad7cc6-7273-4000-8abc-666666666666';
      else if (change === 'quantity')
        Object.assign(event.replacementRelease, { quantity: 2 });
      else if (change === 'company-scope') event.entityId = 'another-company';
      // Even a newly rehashed shape may not change the stock order, unit alias or quantity.
      if (change !== 'digest')
        event.replacementRelease.readyHash = exchangeReadyHash(event);
      useReady(
        event,
        change === 'AI-target' ? 'AI_CUSTOMER_SERVICE' : 'AFTER_SALES',
      );
      await service.deliverPending();
      expect(fetchMock).not.toHaveBeenCalled();
      expectReadyPending();
    },
  );
  it.each(['digest', 'extra-source-version'] as const)(
    'rejects malformed full repair proposal %s before contacting Source',
    async (change) => {
      const proposal: Record<string, any> = proposalFixture();
      if (change === 'digest') proposal.proposal.proposalHash = 'a'.repeat(64);
      else proposal.sourceVersion = '2026-10-13T04:00:00.000Z';
      query
        .mockReset()
        .mockResolvedValueOnce([
          {
            id: 'delivery-a',
            entity_id: entityId,
            target: 'AFTER_SALES',
            payload: proposal,
            attempts: 1,
          },
        ])
        .mockResolvedValue([]);
      await service.deliverPending();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
      expect(
        update.mock.calls.some(([input]) => input.data.status === 'DELIVERED'),
      ).toBe(false);
    },
  );
  it.each(['corely.mailroom.v1', DISPATCH_SCHEMA])(
    'keeps the configured event path for %s',
    async (schema) => {
      const connections = JSON.parse(process.env.MAILROOM_CONNECTIONS!);
      connections[0].eventsPath = '/custom/progress-events';
      process.env.MAILROOM_CONNECTIONS = JSON.stringify(connections);
      query
        .mockReset()
        .mockResolvedValueOnce([
          {
            id: 'delivery-a',
            entity_id: entityId,
            target: 'AFTER_SALES',
            payload: schema === DISPATCH_SCHEMA ? payload : { schema, eventId },
            attempts: 1,
          },
        ])
        .mockResolvedValue([]);
      await service.deliverPending();
      expect(new URL(fetchMock.mock.calls[0][0].toString()).pathname).toBe(
        '/custom/progress-events',
      );
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    },
  );
});
