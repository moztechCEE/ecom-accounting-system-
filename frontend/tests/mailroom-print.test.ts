import assert from 'node:assert/strict'
import test from 'node:test'
import { createMailroomDirectPrint, getSelectedPrinter, setSelectedPrinter } from '../src/services/mailroom-print.ts'
import type { PrintApi, PrinterScope } from '../src/services/mailroom-print.ts'
import { MailroomPrintBlockedError } from '../src/pages/mailroom/mailroom-label.ts'

const itemA = '11111111-2222-4333-8444-555555555555', itemB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const deviceId = '22222222-2222-4222-8222-222222222222', jobId = '33333333-3333-4333-8333-333333333333'
const scope: PrinterScope = { apiUrl: 'https://api.example.test/api/v1', entityId: 'company-a', userId: 'clerk-a' }
const request = (itemIds = [itemA], signal = new AbortController().signal) => ({ entityId: scope.entityId, itemIds, requestId: crypto.randomUUID(), signal })
function storage() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
function fixture() {
  const local = storage(), session = storage(), gets: string[] = [], posts: unknown[] = []
  let online = true, postError: unknown, getError: unknown, existing: unknown
  let hold: (() => Promise<void>) | undefined
  const api = {
    async get(path: string) { gets.push(path); if (getError) throw getError; if (path !== '/mailroom/print-devices' && !existing) throw { response: { status: 404 } }; return { data: path === '/mailroom/print-devices' ? { devices: [{ id: deviceId, name: '合成標籤機', online, owned: true }] } : existing } },
    async post(_path: string, body: { requestId: string; deviceId: string }) { posts.push(body); if (hold) await hold(); if (postError) throw postError; const value = { id: jobId, status: 'QUEUED', requestId: body.requestId, deviceId: body.deviceId }; existing = value; return { data: value } },
  } as unknown as PrintApi
  setSelectedPrinter(scope, deviceId, local)
  const direct = () => createMailroomDirectPrint({ scope, api, local, session })
  return { local, session, gets, posts, api, direct, setOnline: (value: boolean) => { online = value }, setPostError: (value: unknown) => { postError = value }, setGetError: (value: unknown) => { getError = value }, setExisting: (value: unknown) => { existing = value }, setHold: (value: () => Promise<void>) => { hold = value } }
}

