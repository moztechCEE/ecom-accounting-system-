import { AiService } from './ai.service';
import type { ConfigService } from '@nestjs/config';

describe('AI provider availability and failure privacy', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  const make = (settings: Record<string, string>) =>
    new AiService({
      get: (key: string) => settings[key],
    } as unknown as ConfigService);
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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'test response' }] } }],
        }),
    });
    expect(service.getStatus().available).toBe(true);
    expect(await service.generateContent('test')).toBe('test response');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
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

  it('exposes reviewed standard and deep models with compatible mode metadata', () => {
    const service = make({ GEMINI_API_KEY: 'private-key' });
    expect(service.getAvailableModels()).toEqual([
      {
        id: 'gemini-3.5-flash-lite',
        mode: 'standard',
        name: '標準模式',
        description: '速度較快，適合日常問答與建議',
      },
      {
        id: 'gemini-3.5-flash',
        mode: 'deep',
        name: '深度模式',
        description: '思考較深，適合分析與判斷',
      },
    ]);
    expect(service.resolveModelId()).toBe('gemini-3.5-flash-lite');
  });

  it.each([
    ['gemini-1.5-flash', 'gemini-3.5-flash-lite'],
    ['gemini-2.0-flash', 'gemini-3.5-flash-lite'],
    ['gemini-2.5-flash', 'gemini-3.5-flash-lite'],
    ['gemini-1.5-pro', 'gemini-3.5-flash'],
    ['gemini-2.5-pro', 'gemini-3.5-flash'],
    ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite'],
    ['gemini-3.5-flash', 'gemini-3.5-flash'],
    ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    ['../unapproved:generateContent?key=injected', 'gemini-3.5-flash-lite'],
  ])(
    'routes %s only to its supported model endpoint %s',
    async (requested, resolved) => {
      const service = make({ GEMINI_API_KEY: 'private-key' });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [{ content: { parts: [{ text: 'answer' }] } }],
          }),
      });
      expect(await service.generateContent('test', requested)).toBe('answer');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        `https://generativelanguage.googleapis.com/v1beta/models/${resolved}:generateContent`,
        expect.objectContaining({ method: 'POST', redirect: 'error' }),
      );
    },
  );

  it('joins public text parts for JSON parsing while excluding thought and non-text content', async () => {
    const service = make({ GEMINI_API_KEY: 'private-key' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  {
                    thought: true,
                    text: 'private reasoning must not become the answer',
                  },
                  { text: '{"tool":' },
                  { functionCall: { name: 'untrusted_function' } },
                  { thought: true, text: 'more private reasoning' },
                  { thought: false, text: '"general_chat","params":{}}' },
                ],
              },
            },
          ],
        }),
    });
    const result = await service.generateContent('test');
    expect(result).toBe('{"tool":"general_chat","params":{}}');
    expect(service.parseJsonOutput(result!)).toEqual({
      tool: 'general_chat',
      params: {},
    });
  });

  it.each([
    [{ thought: true, text: 'private reasoning only' }],
    [{ functionCall: { name: 'untrusted_function' } }],
    [{ text: 123 }],
    [],
  ])(
    'returns no answer when the provider has no public text: %j',
    async (...parts) => {
      const service = make({ GEMINI_API_KEY: 'private-key' });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ candidates: [{ content: { parts } }] }),
      });
      expect(await service.generateContent('test')).toBeNull();
    },
  );

  it.each([429, 404])(
    'returns only HTTP %i without retrying or exposing the provider body',
    async (status) => {
      const service = make({ GEMINI_API_KEY: 'private-key' });
      const text = jest.fn().mockResolvedValue('private-key raw user prompt');
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status, text });
      await expect(
        service.generateContent('private prompt'),
      ).rejects.toMatchObject({
        response: { code: `provider_http_${status}` },
      });
      expect(text).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(
        (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1]
          ?.signal,
      ).toBeInstanceOf(AbortSignal);
    },
  );
});
