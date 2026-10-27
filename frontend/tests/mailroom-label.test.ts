import assert from 'node:assert/strict'
import test from 'node:test'
import { physicalLabel } from '../src/pages/mailroom/mailroom-label.ts'
import type { MailroomLabelData } from '../src/pages/mailroom/mailroom-label.ts'

const itemId = '11111111-2222-4333-8444-555555555555'
const dto: MailroomLabelData = {
  id: itemId, unit: 'MR-1', caseNumber: 'CASE-合成', customerName: ' 合成顧客 ', customerPhone: '0912-345-678',
  customerIssue: '<script>合成問題</script>', productName: '合成產品', version: 1,
  qrLink: 'https://dev.example.test/operations/repair?entityId=company-a&itemId=' + itemId + '&queue=all',
}
test('label uses the narrow DTO and preserves a full physical-item QR without customer PII', () => {
  const label = physicalLabel(dto, 'company-a')
  assert.equal(label.customerName, '合成顧客')
  assert.equal(label.customerPhone, dto.customerPhone)
  assert.equal(label.caseNumber, dto.caseNumber)
  assert.equal(label.customerIssue, dto.customerIssue)
  assert.equal(label.link, dto.qrLink)
  assert.deepEqual([...new URL(label.link).searchParams.keys()], ['entityId', 'itemId', 'queue'])
  assert.ok(!label.link.includes('0912'))
})
test('all absent fields show 未提供; long issue summaries keep complete unicode characters and an ellipsis', () => {
  const label = physicalLabel({ ...dto, customerName: null, customerPhone: '', caseNumber: ' ', customerIssue: null }, 'company-a')
  assert.deepEqual([label.customerName, label.customerPhone, label.caseNumber, label.customerIssue], Array(4).fill('未提供'))
  const issue = physicalLabel({ ...dto, customerIssue: '😀'.repeat(200) }, 'company-a').customerIssue
  assert.equal([...issue].length, 160)
  assert.equal([...issue].at(-1), '…')
  assert.equal([...issue].at(-2), '😀')
})
test('label rejects mismatched item/company, unsafe destinations and QR query PII', () => {
  for (const qrLink of [dto.qrLink.replace(itemId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), dto.qrLink.replace('company-a', 'company-b'), dto.qrLink + '&phone=0912', dto.qrLink + '#customer', 'javascript:alert(1)', dto.qrLink.replace('https://', 'https://user:password@')]) {
    assert.throws(() => physicalLabel({ ...dto, qrLink }, 'company-a'))
  }
  const mailroom = 'https://dev.example.test/operations/mailroom?entityId=company-a&itemId=' + itemId
  assert.equal(physicalLabel({ ...dto, qrLink: mailroom }, 'company-a').link, mailroom)
})

test('editable label display keeps QR and identity unchanged, supports explicit empty text and normalizes only display values', async () => {
  const { editedLabel, labelEditFromData } = await import('../src/pages/mailroom/mailroom-label.ts')
  const edit = { ...labelEditFromData(dto), caseNumber: ' 短案號 ', customerIssue: ' USB-C   無輸出 ', customerPhone: '', productName: '萬能充 Pro' }
  const label = editedLabel(dto, edit, 'company-a')
  assert.equal(label.id, dto.id); assert.equal(label.link, dto.qrLink)
  assert.equal(label.caseNumber, '短案號'); assert.equal(label.customerIssue, 'USB-C 無輸出')
  assert.equal(label.customerPhone, '未提供'); assert.equal(label.productName, '萬能充 Pro')
  assert.equal(dto.caseNumber, 'CASE-合成'); assert.equal(dto.customerPhone, '0912-345-678')
  assert.equal(edit.expectedVersion, dto.version)
})
test('label edits reject extra identity fields, duplicate/nonselected targets, stale metadata shapes and control text', async () => {
  const { normalizeLabelEdits } = await import('../src/pages/mailroom/mailroom-label.ts')
  const edit = { itemId, expectedVersion: 1, customerIssue: '測試' }
  for (const edits of [[{ ...edit, qrLink: 'https://forbidden.test' }], [{ ...edit, expectedVersion: 0 }], [{ ...edit, expectedVersion: '1' }], [{ ...edit, itemId: 'other' }], [edit, edit], [{ ...edit, customerName: 'x'.repeat(81) }], [{ ...edit, customerIssue: 'a\nb' }], [{ ...edit, customerPhone: null }]]) assert.throws(() => normalizeLabelEdits(edits as never, [itemId]))
})
test('editor starts with bounded single-line text from long or multiline case descriptions', async () => {
  const { labelEditFromData, normalizeLabelEdits } = await import('../src/pages/mailroom/mailroom-label.ts')
  const edit = labelEditFromData({ ...dto, caseNumber: 'CASE-' + 'x'.repeat(100), customerIssue: '第一行\n第二行\t' + '問題'.repeat(400) })
  assert.equal(edit.caseNumber?.length, 64); assert.equal(edit.customerIssue?.length, 300)
  assert.ok(!edit.customerIssue?.includes('\n')); assert.ok(!edit.customerIssue?.includes('\t'))
  assert.deepEqual(normalizeLabelEdits([edit], [itemId]), [edit])
})
