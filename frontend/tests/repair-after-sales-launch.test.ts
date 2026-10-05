import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { AFTER_SALES_READY_TIMEOUT_MS, AFTER_SALES_SOURCE_PATHS, afterSalesFrameFailure, createAfterSalesLaunchSession } from '../src/pages/repair/after-sales-launch'

const origin = 'https://aftersales-review---corely-erp-dev-sp5g377smq-de.a.run.app'
test('a slower previous section response cannot submit after a newer launch or unmount', async () => {
  const guard = createAfterSalesLaunchSession(), submitted: number[] = []
  let resolveOld!: () => void
  const old = guard.begin('cases', 'company')
  const response = new Promise<void>(resolve => { resolveOld = resolve }).then(() => { if (guard.isCurrent(old)) submitted.push(old.id) })
  const latest = guard.begin('quotes', 'company')
  if (guard.isCurrent(latest)) submitted.push(latest.id)
  resolveOld(); await response
  assert.deepEqual(submitted, [latest.id])
  assert.equal(guard.attach(old, {}), false)
  guard.invalidate()
  assert.equal(guard.isCurrent(latest), false)
  assert.equal(guard.attach(latest, {}), false)
  assert.equal(guard.timeout(latest), false)
})
test('a company change invalidates all old frame responses and old deadlines', () => {
  const guard = createAfterSalesLaunchSession(), oldFrame = {}, newFrame = {}
  const old = guard.begin('cases', 'company-a'); guard.attach(old, oldFrame)
  const current = guard.begin('cases', 'company-b'); guard.attach(current, newFrame)
  assert.equal(guard.attach(current, newFrame), false, 'repeated React ref attachment must not consume a login ticket twice')
  assert.notEqual(old.id, current.id)
  assert.equal(guard.ready(old, oldFrame, '/cases', origin + '/after-sales-app/cases', origin), 'ignored')
  assert.equal(guard.ready(current, oldFrame, '/cases', origin + '/after-sales-app/cases', origin), 'ignored')
  assert.equal(guard.fail(old), false)
  assert.equal(guard.timeout(old), false)
  assert.equal(current.phase, 'LOADING')
  assert.equal(guard.ready(current, newFrame, '/cases', origin + '/after-sales-app/cases', origin), 'ready')
})
test('initial readiness must prove the requested source page, mount, origin and query', () => {
  const guard = createAfterSalesLaunchSession(), frame = {}, attempt = guard.begin('shipping', 'company')
  guard.attach(attempt, frame)
  for (const [path, url] of [
    ['/dashboard', origin + '/after-sales-app/dashboard'],
    ['/cases', origin + '/after-sales-app/cases'],
    ['/cases', origin + '/cases?queue=warehouse'],
    ['/cases', 'https://source.example.invalid/after-sales-app/cases?queue=warehouse'],
    ['/cases', origin + '/after-sales-app/cases?queue=warehouse&error=denied'],
  ]) assert.equal(guard.ready(attempt, frame, path, url, origin), 'mismatch')
  assert.equal(attempt.phase, 'LOADING')
  assert.equal(guard.ready(attempt, frame, '/cases', origin + '/after-sales-app/cases?queue=warehouse', origin), 'ready')
  assert.equal(guard.timeout(attempt), false)
  // Once the initial entry is ready, original internal navigation remains usable.
  assert.equal(guard.ready(attempt, frame, '/cases/synthetic-case', origin + '/after-sales-app/cases/synthetic-case', origin), 'ignored')
  assert.equal(attempt.phase, 'READY')
})
test('an unhydrated HTML failure reaches a finite deadline and cannot later appear successful', () => {
  assert.ok(AFTER_SALES_READY_TIMEOUT_MS > 0 && AFTER_SALES_READY_TIMEOUT_MS <= 60_000)
  const guard = createAfterSalesLaunchSession(), frame = {}, attempt = guard.begin('cases', 'company')
  guard.attach(attempt, frame)
  assert.equal(afterSalesFrameFailure('<html>Internal Server Error</html>', 'text/html'), undefined)
  assert.equal(guard.timeout(attempt), true)
  assert.equal(guard.isCurrent(attempt), false)
  assert.equal(guard.ready(attempt, frame, '/cases', origin + '/after-sales-app/cases', origin), 'ignored')
  const retry = guard.begin('cases', 'company')
  assert.notEqual(retry.id, attempt.id)
  assert.equal(guard.attach(retry, {}), true)
})
test('JSON, plain-text proxy failure and Next error document expose a retryable error', () => {
  assert.equal(afterSalesFrameFailure('{"error":"權限已撤回"}', 'application/json'), '權限已撤回')
  assert.match(afterSalesFrameFailure('售後模組暫時無法連線') || '', /重新開啟/)
  assert.match(afterSalesFrameFailure('Bad Gateway', 'text/plain') || '', /重新開啟/)
  assert.match(afterSalesFrameFailure('Application error', 'text/html', true) || '', /重新開啟/)
  for (const text of ['', '{customer note}', '{"error":false}', '正常售後案件中心']) assert.equal(afterSalesFrameFailure(text, 'text/html'), undefined)
})
test('the browser entry checks cover exactly the fixed server source-section contract', () => {
  const source = readFileSync(new URL('../../backend/src/modules/integration/after-sales/erp-module.contract.ts', import.meta.url), 'utf8')
  const block = source.match(/export const SOURCE_SECTIONS = \{([\s\S]*?)\} as const/)?.[1]
  assert.ok(block)
  const entries = [...block.matchAll(/(?:^|,)\s*(?:'([^']+)'|([a-z][a-z-]*))\s*:\s*'([^']+)'/g)].map(match => [match[1] || match[2], match[3]])
  assert.deepEqual(Object.fromEntries(entries), AFTER_SALES_SOURCE_PATHS)
  for (const section of ['unknown', 'constructor', '__proto__']) assert.throws(() => createAfterSalesLaunchSession().begin(section, 'company'), /不存在/)
})
