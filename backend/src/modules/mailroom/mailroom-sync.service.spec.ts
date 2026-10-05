import { PrismaService } from '../../common/prisma/prisma.service';
import { signRequest } from './mailroom.contract';
import { MailroomSyncService } from './mailroom-sync.service';

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
});
