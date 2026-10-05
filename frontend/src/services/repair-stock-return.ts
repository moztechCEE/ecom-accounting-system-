import type { User } from '../types'

export type ReturnStockSource = {
  id: string; label: string; sku?: string; grade?: string; serialNumber?: string | null
  version?: number; location?: string | null; status?: string; custodianId?: string | null
  inspectionRevision?: number; reportRevision?: number; reportInspectionRevision?: number
  qcResult?: string; refurbishmentEligible?: boolean
  receipt: { sourceNumber?: string }
}
export type ReturnStockProduct = { id: string; sku: string; name: string; hasSerialNumbers: boolean }
export type StockReturnFormValues = {
  sourceItemId: string; productId: string; warehouseId: string; unitLabel: string
  serialNumber?: string; sourceLocation: string; location: string
  ownershipReference: string; inspectionReference: string; confirmedItems: boolean
}
export type StockReturnReceiptInput = Omit<StockReturnFormValues, 'confirmedItems'> & {
  entityId: string; requestId: string; expectedVersion: number; quantity: 1; confirmedItems: true
}
export type ReturnStockInboundProof = {
  inTransactionId: string; sourceItemId: string; sourceCaseId?: string | null; sourceCaseItemId?: string | null
  unitId: string; requestId: string; warehouseId: string; quantity: 1
  fromCustodianId: string; toCustodianId: string; fromLocation: string; toLocation: string
  sourceItemVersion: number; inventoryItemVersion: number; inspectionRevision: number; reportRevision: number
  externalInventoryPosted: false
}

export function validateReturnStockReceipt(
  result: { unit: { id: string; kind: string; unitLabel: string; serialNumber?: string | null }; inbound: ReturnStockInboundProof },
  input: StockReturnReceiptInput,
  actorId: string | undefined,
): void {
  const inbound = result?.inbound
  if (!actorId || !inbound?.inTransactionId || !inbound.unitId || result.unit?.id !== inbound.unitId ||
    result.unit.kind !== 'REFURBISHED' || result.unit.unitLabel !== input.unitLabel ||
    (result.unit.serialNumber || undefined) !== input.serialNumber ||
    inbound.sourceItemId !== input.sourceItemId || inbound.requestId !== input.requestId ||
    inbound.warehouseId !== input.warehouseId || inbound.quantity !== 1 ||
    inbound.sourceItemVersion !== input.expectedVersion || inbound.inventoryItemVersion !== input.expectedVersion + 1 ||
    !inbound.fromCustodianId || inbound.toCustodianId !== actorId ||
    inbound.fromLocation !== input.sourceLocation || inbound.toLocation !== input.location ||
    !Number.isInteger(inbound.inspectionRevision) || inbound.inspectionRevision < 1 ||
    !Number.isInteger(inbound.reportRevision) || inbound.reportRevision < 1 || inbound.externalInventoryPosted !== false)
    throw new Error('尚未取得符合本筆點收的正式入庫回執，請保留同一筆資料重試')
}

export function canReceiveReturnStock(user: Pick<User, 'roles' | 'permissions' | 'inventoryDataScope'> | null): boolean {
  if (!user) return false
  if (user.roles.includes('SUPER_ADMIN')) return true
  return user.inventoryDataScope === 'ENTITY' && (user.roles.includes('ADMIN') ||
    user.permissions.some(permission => ['inventory:update', 'after_sales_stock:update'].includes(permission)))
}

export function buildReturnStockReceipt(
  entityId: string,
  values: StockReturnFormValues,
  source: ReturnStockSource | undefined,
  product: ReturnStockProduct | undefined,
  requestId: string,
): StockReturnReceiptInput {
  const positiveRevision = (value: unknown) => Number.isInteger(value) && Number(value) >= 1
  if (!entityId || !source || source.id !== values.sourceItemId || !source.refurbishmentEligible ||
    !['PENDING_RESTOCK', 'PENDING_WELFARE_STOCK'].includes(source.status || '') ||
    !positiveRevision(source.version) || source.qcResult !== 'PASS' ||
    !positiveRevision(source.inspectionRevision) || !positiveRevision(source.reportRevision) || source.reportInspectionRevision !== source.inspectionRevision)
    throw new Error('來源退貨尚未完成本版合格複驗或收發交接，請先核對原工作單')
  if (!product || product.id !== values.productId || product.sku !== source.sku)
    throw new Error('商品 SKU 必須與來源退貨實物一致')
  if (!values.confirmedItems) throw new Error('請由庫存負責人本人確認實際點件簽收')
  const required = (value: string | undefined, label: string, max: number) => {
    const text = value?.trim() || ''
    if (!text || text.length > max) throw new Error(`請填寫有效的${label}`)
    return text
  }
  const sourceLocation = required(values.sourceLocation, '來源實物位置', 160)
  if (sourceLocation !== source.location?.trim()) throw new Error('來源實物位置已變動，請重新核對')
  const serialNumber = values.serialNumber?.trim() || undefined
  const sourceSerial = source.serialNumber?.trim() || undefined
  if (serialNumber !== sourceSerial || (product.hasSerialNumbers && !sourceSerial))
    throw new Error('產品 SN 須使用來源實物的真實 SN，不可另造或替換')
  if (serialNumber && serialNumber.length > 100) throw new Error('來源 SN 長度超過入庫限制，請核對原工作單')
  // Freeze the complete first submission. A timeout retry must retain the same
  // request ID, source version and body even when a later catalog has changed.
  return Object.freeze({
    entityId, sourceItemId: source.id, productId: product.id,
    warehouseId: required(values.warehouseId, '目的倉位', 128),
    unitLabel: required(values.unitLabel, '唯一實物標籤', 100),
    serialNumber, sourceLocation, location: required(values.location, '目的庫存實際位置', 160),
    ownershipReference: required(values.ownershipReference, '所有權／退貨接收依據', 500),
    inspectionReference: required(values.inspectionReference, '合格檢驗依據', 500),
    requestId, expectedVersion: source.version!, quantity: 1, confirmedItems: true,
  })
}