test('printer selection is JSON guarded and isolated by API/company/user, with no token or pairing code', () => {
  const local = storage()
  setSelectedPrinter(scope, deviceId, local)
  assert.equal(getSelectedPrinter(scope, local), deviceId)
  for (const changed of [{ ...scope, apiUrl: 'https://other.test/api/v1' }, { ...scope, entityId: 'company-b' }, { ...scope, userId: 'clerk-b' }]) assert.equal(getSelectedPrinter(changed, local), null)
  assert.deepEqual(JSON.parse([...local.values.values()][0]), { version: 1, deviceId })
  const key = [...local.values.keys()][0]
  for (const malformed of ['bad json', JSON.stringify({ version: 2, deviceId }), JSON.stringify({ version: 1, deviceId, token: 'not-allowed' }), JSON.stringify({ version: 1, deviceId: 'invalid' })]) { local.setItem(key, malformed); assert.equal(getSelectedPrinter(scope, local), null) }
  assert.throws(() => setSelectedPrinter(scope, 'invalid', local), MailroomPrintBlockedError)
})
test('missing selection, offline printer, unauthorized preflight and invalid user block before creating any job', async () => {
  for (const mode of ['none', 'offline', 'unauthorized', 'user']) {
    const f = fixture()
    if (mode === 'none') setSelectedPrinter(scope, null, f.local)
    if (mode === 'offline') f.setOnline(false)
    if (mode === 'unauthorized') f.setGetError({ response: { status: 403 } })
    const direct = mode === 'user' ? createMailroomDirectPrint({ scope: { ...scope, userId: '' }, api: f.api, local: f.local, session: f.session }) : f.direct()
    await assert.rejects(direct(request()), MailroomPrintBlockedError)
    assert.equal(f.posts.length, 0)
    assert.equal(f.session.values.size, 0)
  }
})
test('row and batch factories share an overlap lock and preserve independent accepted pending receipts', async () => {
  const f = fixture(); let release!: () => void
  f.setHold(() => new Promise<void>(resolve => { release = resolve }))
  const first = f.direct()(request())
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(f.direct()(request([itemA, itemB])), /正在送出/)
  assert.equal(f.posts.length, 1)
  release(); assert.deepEqual(await first, { status: 'accepted', jobId })
  f.setHold(async () => {})
  assert.equal((await f.direct()(request([itemB]))).status, 'accepted')
  const saved = JSON.parse([...f.session.values.values()][0])
  assert.equal(saved.length, 2)
  assert.ok(saved.every((value: Record<string, unknown>) => Object.keys(value).every(key => ['requestId', 'deviceId', 'itemIds', 'createdAt', 'jobId'].includes(key))))
})
test('unknown requests persist and subsequent clicks only query the original request without POST retry', async () => {
  const f = fixture(); f.setPostError(new Error('Synthetic network timeout'))
  const original = request()
  assert.equal((await f.direct()(original)).status, 'unknown')
  assert.equal(f.posts.length, 1)
  assert.equal(f.gets.filter(path => path.includes('/by-request/')).length, 1)
  assert.equal((await f.direct()(request())).status, 'unknown')
  assert.equal(f.posts.length, 1)
  f.setExisting({ id: jobId, requestId: original.requestId, deviceId, status: 'QUEUED' })
  assert.deepEqual(await f.direct()(request()), { status: 'accepted', jobId })
  await assert.rejects(f.direct()(request()), /已有列印工作/)
  assert.equal(f.posts.length, 1)
})
test('409 conflict resolves by the original request exactly once and does not repost', async () => {
  const f = fixture(), original = request()
  f.setPostError({ response: { status: 409 } }); f.setExisting({ id: jobId, requestId: original.requestId, deviceId, status: 'CLAIMED' })
  assert.deepEqual(await f.direct()(original), { status: 'accepted', jobId })
  assert.equal(f.posts.length, 1)
  assert.equal(f.gets.filter(path => path.includes('/by-request/')).length, 1)
})
test('aborted submissions remain pending and cannot be resent from a new component', async () => {
  const f = fixture(), controller = new AbortController(); let release!: () => void
  f.setHold(() => new Promise<void>(resolve => { release = resolve })); f.setPostError(new Error('Synthetic aborted response'))
  const first = f.direct()(request([itemA], controller.signal))
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); release()
  assert.equal((await first).status, 'unknown'); assert.equal(f.posts.length, 1)
  assert.equal(f.gets.filter(path => path.includes('/by-request/')).length, 0)
  assert.equal((await f.direct()(request())).status, 'unknown'); assert.equal(f.posts.length, 1)
})
test('definite invalid requests unlock without a pending record; auth rejections preserve readback but show a precise blocker', async () => {
  for (const status of [400, 401, 403]) {
    const f = fixture(); f.setPostError({ response: { status } })
    await assert.rejects(f.direct()(request()), MailroomPrintBlockedError)
    assert.equal(f.posts.length, 1)
    const records = JSON.parse([...f.session.values.values()][0])
    assert.equal(records.length, status === 400 ? 0 : 1)
  }
})
test('unusable storage and tampered receipts fail closed; failed jobs never trigger an automatic reprint', async () => {
  const f = fixture(), original = request(); f.setPostError(new Error('Synthetic lost response'))
  f.setExisting({ id: jobId, requestId: crypto.randomUUID(), deviceId, status: 'QUEUED' })
  assert.equal((await f.direct()(original)).status, 'unknown')
  f.setExisting({ id: jobId, requestId: original.requestId, deviceId, status: 'FAILED' })
  await assert.rejects(f.direct()(request()), /列印工作未完成/); assert.equal(f.posts.length, 1)
  assert.equal(JSON.parse([...f.session.values.values()][0]).length, 0)
  const bad = fixture(); bad.session.setItem('unused', 'unused'); bad.session.setItem = () => { throw Error('Synthetic storage failure') }
  await assert.rejects(bad.direct()(request()), /無法保存/); assert.equal(bad.posts.length, 0)
})

