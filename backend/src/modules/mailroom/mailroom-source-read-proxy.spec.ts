import { MailroomSyncService } from './mailroom-sync.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { signRequest } from './mailroom.contract';

describe('Source media proxy validates readonly HMAC payloads and bounds binary response', () => {
  const entry = {
    entityId: 'fixture-company',
    target: 'AFTER_SALES',
    baseUrl: 'https://fixture-source.invalid',
    keyId: 'fixture-key',
    secret: 'fixture-test-secret-over-thirty-two-characters',
  };
  const photo = {
    id: 'photo',
    fileName: '產品.png',
    contentType: 'image/png',
    sizeBytes: 3000,
    createdAt: '2026-10-08T00:00:00Z',
    scope: 'CASE',
  };
  const sourceCase = {
    id: 'case',
    number: 'R-1',
    type: 'REPAIR',
    version: '2026-10-08T00:00:00Z',
    items: [],
    customerPhone: '0912345678',
    inTransit: true,
    reverseShipments: [
      {
        id: 'shipment',
        carrier: '示範',
        trackingNumber: 'TRACK',
        status: 'IN_TRANSIT',
        receivedAt: null,
        shippedAt: null,
      },
    ],
  };
  let original: string | undefined,
    fetchMock: jest.SpyInstance,
    service: MailroomSyncService;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  beforeEach(() => {
    original = process.env.MAILROOM_CONNECTIONS;
    process.env.MAILROOM_CONNECTIONS = JSON.stringify([entry]);
    fetchMock = jest.spyOn(global, 'fetch');
    service = new MailroomSyncService({} as PrismaService);
  });
  afterEach(() => {
    fetchMock.mockRestore();
    if (original === undefined) delete process.env.MAILROOM_CONNECTIONS;
    else process.env.MAILROOM_CONNECTIONS = original;
  });
  const json = (value: unknown) =>
    fetchMock.mockResolvedValueOnce(Response.json(value));
  const metadata = (change: Record<string, unknown> = {}) => ({
    caseId: 'case',
    scope: 'CASE',
    items: [photo],
    hasMore: false,
    ...change,
  });
  it('sends signed GET to configured origin, with no credentials or arbitrary image URL in query', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(png.length),
        },
      }),
    );
    const result = await service.caseAttachmentMedia(
      entry.entityId,
      'case',
      'photo',
    );
    expect(result.contents).toEqual(png);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe(entry.baseUrl);
    expect(url.pathname).toBe(
      '/api/integration/mailroom/cases/case/attachments/photo/media',
    );
    expect(url.search).toBe('');
    expect(init.redirect).toBe('error');
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-mailroom-entity']).toBe(entry.entityId);
    expect(headers['x-mailroom-signature']).toBe(
      signRequest(
        entry.secret,
        'GET',
        url.pathname,
        headers['x-mailroom-time'],
        '',
        entry.entityId,
      ),
    );
  });
  it.each(['../case', 'case/path', 'case%2fpath', 'https://evil.invalid'])(
    'invalid selected IDs %s never call upstream',
    async (id) => {
      await expect(
        service.caseAttachmentMedia(entry.entityId, id, 'photo'),
      ).rejects.toThrow('識別碼');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('unconfigured company has no fallback connection', async () => {
    await expect(
      service.caseAttachments('other-company', 'case'),
    ).rejects.toThrow('尚未設定');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('metadata keeps CASE attribution and strips any private file URL or unsolicited secrets', async () => {
    json(
      metadata({
        items: [
          {
            ...photo,
            fileUrl: 'gcs://private/case/photo.png',
            secret: 'not-forwarded',
          },
        ],
      }),
    );
    expect(await service.caseAttachments(entry.entityId, 'case')).toEqual(
      metadata(),
    );
  });
  it.each([
    { caseId: 'other' },
    { scope: 'ITEM' },
    { items: [{ ...photo, scope: 'ITEM' }] },
    { items: [{ ...photo, contentType: 'image/svg+xml' }] },
    { items: [{ ...photo, sizeBytes: 30 * 1024 * 1024 + 1 }] },
    { items: Array.from({ length: 13 }, () => photo) },
  ])('rejects wrong case or unsafe metadata %j', async (invalid) => {
    json(metadata(invalid));
    await expect(
      service.caseAttachments(entry.entityId, 'case'),
    ).rejects.toThrow('照片資料格式');
  });
  it.each(['text/html', 'image/svg+xml'])(
    'rejects content type %s without emitting it',
    async (type) => {
      fetchMock.mockResolvedValueOnce(
        new Response('<html>', { headers: { 'Content-Type': type } }),
      );
      await expect(
        service.caseAttachmentMedia(entry.entityId, 'case', 'photo'),
      ).rejects.toThrow('格式或大小');
    },
  );
  it('rejects oversize headers, mismatched magic and empty bodies', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(1024 * 1024 + 1),
        },
      }),
    );
    await expect(
      service.caseAttachmentMedia(entry.entityId, 'case', 'photo'),
    ).rejects.toThrow('格式或大小');
    fetchMock.mockResolvedValueOnce(
      new Response('<html>', { headers: { 'Content-Type': 'image/png' } }),
    );
    await expect(
      service.caseAttachmentMedia(entry.entityId, 'case', 'photo'),
    ).rejects.toThrow('格式不符');
    fetchMock.mockResolvedValueOnce(
      new Response(null, { headers: { 'Content-Type': 'image/png' } }),
    );
    await expect(
      service.caseAttachmentMedia(entry.entityId, 'case', 'photo'),
    ).rejects.toThrow('格式或大小');
  });
  it('enforces byte bounds while streaming when content length is missing or misleading', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        headers: { 'Content-Type': 'image/png', 'Content-Length': '12' },
      }),
    );
    await expect(
      service.caseAttachmentMedia(entry.entityId, 'case', 'photo'),
    ).rejects.toThrow('照片過大');
    expect(cancelled).toBe(true);
  });
  it('upstream denial never emits a buffered error as image', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 404 }));
    await expect(
      service.caseAttachmentMedia(entry.entityId, 'case', 'photo'),
    ).rejects.toThrow('暫時無法讀取');
  });
  it('summary treats incomplete counts as unknown and keeps real complete counts separate from loaded pages', async () => {
    json({ complete: false, counts: null });
    expect(await service.sourceSummary(entry.entityId)).toEqual({
      complete: false,
      counts: null,
    });
    json({
      complete: true,
      counts: {
        awaitingCases: 50,
        awaitingItems: 70,
        inTransitCases: 20,
        extra: 'removed',
      },
    });
    expect(await service.sourceSummary(entry.entityId)).toEqual({
      complete: true,
      counts: { awaitingCases: 50, awaitingItems: 70, inTransitCases: 20 },
    });
  });
  it.each([
    {
      complete: true,
      counts: { awaitingCases: 1, awaitingItems: 1, inTransitCases: 2 },
    },
    { complete: false, counts: { awaitingCases: 1 } },
    {
      complete: true,
      counts: { awaitingCases: 1, awaitingItems: NaN, inTransitCases: 0 },
    },
  ])('rejects malformed or impossible complete counts %j', async (invalid) => {
    json(invalid);
    await expect(service.sourceSummary(entry.entityId)).rejects.toThrow(
      '數量資料格式',
    );
  });
  it('validates additive phone/shipments/transit values and accepts old Source responses without them', async () => {
    json({ items: [sourceCase] });
    expect((await service.cases(entry.entityId)).items[0]).toEqual(sourceCase);
    json({
      items: [
        {
          id: 'old',
          number: 'R-0',
          type: 'REPAIR',
          version: '2026-10-08Z',
          items: [],
        },
      ],
    });
    expect(
      (await service.cases(entry.entityId)).items[0].customerPhone,
    ).toBeUndefined();
  });
  it.each([
    { customerPhone: [] },
    { inTransit: 'yes' },
    { reverseShipments: {} },
    { reverseShipments: [{ ...sourceCase.reverseShipments[0], carrier: [] }] },
    {
      reverseShipments: [
        { ...sourceCase.reverseShipments[0], shippedAt: '2026-10-08Z' },
      ],
    },
    {
      reverseShipments: [
        { ...sourceCase.reverseShipments[0], receivedAt: 'broken' },
      ],
    },
    {
      reverseShipments: Array.from(
        { length: 101 },
        () => sourceCase.reverseShipments[0],
      ),
    },
  ])(
    'rejects additive malformed Source case before typed UI %j',
    async (invalid) => {
      json({ items: [{ ...sourceCase, ...invalid }] });
      await expect(service.cases(entry.entityId)).rejects.toThrow(
        '案件資料格式',
      );
    },
  );
});
