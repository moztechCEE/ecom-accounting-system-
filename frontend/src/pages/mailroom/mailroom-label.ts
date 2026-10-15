import { physicalItemLink } from '../../utils/mailroom-item-link'
import type { Item } from './model'

export type PhysicalLabel = { id: string; unit: string; number: string; numberKind: string; product: string; link: string }
export function physicalLabel(item: Item, entityId: string, origin: string): PhysicalLabel {
  return { id: item.id, unit: item.label, number: item.receipt.sourceNumber || item.receipt.number,
    numberKind: item.receipt.sourceNumber ? '案件' : '收件', product: item.productName,
    link: physicalItemLink(origin, entityId, item.id) }
}