test('confirmed submitted and failed receipts retire pending state without a same-click POST; a later manual click can print', async () => {
  for (const status of ['SUBMITTED', 'FAILED']) {
    const f = fixture(), original = request()
    await f.direct()(original)
    f.setExisting({ id: jobId, requestId: original.requestId, deviceId, status })
    const before = f.posts.length
    if (status === 'SUBMITTED') {
      const result = await f.direct()(request())
      assert.equal(result.status, 'accepted')
      assert.equal(result.jobId, jobId)
      assert.match(result.message || '', /再次按列印可重新列印/)
    } else await assert.rejects(f.direct()(request()), /核對印表機後再按列印/)
    assert.equal(f.posts.length, before)
    assert.equal(JSON.parse([...f.session.values.values()][0]).length, 0)
    assert.equal((await f.direct()(request())).status, 'accepted')
    assert.equal(f.posts.length, before + 1)
  }
})
test('a full 100-job session reclaims only verified safe terminal jobs before admitting a distinct new item', async () => {
  const f = fixture()
  await f.direct()(request())
  const pendingKey = [...f.session.values.keys()][0]
  const records = Array.from({ length: 100 }, (_, index) => ({ requestId: crypto.randomUUID(), deviceId, itemIds: ['00000000-0000-4000-8000-' + String(index).padStart(12, '0')], createdAt: new Date().toISOString(), jobId }))
  f.session.setItem(pendingKey, JSON.stringify(records))
  const readRequests: string[] = []
  f.api.get = async path => {
    if (path === '/mailroom/print-devices') return { data: { devices: [{ id: deviceId, name: '合成標籤機', online: true, owned: true }] } }
    const record = records.find(value => path.endsWith(value.requestId))
    assert.ok(record); readRequests.push(record.requestId)
    return { data: { ...record, id: jobId, status: record.requestId === records[0].requestId ? 'UNKNOWN' : 'SUBMITTED', customerName: '禁止儲存姓名', customerPhone: '0912-SECRET', customerIssue: '禁止儲存問題', token: 'secret-token' } }
  }
  const before = f.posts.length
  assert.equal((await f.direct()(request([itemB]))).status, 'accepted')
  const pending = JSON.parse(f.session.getItem(pendingKey) || '[]')
  assert.ok(pending.length <= 100)
  assert.ok(pending.some((value: { requestId: string }) => value.requestId === records[0].requestId), 'UNKNOWN must remain locked')
  assert.equal(f.posts.length, before + 1)
  assert.ok(readRequests.length > 0 && readRequests.length <= 5)
  const serialized = [...f.session.values.values()].join('')
  for (const forbidden of ['customerName', 'customerPhone', 'customerIssue', '0912-SECRET', 'secret-token', 'pairCode']) assert.ok(!serialized.includes(forbidden), forbidden)
})
test('100 unresolved jobs remain protected, and missing creation job IDs get one lookup without an automatic retry', async () => {
  const f = fixture()
  await f.direct()(request())
  const pendingKey = [...f.session.values.keys()][0]
  const records = Array.from({ length: 100 }, (_, index) => ({ requestId: crypto.randomUUID(), deviceId, itemIds: ['00000000-0000-4000-8000-' + String(index).padStart(12, '0')], createdAt: new Date().toISOString() }))
  f.session.setItem(pendingKey, JSON.stringify(records))
  f.api.get = async path => {
    if (path === '/mailroom/print-devices') return { data: { devices: [{ id: deviceId, name: '合成標籤機', online: true, owned: true }] } }
    const record = records.find(value => path.endsWith(value.requestId)); assert.ok(record)
    return { data: { ...record, id: jobId, status: 'UNKNOWN' } }
  }
  await assert.rejects(f.direct()(request([itemB])), /100 筆/)
  assert.equal(f.posts.length, 1)
  assert.equal(JSON.parse(f.session.getItem(pendingKey) || '[]').length, 100)
  const missing = fixture()
  missing.api.post = async (_path, body) => { missing.posts.push(body); return { data: { status: 'QUEUED' } } }
  assert.equal((await missing.direct()(request())).status, 'unknown')
  assert.equal(missing.posts.length, 1)
  assert.equal(missing.gets.filter(path => path.includes('/by-request/')).length, 1)
})
test('only an explicit POST 409 followed by an authorized same-request 404 retires a phantom request', async () => {
  for (const readback of [404, 401, 403, 500, 'timeout']) {
    const f = fixture(); f.setPostError({ response: { status: 409 } })
    const originalGet = f.api.get
    f.api.get = async (path, config) => {
      if (path.includes('/by-request/')) {
        f.gets.push(path)
        if (readback === 'timeout') throw new Error('Synthetic timeout')
        throw { response: { status: readback } }
      }
      return originalGet(path, config)
    }
    if (readback === 404) await assert.rejects(f.direct()(request()), /待原工作結束後再按列印/)
    else assert.equal((await f.direct()(request())).status, 'unknown')
    assert.equal(f.posts.length, 1)
    assert.equal(f.gets.filter(path => path.includes('/by-request/')).length, 1)
    assert.equal(JSON.parse([...f.session.values.values()][0]).length, readback === 404 ? 0 : 1)
  }
  const timedOut = fixture(); timedOut.setPostError(new Error('Synthetic POST timeout'))
  assert.equal((await timedOut.direct()(request())).status, 'unknown')
  assert.equal(JSON.parse([...timedOut.session.values.values()][0]).length, 1)
  assert.equal(timedOut.posts.length, 1)
})

