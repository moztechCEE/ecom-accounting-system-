import { ServiceUnavailableException } from '@nestjs/common';
type RepairStorageHook = <T>(
  bucket: string,
  key: string,
  operation: () => Promise<T>,
) => Promise<T>;
const hookKey = Symbol.for('corely.dev.repair-storage.v1');
/** The DEV runtime owns the private transport allowlist; an absent hook cannot
 * silently grant general network access or execute the operation first. */
export async function withRepairStorage<T>(
  bucket: string,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (process.env.ERP_DEV_SANDBOX !== 'true') return operation();
  const hook = (globalThis as unknown as { [key: symbol]: unknown })[hookKey];
  if (typeof hook !== 'function')
    throw new ServiceUnavailableException('DEV 檢修影像存取尚未啟用');
  return (hook as RepairStorageHook)(bucket, key, operation);
}
