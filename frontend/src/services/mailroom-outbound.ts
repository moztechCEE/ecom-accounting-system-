import axios from 'axios'
import api, { API_URL } from './api'
import { registrationTokenMatchesActor } from '../pages/after-sales/pending-registration'

export type OutboundSourceOrder = {
  id: string; number: string; type: 'RESHIPMENT' | 'PRIVATE_PURCHASE' | 'EXCHANGE_RETURN';
  version: string; sourceChannel: string; brand: string | null; customerLabel: string;
  dispatchAllowed: boolean; blockReason: string | null;
  items: { id: string; name: string; sku: string | null; quantity: number; dispatchedQuantity: number; plannedQuantity?: number }[];
  recipient: { name: string; phone: string; address: string };
}
export type OutboundAction = 'prepare' | 'accept' | 'dispatch' | 'cancel' | 'retry_sync' | 'refresh_source'
export type OutboundOrder = {
  id: string; entityId: string; sourceCaseId: string; sourceNumber: string;
  caseType: OutboundSourceOrder['type']; sourceVersion: string;
  status: 'PENDING_PICK' | 'WAITING_MAILROOM_ACCEPTANCE' | 'READY_FOR_DISPATCH' | 'DISPATCHED' | 'CANCELLED';
  version: number; location: string | null; custodianId: string | null; custodianName: string | null;
  nextUserId: string | null; nextUserName: string | null;
  items: { unitId: string; sourceCaseItemId: string; productName: string; sku: string | null; quantity: 1;
    productId?: string | null; warehouseId?: string | null; serialNumber?: string | null; postingId?: string | null }[];
  outboundShipment: { carrier: string; trackingNumber: string; dispatchedAt: string } | null;
  sourceSync: { status: 'NOT_DISPATCHED' | 'PENDING' | 'DELIVERED' | 'FAILED'; attempts: number; lastError?: string | null };
  availableActions: string[];
}
export type OutboundWarehouse = { id: string; code: string; name: string; entityId: string }
export type OutboundRegistration = { entityId: string; requestId: string; sourceCaseId: string; sourceVersion: string;
  lines: { sourceCaseItemId: string; quantity: number }[] }
export type OutboundCommand = { entityId: string; requestId: string; expectedVersion: number; action: OutboundAction;
  confirmedItems?: true; location?: string; nextUserId?: string;
  items?: { unitId: string; productId: string; warehouseId: string; sku: string; serialNumber?: string }[];
  carrier?: string; trackingNumber?: string }
export type OutboundIdentity = { actorId: string; token: string }
const unwrap = <T,>(data: T | { data: T }): T => data && typeof data === 'object' && 'data' in data ? data.data : data as T
const base = '/mailroom/outbound'
export function outboundIdentityCurrent(identity: OutboundIdentity) {
  return registrationTokenMatchesActor(identity.token, identity.actorId) && localStorage.getItem('access_token') === identity.token
}

export const mailroomOutbound = {
  async sources(entityId: string, search = '', caseId?: string, signal?: AbortSignal) {
    return unwrap((await api.get<{ items: OutboundSourceOrder[]; nextCursor: string | null }>(base + '/source-orders', { params: { entityId, search, caseId }, signal })).data)
  },
  async orders(entityId: string, status: string | undefined, search: string, page: number, signal?: AbortSignal) {
    return unwrap((await api.get<{ items: OutboundOrder[]; total: number }>(base + '/orders', { params: { entityId, status, search, page }, signal })).data)
  },
  async order(entityId: string, id: string, signal?: AbortSignal) {
    return unwrap((await api.get<OutboundOrder>(base + '/orders/' + encodeURIComponent(id), { params: { entityId }, signal })).data)
  },
  async warehouses(entityId: string, signal?: AbortSignal) {
    return unwrap((await api.get<{ items: OutboundWarehouse[] }>(base + '/warehouses', { params: { entityId }, signal })).data).items
  },
  async mutate(kind: 'create' | 'action', orderId: string | undefined, body: string, identity: OutboundIdentity, signal: AbortSignal) {
    if (signal.aborted || !outboundIdentityCurrent(identity)) throw new DOMException('登入狀態已變更，請重新登入後核對原操作', 'AbortError')
    // Mutations use the captured identity; the shared interceptor must not swap in a later login.
    const response = await axios.request<OutboundOrder>({ baseURL: API_URL,
      url: kind === 'create' ? base + '/orders' : base + '/orders/' + encodeURIComponent(orderId || '') + '/actions',
      method: 'POST', data: body, signal, timeout: 30000,
      headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' } })
    return unwrap(response.data)
  },
}
