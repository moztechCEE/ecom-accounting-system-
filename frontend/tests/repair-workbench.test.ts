import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectionReviewCurrent, repairStartReady } from '../src/pages/repair/repair-model.ts'
import type { InspectionData, RepairDocument, RepairItem } from '../src/pages/repair/repair-model.ts'
import { canAccessRoute } from '../src/utils/access-preview.ts'
import type { User } from '../src/types/index.ts'

const inspection: RepairDocument<InspectionData> = {
  number: 'INS-FIXTURE', revision: 3, status: 'SUBMITTED', authorId: 'fixture-tech', authorName: '維修師',
  updatedAt: '2026-10-02T01:00:00Z',
  review: { inspectionRevision: 3, actorId: 'fixture-csr', name: '承辦客服', confirmedAt: '2026-10-02T02:00:00Z' },
  data: { complaint: '合成故障', reproduction: 'YES', testConditions: '合成測試', checks: [], diagnosis: '合成診斷', causeStatus: 'CONFIRMED', plan: 'REPAIR', planNote: '原機處理', feeSuggestion: 'FREE', estimateNote: '' },
}
const item = { status: 'INSPECTING', receipt: { category: 'REPAIR' }, repairInspection: inspection, release: { available: true, repairAllowed: true } } as RepairItem

test('CSR confirmation applies only to the current submitted inspection revision', () => {
  assert(inspectionReviewCurrent(inspection))
  assert(!inspectionReviewCurrent({ ...inspection, revision: 4 }))
  assert(!inspectionReviewCurrent({ ...inspection, status: 'DRAFT' }))
  assert(!inspectionReviewCurrent({ ...inspection, review: undefined }))
  assert(!inspectionReviewCurrent(null))
})

test('free, paid and review suggestions all require current CSR confirmation plus independent source release', () => {
  for (const feeSuggestion of ['FREE', 'PAID', 'REVIEW'] as const) {
    const current = { ...inspection, data: { ...inspection.data, feeSuggestion } }
    assert(repairStartReady({ ...item, repairInspection: current }))
    assert(!repairStartReady({ ...item, repairInspection: { ...current, review: undefined } }))
    assert(!repairStartReady({ ...item, repairInspection: { ...current, revision: 4 } }))
    assert(!repairStartReady({ ...item, repairInspection: current, release: { available: true, repairAllowed: false } }))
    assert(!repairStartReady({ ...item, repairInspection: current, release: { available: false, repairAllowed: true } }))
  }
  assert(!repairStartReady({ ...item, status: 'WAITING_CUSTOMER' }))
  assert(!repairStartReady({ ...item, receipt: { ...item.receipt, category: 'RETURN' } }))
  for (const plan of ['FACTORY', 'RETURN'] as const) {
    assert(!repairStartReady({ ...item, repairInspection: { ...inspection, data: { ...inspection.data, plan } } }))
  }
})

test('repair document editing does not grant CSR confirmation or customer agreement authority', () => {
  const technician = { roles: ['REPAIR_TECHNICIAN'], permissions: ['repair_workbench:read', 'repair_workbench:update'] } as User
  const customerService = { roles: ['CUSTOMER_SERVICE'], permissions: ['mailroom:read', 'mailroom:review'] } as User
  assert(canAccessRoute(technician, ['repair_workbench:update']))
  assert(!canAccessRoute(technician, ['mailroom:review']))
  assert(!canAccessRoute(technician, ['after_sales_cases:update']))
  assert(canAccessRoute(customerService, ['mailroom:review']))
  assert(!canAccessRoute(customerService, ['repair_workbench:update']))
})
