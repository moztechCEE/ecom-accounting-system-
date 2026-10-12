import type { NativeCaseInput } from '../../services/native-after-sales.service'

export type RegistrationScope = { actorId: string; entityId: string }
export type PendingRegistration = RegistrationScope & {
  schema: 'corely.doa.pending-registration.v1'
  requestId: string
  createdAt: string
  request: { brand: string; customerKind: string; payload: NativeCaseInput }
}
export type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Client identity consistency only; authorization is still checked by the server. */
export function registrationTokenMatchesActor(token: string, actorId: string) {
  try {
    const encoded = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!encoded) return false
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)).sub === actorId
  } catch { return false }
}

export class PendingRegistrationError extends Error {
  code: 'STORAGE' | 'INVALID' | 'CONFLICT' | 'LOCK'
  pending?: PendingRegistration
  constructor(code: 'STORAGE' | 'INVALID' | 'CONFLICT' | 'LOCK', message: string, pending?: PendingRegistration) { super(message); this.code = code; this.pending = pending }
}
const TYPES = ['RESHIPMENT', 'PRIVATE_PURCHASE', 'REPAIR', 'EXCHANGE_RETURN', 'REFUND_PICKUP', 'CUSTOMER_ISSUE']
const DETAIL_KEYS: Record<string, string[]> = {
  RESHIPMENT: ['reshipmentReason', 'lossCategory', 'missingContents', 'requiresPayment'],
  PRIVATE_PURCHASE: ['paymentRegion', 'requiresPayment', 'currency'],
  REPAIR: ['faultDescription', 'serialNumber', 'requiresPayment', 'productId'],
  EXCHANGE_RETURN: ['reasonCategory', 'reasonNote', 'requiresPayment'],
  REFUND_PICKUP: ['refundReason', 'itemQuantity'],
  CUSTOMER_ISSUE: ['brand', 'issueDescription'],
}
const exactKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit
export function pendingRegistrationKey(scope: RegistrationScope) {
  if (!scope.actorId || !scope.entityId) throw new PendingRegistrationError('INVALID', '請先確認登入帳號與公司')
  return `corely.doa.pending-registration.v1:${encodeURIComponent(scope.actorId)}:${encodeURIComponent(scope.entityId)}`
}
export function validatePendingRegistration(value: unknown, scope: RegistrationScope): PendingRegistration {
  const fail = () => { throw new PendingRegistrationError('INVALID', '待確認建單資料無法讀取，請聯絡管理者') }
  if (!object(value) || !exactKeys(value, ['schema', 'actorId', 'entityId', 'requestId', 'createdAt', 'request']) || value.schema !== 'corely.doa.pending-registration.v1' || value.actorId !== scope.actorId || value.entityId !== scope.entityId || !text(value.requestId, 36) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(value.requestId)) || !text(value.createdAt, 40) || !Number.isFinite(Date.parse(String(value.createdAt)))) return fail()
  const request = value.request
  if (!object(request) || !exactKeys(request, ['brand', 'customerKind', 'payload']) || !['MOZTECH', 'BONSON', 'MORITEK', 'OTHER'].includes(String(request.brand)) || !['TO_C', 'TO_B'].includes(String(request.customerKind)) || !object(request.payload)) return fail()
  const payload = request.payload
  if (!exactKeys(payload, ['type', 'sourceChannel', 'contactName', 'contactPhone', 'contactAddress', 'contactEmail', 'referenceNumber', 'internalNote', 'items', 'detail']) || !TYPES.includes(String(payload.type)) || !text(payload.sourceChannel, 100) || !text(payload.contactName, 100) || !text(payload.contactPhone, 40) || !text(payload.contactAddress, 500) || !text(payload.contactEmail, 254) || payload.referenceNumber != null && !text(payload.referenceNumber, 120) || payload.internalNote != null && !text(payload.internalNote, 6500) || !Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 100) return fail()
  if (payload.items.some(item => !object(item) || !exactKeys(item, ['productId', 'quantity']) || !text(item.productId, 160) || !item.productId || !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 9999)) return fail()
  if (!object(payload.detail) || !exactKeys(payload.detail, DETAIL_KEYS[String(payload.type)]) || Object.values(payload.detail).some(field => field !== null && !['string', 'boolean', 'number'].includes(typeof field) || typeof field === 'string' && field.length > 6500 || typeof field === 'number' && !Number.isFinite(field))) return fail()
  if (JSON.stringify(value).length > 65536) return fail()
  return value as unknown as PendingRegistration
}
export function readPendingRegistration(storage: PendingStorage, scope: RegistrationScope): PendingRegistration | null {
  let raw: string | null
  try { raw = storage.getItem(pendingRegistrationKey(scope)) } catch { throw new PendingRegistrationError('STORAGE', '待確認建單資料無法讀取，請重試') }
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new PendingRegistrationError('INVALID', '待確認建單資料無法讀取，請聯絡管理者') }
  return validatePendingRegistration(value, scope)
}
export function savePendingRegistration(storage: PendingStorage, scope: RegistrationScope, pending: PendingRegistration) {
  validatePendingRegistration(pending, scope)
  const prior = readPendingRegistration(storage, scope)
  if (prior && JSON.stringify(prior) !== JSON.stringify(pending)) throw new PendingRegistrationError('CONFLICT', '已有待確認案件，請先重試確認', prior)
  try { storage.setItem(pendingRegistrationKey(scope), JSON.stringify(pending)) } catch { throw new PendingRegistrationError('STORAGE', '建單資料未能保存，尚未送出') }
  const saved = readPendingRegistration(storage, scope)
  if (!saved || JSON.stringify(saved) !== JSON.stringify(pending)) throw new PendingRegistrationError('STORAGE', '建單資料未能確認保存，尚未送出')
}
export function clearPendingRegistration(storage: PendingStorage, scope: RegistrationScope, requestId: string) {
  const prior = readPendingRegistration(storage, scope)
  if (prior && prior.requestId !== requestId) throw new PendingRegistrationError('CONFLICT', '待確認案件已變更，請重新核對', prior)
  try { storage.removeItem(pendingRegistrationKey(scope)) } catch { throw new PendingRegistrationError('STORAGE', '案件結果已確認，待確認紀錄未能清除，請重試確認') }
  if (readPendingRegistration(storage, scope)) throw new PendingRegistrationError('STORAGE', '案件結果已確認，待確認紀錄未能清除，請重試確認')
}
/** The browser-wide lock keeps another tab from replacing an outstanding request. */
export async function withPendingRegistrationLock<T>(scope: RegistrationScope, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) throw new PendingRegistrationError('LOCK', '目前瀏覽器無法安全確認建單，請換用支援的瀏覽器')
  return locks.request(pendingRegistrationKey(scope), { mode: 'exclusive', ...(signal ? { signal } : {}) }, action)
}
