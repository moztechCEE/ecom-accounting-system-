import { withRepairStorage } from './repair-storage-context';
describe('narrow runtime-owned repair storage context', () => {
  const key = Symbol.for('corely.dev.repair-storage.v1'),
    original = process.env.ERP_DEV_SANDBOX;
  const global = globalThis as unknown as { [key: symbol]: unknown };
  afterEach(() => {
    delete global[key];
    if (original === undefined) delete process.env.ERP_DEV_SANDBOX;
    else process.env.ERP_DEV_SANDBOX = original;
  });
  it('does not start an operation before the configured private runtime hook authorizes it', async () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    const operation = jest.fn(() => Promise.resolve('done'));
    await expect(
      withRepairStorage('qa', 'repair-media/qa/item/asset', operation),
    ).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
    global[key] = jest.fn(() => Promise.reject(new Error('not permitted')));
    await expect(
      withRepairStorage('qa', 'repair-media/qa/item/asset', operation),
    ).rejects.toThrow('not permitted');
    expect(operation).not.toHaveBeenCalled();
  });
  it('passes only configured bucket/key and a lazy complete operation to the runtime', async () => {
    process.env.ERP_DEV_SANDBOX = 'true';
    const operation = jest.fn(() => Promise.resolve('done'));
    const hook = jest.fn(
      (_bucket: string, _key: string, work: () => Promise<string>) => work(),
    );
    global[key] = hook;
    await expect(
      withRepairStorage('qa', 'repair-media/qa/item/asset', operation),
    ).resolves.toBe('done');
    expect(hook).toHaveBeenCalledWith(
      'qa',
      'repair-media/qa/item/asset',
      operation,
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('preserves normal non-sandbox storage behavior without a global network switch', async () => {
    process.env.ERP_DEV_SANDBOX = 'false';
    const operation = jest.fn(() => Promise.resolve('done'));
    await expect(
      withRepairStorage('normal', 'repair-media/entity/item/asset', operation),
    ).resolves.toBe('done');
  });
});
