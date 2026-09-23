import type { HandoverLine } from '../services/wms-reconciliation.service.ts'

export interface HandoverLineReview {
  label: string
  color: 'red' | 'blue' | 'green'
  blocking: boolean
  detail: string
}

// This only prevents obvious mistakes in the UI. The posting API remains the
// authority for current source, reservation, stock and concurrent deliveries.
export function reviewHandoverLine(line: HandoverLine): HandoverLineReview {
  if (line.status === 'posted') return { label: '已過帳', color: 'green', blocking: true, detail: '此筆交運明細已正式出庫，不會再次扣帳。' }
  const packageQuantity = line.packages?.reduce((total, box) => total + box.quantity, 0) ?? 0
  if (!line.packages?.length || line.packages.some((box) => !box.packageId || !Number.isSafeInteger(box.quantity) || box.quantity <= 0) || packageQuantity !== line.quantity) {
    return { label: '箱件證據不符', color: 'red', blocking: true, detail: '箱件資料不得為空，且各箱件數量合計必須等於本次實交量。' }
  }
  const remaining = line.orderedQuantity - line.postedQuantity
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(remaining) || remaining <= 0) {
    return { label: '數量異常', color: 'red', blocking: true, detail: '本次交運量或可出庫餘量異常，請先查明來源資料。' }
  }
  if (line.quantity > remaining) {
    return { label: '超過可出庫量', color: 'red', blocking: true, detail: `本次實交 ${line.quantity} 件，超過尚未出庫的 ${remaining} 件。` }
  }
  if (line.quantity < remaining) {
    return { label: '本次部分交運', color: 'blue', blocking: false, detail: `本次過帳後，原銷單明細仍有 ${remaining - line.quantity} 件未出庫。` }
  }
  return { label: '數量相符', color: 'green', blocking: false, detail: '本次實交量等於這筆銷單明細尚未出庫的數量。' }
}
