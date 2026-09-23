import type { B2BProcurementSummary } from '../../services/purchase.service'

type ProcurementLine = B2BProcurementSummary['items'][number]

export function remainingProcurementQuantity(summary: B2BProcurementSummary, line: ProcurementLine): number | null {
  if (summary.requiresFreshReview) return null
  return Math.max(0, line.shortage - line.ordered)
}

export function availableProcurementLines(summary: B2BProcurementSummary | null): ProcurementLine[] {
  if (!summary || summary.requiresFreshReview) return []
  return summary.items.filter((line) => (remainingProcurementQuantity(summary, line) ?? 0) > 0)
}