test('edited print payload is passed once while session receipts contain only an opaque content hash', async () => {
  const f = fixture()
  const edit = { itemId: itemA, expectedVersion: 12, customerName: ' 合成姓名 ', customerPhone: '0900-SECRET', productName: '萬能充 Pro', customerIssue: ' USB-C   無法輸出 ', caseNumber: '短案號' }
  await f.direct()({ ...request(), labelEdits: [edit] })
  assert.equal(f.posts.length, 1)
  assert.deepEqual((f.posts[0] as { labelEdits: unknown }).labelEdits, [{ itemId: itemA, expectedVersion: 12, caseNumber: '短案號', customerName: '合成姓名', customerPhone: '0900-SECRET', productName: '萬能充 Pro', customerIssue: 'USB-C 無法輸出' }])
  const serialized = [...f.session.values.values()].join(''), record = JSON.parse(serialized)[0]
  assert.match(record.contentHash, /^[0-9a-f]{64}$/)
  for (const value of ['合成姓名', '0900-SECRET', '短案號', 'customerName', 'customerPhone', 'customerIssue', 'labelEdits']) assert.ok(!serialized.includes(value), value)
})
test('different edited text reconciles an older terminal job without swallowing the edit or creating a same-click reprint', async () => {
  const f = fixture(), original = request()
  await f.direct()(original)
  f.setExisting({ id: jobId, requestId: original.requestId, deviceId, status: 'SUBMITTED' })
  const edited = { ...request(), labelEdits: [{ itemId: itemA, expectedVersion: 12, customerIssue: '新的精簡內容' }] }
  await assert.rejects(f.direct()(edited), /已查詢上筆列印結果/)
  assert.equal(f.posts.length, 1)
  assert.equal(JSON.parse([...f.session.values.values()][0]).length, 0)
  await f.direct()({ ...edited, requestId: crypto.randomUUID() })
  assert.equal(f.posts.length, 2)
  assert.equal((f.posts[1] as { labelEdits: { customerIssue: string }[] }).labelEdits[0].customerIssue, '新的精簡內容')
})
test('changed edits cannot bypass UNKNOWN or active work, while canonical equivalent edits resolve only their existing job', async () => {
  const f = fixture(), first = { ...request(), labelEdits: [{ itemId: itemA, expectedVersion: 12, customerIssue: ' USB   故障 ' }] }
  await f.direct()(first)
  f.setExisting({ id: jobId, requestId: first.requestId, deviceId, status: 'UNKNOWN' })
  await assert.rejects(f.direct()({ ...request(), labelEdits: [{ itemId: itemA, expectedVersion: 12, customerIssue: '另一次內容' }] }), /已查詢上筆/)
  assert.equal(f.posts.length, 1); assert.equal(JSON.parse([...f.session.values.values()][0]).length, 1)
  f.setExisting({ id: jobId, requestId: first.requestId, deviceId, status: 'SUBMITTED' })
  const result = await f.direct()({ ...request(), labelEdits: [{ customerIssue: 'USB 故障', expectedVersion: 12, itemId: itemA }] })
  assert.equal(result.status, 'accepted'); assert.equal(f.posts.length, 1)
})
test('bounded job observation shows actual server stages and stops without issuing any second print POST', async () => {
  const f = fixture(), stages: string[] = [], originalGet = f.api.get
  let reads = 0
  f.api.get = async (path, config) => {
    if (path.includes('/by-request/')) {
      reads++
      const body = f.posts[0] as { requestId: string }
      return { data: { id: jobId, requestId: body.requestId, deviceId, status: reads === 1 ? 'SUBMITTING' : 'SUBMITTED' } }
    }
    return originalGet(path, config)
  }
  const result = await f.direct()({ ...request(), onProgress: value => stages.push(value) })
  assert.deepEqual(stages, ['製作標籤', '等待電腦接收', '印表機處理中', '已送至印表機'])
  assert.equal(result.status, 'accepted'); assert.equal(result.message, '已送至印表機')
  assert.equal(f.posts.length, 1); assert.equal(reads, 2)
  assert.equal(JSON.parse([...f.session.values.values()][0]).length, 0)
})
test('stale edited version gets an exact reload blocker only after an authorized no-job readback', async () => {
  for (const readStatus of [404, 403]) {
    const f = fixture()
    f.setPostError({ response: { status: 409, data: { code: 'LABEL_VERSION_CHANGED' } } })
    const get = f.api.get
    f.api.get = async (path, config) => {
      if (path.includes('/by-request/')) { f.gets.push(path); throw { response: { status: readStatus } } }
      return get(path, config)
    }
    const edited = { ...request(), labelEdits: [{ itemId: itemA, expectedVersion: 12, customerIssue: '短摘要' }] }
    if (readStatus === 404) await assert.rejects(f.direct()(edited), /物件已更新，請重新開啟標籤編輯/)
    else assert.equal((await f.direct()(edited)).status, 'unknown')
    assert.equal(f.posts.length, 1); assert.equal(f.gets.filter(path => path.includes('/by-request/')).length, 1)
    assert.equal(JSON.parse([...f.session.values.values()][0]).length, readStatus === 404 ? 0 : 1)
  }
})
test('PDF error blobs decode only bounded JSON and preserve the exact stale-editor message', async () => {
  const { previewErrorText } = await import('../src/services/mailroom-print.ts')
  assert.equal(await previewErrorText({ response: { status: 409, data: new Blob([JSON.stringify({ code: 'LABEL_VERSION_CHANGED' })], { type: 'application/json' }) } }), '物件已更新，請重新開啟標籤編輯')
  for (const data of [new Blob(['not json'], { type: 'application/json' }), new Blob(['x'.repeat(8193)], { type: 'application/json' }), new Blob(['<html>'], { type: 'text/html' })]) assert.equal(await previewErrorText({ response: { status: 409, data } }), '標籤資料已更新，請重新開啟標籤編輯')
})
