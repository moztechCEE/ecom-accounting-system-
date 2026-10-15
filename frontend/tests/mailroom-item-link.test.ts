import assert from 'node:assert/strict'
import test from 'node:test'
import { itemLoginPath, parsePhysicalItemScan, physicalItemLink, safeItemReturnTo } from '../src/utils/mailroom-item-link.ts'

const entityId = 'doa-dev-qa-20261002', itemId = '8c9bba2e-6fe7-4602-bf29-7df4a932ee6c', origin = 'https://dev.example.test'
const path = '/operations/repair?' + new URLSearchParams({ entityId, itemId, queue: 'all' })
test('a physical label returns to exactly the same item and company after unauthenticated or expired login', () => {
  assert.equal(physicalItemLink(origin, entityId, itemId), origin + path)
  assert.equal(safeItemReturnTo(path, entityId), path)
  const login = itemLoginPath({ pathname: '/operations/repair', search: path.slice(path.indexOf('?')) })
  assert.equal(new URL(login, origin).searchParams.get('returnTo'), path)
  assert.equal(safeItemReturnTo(new URL(login, origin).searchParams.get('returnTo'), entityId), path)
})
test('first-password-change preserves only the validated item target through mandatory logout and another login', () => {
  const password = '/auth/change-password?' + new URLSearchParams({ returnTo: path })
  const url = new URL(password, origin)
  assert.equal(itemLoginPath(url), '/login?' + new URLSearchParams({ returnTo: path }))
  assert.equal(safeItemReturnTo(new URL(itemLoginPath(url), origin).searchParams.get('returnTo')), path)
  assert.equal(itemLoginPath({ pathname: '/dashboard', search: '' }), '/login')
})
test('external destinations, non-item paths and query injection cannot become a login return target', () => {
  for (const raw of ['https://evil.test' + path, '//evil.test' + path, '/%2f%2fevil.test', '/operations/repair/extra?entityId=' + entityId + '&itemId=' + itemId,
    path + '&returnTo=https://evil.test', path + '&itemId=' + itemId, path + '&entityId=other-company', path + '#https://evil.test', path + '&queue=mine', path.replace('repair', 'after-sales/workbench'),
    '/operations/repair?entityId=' + entityId + '&itemId=javascript%3Aalert(1)', '/operations/repair?entityId=' + entityId + '&itemId=' + itemId + '%00', path.replace('/operations/', '/operations/\\'), path + '\n']) {
    assert.equal(safeItemReturnTo(raw), null, raw)
  }
  assert.equal(safeItemReturnTo(path, 'other-company'), null)
})
test('hardware scanner accepts only a same-origin item URL or exact native UUID within the current company', () => {
  assert.deepEqual(parsePhysicalItemScan(origin + path, origin, entityId), { itemId, entityId, path })
  assert.deepEqual(parsePhysicalItemScan(itemId, origin, entityId), { itemId, entityId, path })
  assert.equal(parsePhysicalItemScan(origin + path, origin, 'other-company'), null)
  assert.equal(parsePhysicalItemScan('https://evil.test' + path, origin, entityId), null)
  assert.equal(parsePhysicalItemScan('SN-0123456789', origin, entityId), null)
  assert.equal(parsePhysicalItemScan('javascript:alert(1)', origin, entityId), null)
  assert.equal(parsePhysicalItemScan(origin + path + '&itemId=' + itemId, origin, entityId), null)
})
test('invalid label identities fail instead of generating a different item, company or origin', () => {
  assert.throws(() => physicalItemLink(origin, entityId, 'SKU-1'))
  assert.throws(() => physicalItemLink(origin, '', itemId))
  assert.throws(() => physicalItemLink('javascript:alert(1)', entityId, itemId))
  assert.notEqual(physicalItemLink(origin, entityId, itemId), physicalItemLink(origin, entityId, '7eb7d3e2-034f-438d-9194-e7c0d03ec508'))
})
