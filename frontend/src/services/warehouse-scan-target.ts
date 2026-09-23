import type { WorkItem, WorkStage } from './warehouse.types'

export function scanCandidates(items: WorkItem[], stage: WorkStage, scanValue: string): WorkItem[] {
  const value = scanValue.trim()
  if (!value) return []
  return items.filter(item => {
    if (stage === 'pick' ? item.picked >= item.quantity : item.packed >= item.picked) return false
    if (item.serials.length) return item.serials.some(serial => serial.value === value &&
      (stage === 'pick' ? serial.status === 'pending' : serial.status === 'picked'))
    return item.barcode === value
  })
}

export function scanTarget(items: WorkItem[], stage: WorkStage, scanValue: string, selectedItemId: string) {
  const matches = scanCandidates(items, stage, scanValue)
  const value = scanValue.trim()
  // The native WMS requires source identity whenever the order contains two
  // matching lines, even if one line has already reached its quantity limit.
  const ambiguous = !!value && items.filter(item => item.serials.length
    ? item.serials.some(serial => serial.value === value)
    : item.barcode === value).length > 1
  const itemId = ambiguous && matches.some(item => item.id === selectedItemId) ? selectedItemId : undefined
  return { matches, ambiguous, needsSelection: ambiguous && !itemId, itemId }
}
