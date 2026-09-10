/** Proposed wms.read.v1 boundary. Never consume the legacy order-detail GET:
 * it may update order completion. No provider account name implies a brand. */
export const WMS_CONTRACT = 'wms.read.v1' as const;
export type WmsReadScope = { entityId: string; brandCodes: readonly string[] };
export type WmsBinding = {
  entityId: string; brandCode: string; erpOrderId: string; wmsOrderId: string;
  accountId: string; environment: 'stage' | 'production'; merchantId: string; logisticsId: string;
};
export type WmsFact = {
  contractVersion: typeof WMS_CONTRACT; binding: WmsBinding;
  warehouseStatus: string; logisticsStatus: string;
  observedAt: string; warehouseReceivedAt: string | null;
  returnKind: 'uncollected' | 'customer_return' | 'customer_repair' | null;
};
const warehouseLabels: Record<string, string> = {
  pending: '待揀貨', picking: '揀貨中', picked: '待裝箱', packing: '裝箱中', completed: '核對完成', voided: '已作廢',
};
const logisticsLabels: Record<string, string> = {
  uploading: '物流資料上傳中', awaiting_dispatch: '等待交付物流', at_logistics_center: '已到物流中心',
  awaiting_pickup: '到店待取', collected: '已取件', uncollected: '逾期未取', returned_to_center: '退回物流中心',
};
export function projectWmsFact(fact: WmsFact, scope: WmsReadScope, expected: WmsBinding) {
  if (fact.contractVersion !== WMS_CONTRACT) throw new Error('WMS_CONTRACT_MISMATCH');
  if (!scope.entityId || !scope.brandCodes.length || scope.entityId !== expected.entityId || !scope.brandCodes.includes(expected.brandCode))
    throw new Error('WMS_SCOPE_DENIED');
  for (const key of ['entityId','brandCode','erpOrderId','wmsOrderId','accountId','environment','merchantId','logisticsId'] as const) {
    if (!expected[key] || typeof fact.binding?.[key] !== 'string' || fact.binding[key] !== expected[key]) throw new Error('WMS_BINDING_MISMATCH');
  }
  if (!['production','stage'].includes(expected.environment)) throw new Error('WMS_BINDING_MISMATCH');
  if (!Number.isFinite(Date.parse(fact.observedAt)) || (fact.warehouseReceivedAt !== null && !Number.isFinite(Date.parse(fact.warehouseReceivedAt))))
    throw new Error('WMS_INVALID_TIME');
  if (![null,'uncollected','customer_return','customer_repair'].includes(fact.returnKind)) throw new Error('WMS_INVALID_RETURN_KIND');
  // Explicit public projection: no customer contact, raw provider response or secrets.
  return {
    contractVersion: WMS_CONTRACT, erpOrderId: expected.erpOrderId, wmsOrderId: expected.wmsOrderId,
    brandCode: expected.brandCode, logisticsId: expected.logisticsId,
    warehouse: { status: warehouseLabels[fact.warehouseStatus] ? fact.warehouseStatus : 'unknown', label: warehouseLabels[fact.warehouseStatus] || '作業狀態待確認' },
    logistics: { status: logisticsLabels[fact.logisticsStatus] ? fact.logisticsStatus : 'unknown', label: logisticsLabels[fact.logisticsStatus] || '貨態待確認' },
    receipt: { status: fact.warehouseReceivedAt ? 'received' : 'unconfirmed', receivedAt: fact.warehouseReceivedAt },
    returnKind: fact.returnKind, observedAt: fact.observedAt,
    inventoryEffect: 'none' as const, financialEffect: 'none' as const,
  };
}
