import { AiService } from './ai.service';

describe('AI provider availability and failure privacy', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  const make = (settings: Record<string, string>) =>
    new AiService({ get: (key: string) => settings[key] } as any);
  it('reports a disabled sandbox even when a key exists', async () => {
    const service = make({
      GEMINI_API_KEY: 'private-key',
      ERP_DEV_SANDBOX: 'true',
    });
    global.fetch = jest.fn();
    expect(service.getStatus()).toEqual({
      available: false,
      provider: 'Gemini',
      reason: 'sandbox_disabled',
    });
    expect(await service.generateContent('test')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('requires a key even after the explicit DEV AI opt-in', async () => {
    const service = make({
      ERP_DEV_SANDBOX: 'true',
      ERP_DEV_AI_ENABLED: 'true',
    });
    global.fetch = jest.fn();
    expect(service.getStatus()).toEqual({
      available: false,
      provider: 'Gemini',
      reason: 'not_configured',
    });
    expect(await service.generateContent('test')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('allows the existing provider only after explicit DEV opt-in and blocks redirects', async () => {
    const service = make({
      GEMINI_API_KEY: 'private-key',
      ERP_DEV_SANDBOX: 'true',
      ERP_DEV_AI_ENABLED: 'true',
    });
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'test response' }] } }],
        }),
      });
    expect(service.getStatus().available).toBe(true);
    expect(await service.generateContent('test')).toBe('test response');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
  });
  it.each(['false', 'TRUE', '1', ''])(
    'does not treat a non-explicit DEV flag %s as permission',
    (value) => {
      const service = make({
        GEMINI_API_KEY: 'private-key',
        ERP_DEV_SANDBOX: 'true',
        ERP_DEV_AI_ENABLED: value,
      });
      expect(service.getStatus().reason).toBe('sandbox_disabled');
    },
  );

  it('returns only the HTTP code when the provider responds with an error', async () => {
    const service = make({ GEMINI_API_KEY: 'private-key' });
    const text = jest.fn().mockResolvedValue('private-key raw user prompt');
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 429, text });
    await expect(
      service.generateContent('private prompt'),
    ).rejects.toMatchObject({ response: { code: 'provider_http_429' } });
    expect(text).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('generateContent'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
