import { PrismaService } from '../../common/prisma/prisma.service';
import { signRequest } from './mailroom.contract';
import { MailroomSyncService } from './mailroom-sync.service';
import {
  repairProposalHash,
  type RepairProposalEvent,
} from './repair-proposal.contract';
import {
  DISPATCH_SCHEMA,
  REPAIR_PROPOSAL_SCHEMA,
  MailroomDispatchEvent,
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
});

describe('Mailroom dispatch delivery acknowledgment', () => {
  const entityId = 'doa-dev-qa-20261002';
  const eventId = '83362099-c6d6-4831-9d06-0b539ea9ad37';
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
