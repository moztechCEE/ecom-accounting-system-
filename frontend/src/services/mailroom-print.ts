import { MailroomPrintBlockedError, normalizeLabelEdits } from '../pages/mailroom/mailroom-label.ts'
import type { DirectLabelPrint } from '../pages/mailroom/mailroom-label.ts'

export type PrinterScope = { apiUrl: string; entityId: string; userId: string }
export type PrinterDevice = { id: string; name: string; online: boolean; owned: boolean }
export type PrintJob = { id: string; requestId: string; deviceId: string; status: 'QUEUED' | 'CLAIMED' | 'SUBMITTING' | 'SUBMITTED' | 'FAILED' | 'UNKNOWN' }
export type PrintApi = {
  get<T>(path: string, config: { params: { entityId: string }; signal?: AbortSignal }): Promise<{ data: T }>;
  post<T>(path: string, body: unknown, config?: { signal?: AbortSignal }): Promise<{ data: T }>;
}
export type PrinterStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type PendingPrint = { requestId: string; deviceId: string; itemIds: string[]; createdAt: string; jobId?: string; contentHash?: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const states = new Set(['QUEUED', 'CLAIMED', 'SUBMITTING', 'SUBMITTED', 'FAILED', 'UNKNOWN'])
const locks = new Map<string, Set<string>>()
const plain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const validId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const key = (scope: PrinterScope, kind: string) => 'corely.mailroom.' + kind + '.v1:' + encodeURIComponent(JSON.stringify([scope.apiUrl.replace(/\/+$/, ''), scope.entityId, scope.userId]))
const overlaps = (left: string[], right: string[]) => left.some(id => right.includes(id))
const versionChanged = (error: unknown) => plain(error) && plain(error.response) && plain(error.response.data) && error.response.data.code === 'LABEL_VERSION_CHANGED'
const statusCode = (error: unknown) => plain(error) && plain(error.response) && typeof error.response.status === 'number' ? error.response.status : undefined

export function printerErrorText(error: unknown): string {
  const status = statusCode(error)
  if (status === 409 && versionChanged(error)) return '物件已更新，請重新開啟標籤編輯'
  if (status === 401) return '登入已失效，請重新登入'
  if (status === 403) return '沒有使用標籤印表機的權限'
  if (status === 404 || status === 503) return '目前環境尚未啟用標籤列印服務'
  if (status === 409) return '列印工作已存在，請先核對工作紀錄'
  if (status === 400 || status === 422) return '列印資料不完整，請重新選取'
  return '無法連線至標籤列印服務'
}
export async function previewErrorText(error: unknown): Promise<string> {
  if (plain(error) && plain(error.response)) {
    const data = error.response.data
    if (data instanceof Blob && data.size <= 8192 && ['application/json', 'application/problem+json'].includes(data.type.split(';')[0].trim().toLowerCase())) {
      try { const decoded = { response: { status: error.response.status, data: JSON.parse(await data.text()) } }; if (versionChanged(decoded)) return printerErrorText(decoded) }
      catch { /* A malformed error cannot supply a trusted version code. */ }
    }
    if (error.response.status === 409) return '標籤資料已更新，請重新開啟標籤編輯'
  }
  return printerErrorText(error)
}
export function getSelectedPrinter(scope: PrinterScope, storage: PrinterStorage): string | null {
  try {
    const raw = storage.getItem(key(scope, 'printer'))
    if (!raw || raw.length > 200) return null
    const value: unknown = JSON.parse(raw)
    return plain(value) && value.version === 1 && Object.keys(value).every(field => ['version', 'deviceId'].includes(field)) && validId(value.deviceId) ? value.deviceId : null
  } catch { return null }
}
export function setSelectedPrinter(scope: PrinterScope, deviceId: string | null, storage: PrinterStorage): void {
  if (!scope.apiUrl || !scope.entityId || !scope.userId || (deviceId !== null && !validId(deviceId))) throw new MailroomPrintBlockedError('請重新選擇標籤印表機')
  try {
    if (deviceId) storage.setItem(key(scope, 'printer'), JSON.stringify({ version: 1, deviceId }))
    else storage.removeItem(key(scope, 'printer'))
  } catch { throw new MailroomPrintBlockedError('無法保存印表機設定，請檢查瀏覽器儲存空間') }
}
export function printerDevices(value: unknown): PrinterDevice[] {
  if (!plain(value) || !Array.isArray(value.devices) || value.devices.length > 200 || !value.devices.every(device => plain(device) && validId(device.id) && typeof device.name === 'string' && device.name.length <= 40 && typeof device.online === 'boolean' && typeof device.owned === 'boolean')) {
    throw new MailroomPrintBlockedError('印表機資料不完整，請重新載入')
  }
  return value.devices.map(device => ({ id: device.id, name: device.name, online: device.online, owned: device.owned }))
}
function readPending(scope: PrinterScope, storage: PrinterStorage): PendingPrint[] {
  try {
    const raw = storage.getItem(key(scope, 'print-pending'))
    if (!raw) return []
    if (raw.length > 150000) throw Error()
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.length > 100 || !value.every(record => plain(record) && Object.keys(record).every(field => ['requestId', 'deviceId', 'itemIds', 'createdAt', 'jobId', 'contentHash'].includes(field)) && validId(record.requestId) && validId(record.deviceId) && Array.isArray(record.itemIds) && record.itemIds.length > 0 && record.itemIds.length <= 50 && record.itemIds.every(validId) && typeof record.createdAt === 'string' && Number.isFinite(Date.parse(record.createdAt)) && (record.jobId === undefined || validId(record.jobId)) && (record.contentHash === undefined || typeof record.contentHash === 'string' && /^[0-9a-f]{64}$/.test(record.contentHash)))) throw Error()
    return value as PendingPrint[]
  } catch { throw new MailroomPrintBlockedError('本機列印紀錄無法讀取，請先核對工作紀錄') }
}
function writePending(scope: PrinterScope, storage: PrinterStorage, values: PendingPrint[]) {
  try { storage.setItem(key(scope, 'print-pending'), JSON.stringify(values)) }
  catch { throw new MailroomPrintBlockedError('無法保存列印工作紀錄，請檢查瀏覽器儲存空間') }
}
function validJob(value: unknown, pending: PendingPrint): value is PrintJob {
  return plain(value) && validId(value.id) && value.requestId === pending.requestId && value.deviceId === pending.deviceId && typeof value.status === 'string' && states.has(value.status)
}
const unknown = (message = '列印結果尚未確認，請先核對印表機及工作紀錄') => ({ status: 'unknown' as const, message })

export function createMailroomDirectPrint({ scope, api, local, session }: {
  scope: PrinterScope; api: PrintApi; local: PrinterStorage; session: PrinterStorage;
}): DirectLabelPrint {
  return async request => {
    if (!scope.apiUrl || !scope.userId || !scope.entityId || request.entityId !== scope.entityId || request.signal.aborted || !validId(request.requestId)) throw new MailroomPrintBlockedError('請重新登入後再列印')
    const ids = [...new Set(request.itemIds)]
    if (!ids.length || ids.length > 50 || !ids.every(validId)) throw new MailroomPrintBlockedError('請重新選取要列印的實物')
    const labelEdits = normalizeLabelEdits(request.labelEdits, ids)
    const contentHash = labelEdits?.length ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ itemIds: [...ids].sort(), labelEdits })))), byte => byte.toString(16).padStart(2, '0')).join('') : undefined
    if (request.signal.aborted) throw new MailroomPrintBlockedError('列印已取消')
    const lockKey = key(scope, 'print-lock'), held = locks.get(lockKey) || new Set<string>()
    if (ids.some(id => held.has(id))) throw new MailroomPrintBlockedError('這些標籤正在送出，請稍候')
    ids.forEach(id => held.add(id)); locks.set(lockKey, held)
    const params = { entityId: scope.entityId }
    function progress(status: string) { if (!request.signal.aborted) request.onProgress?.(status === 'SUBMITTED' ? '已送至印表機' : status === 'SUBMITTING' ? '印表機處理中' : '等待電腦接收') }
    async function inspect(pending: PendingPrint, signal = request.signal) {
      const response = await api.get<unknown>('/mailroom/print-jobs/by-request/' + pending.requestId, { params, signal })
      return !signal.aborted && validJob(response.data, pending) ? response.data : undefined
    }
    function remove(pending: PendingPrint) {
      writePending(scope, session, readPending(scope, session).filter(value => value.requestId !== pending.requestId))
    }
    async function resolve(pending: PendingPrint, confirmedConflict = false) {
      if (request.signal.aborted) return unknown()
      try {
        const job = await inspect(pending)
        if (!job) return unknown()
        progress(job.status)
        if (job.status === 'SUBMITTED' || job.status === 'FAILED') {
          remove(pending)
          if (job.status === 'FAILED') throw new MailroomPrintBlockedError('列印工作未完成，請核對印表機後再按列印')
          return { status: 'accepted' as const, jobId: job.id, message: '已送至印表機工作佇列；再次按列印可重新列印' }
        }
        const values = readPending(scope, session).map(value => value.requestId === pending.requestId ? { ...value, jobId: job.id } : value)
        writePending(scope, session, values)
        if (['QUEUED', 'CLAIMED', 'SUBMITTING'].includes(job.status)) return { status: 'accepted' as const, jobId: job.id }
        return unknown()
      } catch (error) {
        if (confirmedConflict && !request.signal.aborted && statusCode(error) === 404) {
          remove(pending)
          throw new MailroomPrintBlockedError('已有列印工作，請待原工作結束後再按列印')
        }
        if (error instanceof MailroomPrintBlockedError) throw error
        return unknown()
      }
    }
    async function reclaimTerminal(records: PendingPrint[]) {
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(4, records.length) }, async () => {
        while (cursor < records.length && !request.signal.aborted && readPending(scope, session).length >= 100) {
          const pending = records[cursor++]
          try {
            const job = await inspect(pending)
            if (job && (job.status === 'SUBMITTED' || job.status === 'FAILED')) remove(pending)
          } catch { /* Unknown or inaccessible results remain pending. */ }
        }
      }))
    }
    try {
      const previous = readPending(scope, session), pending = previous.filter(value => overlaps(ids, value.itemIds))
      if (pending.length) {
        // Reconcile the original request only. A new click never recreates its job.
        const result = await resolve(pending[0])
        if (pending[0].contentHash !== contentHash) throw new MailroomPrintBlockedError('已查詢上筆列印結果；請先確認上筆完成，再按「列印這張標籤」送出本次編輯')
        if (pending.length > 1) return unknown('選取的標籤已有多筆列印工作，請先核對工作紀錄')
        if (pending[0].itemIds.length !== ids.length || !pending[0].itemIds.every(id => ids.includes(id))) throw new MailroomPrintBlockedError('部分標籤已有列印工作，請先核對工作紀錄')
        if (result.status === 'accepted' && pending[0].jobId && readPending(scope, session).some(value => value.requestId === pending[0].requestId)) throw new MailroomPrintBlockedError('標籤已有列印工作，請先核對工作紀錄')
        return result
      }
      const deviceId = getSelectedPrinter(scope, local)
      if (!deviceId) throw new MailroomPrintBlockedError('請先設定標籤印表機')
      let devices: PrinterDevice[]
      try { devices = printerDevices((await api.get<unknown>('/mailroom/print-devices', { params, signal: request.signal })).data) }
      catch (error) { throw error instanceof MailroomPrintBlockedError ? error : new MailroomPrintBlockedError(printerErrorText(error)) }
      if (request.signal.aborted) throw new MailroomPrintBlockedError('列印已取消')
      const device = devices.find(value => value.id === deviceId)
      if (!device) throw new MailroomPrintBlockedError('印表機尚未完成配對或已撤銷，請重新設定')
      if (!device.online) throw new MailroomPrintBlockedError('標籤印表機目前離線')
      if (previous.length >= 100) await reclaimTerminal(previous)
      if (request.signal.aborted) throw new MailroomPrintBlockedError('列印已取消')
      if (readPending(scope, session).length >= 100) throw new MailroomPrintBlockedError('已有 100 筆尚未確認完成的列印工作，請先核對印表機')
      const record: PendingPrint = { requestId: request.requestId, deviceId, itemIds: ids, createdAt: new Date().toISOString(), ...(contentHash ? { contentHash } : {}) }
      writePending(scope, session, [...readPending(scope, session), record])
      if (request.signal.aborted) {
        writePending(scope, session, readPending(scope, session).filter(value => value.requestId !== record.requestId))
        throw new MailroomPrintBlockedError('列印已取消')
      }
      if (!request.signal.aborted) request.onProgress?.('製作標籤')
      let response: { data: unknown }
      try {
        response = await api.post<unknown>('/mailroom/print-jobs', { ...params, deviceId, requestId: record.requestId, itemIds: ids, ...(labelEdits?.length ? { labelEdits } : {}) }, { signal: request.signal })
      } catch (error) {
        const status = statusCode(error)
        if (status === 409 && versionChanged(error)) {
          try { if (await inspect(record)) return await resolve(record) }
          catch (readError) {
            if (statusCode(readError) === 404) { remove(record); throw new MailroomPrintBlockedError(printerErrorText(error)) }
          }
          return unknown('物件已更新；請先查詢本次列印結果，再重新開啟標籤編輯')
        }
        // Only definite validation/not-found rejections discard this never-created request.
        // Auth changes, timeouts and aborts keep the original receipt for readback.
        if ([400, 404, 410, 422].includes(status || 0)) {
          writePending(scope, session, readPending(scope, session).filter(value => value.requestId !== record.requestId))
          throw new MailroomPrintBlockedError(printerErrorText(error))
        }
        if (status === 401 || status === 403) { await resolve(record); throw new MailroomPrintBlockedError(printerErrorText(error)) }
        return await resolve(record, status === 409)
      }
      if (!request.signal.aborted && validJob(response.data, record) && response.data.status === 'QUEUED') {
        const job = response.data
        try { writePending(scope, session, readPending(scope, session).map(value => value.requestId === record.requestId ? { ...value, jobId: job.id } : value)) }
        catch { return unknown('工作已建立，但本機紀錄尚未確認，請先核對工作紀錄') }
        progress(job.status)
        // Observe this already-created job for a bounded period. No readback can
        // recreate a job, including after a lost response or scope cancellation.
        if (request.onProgress) {
          const deadline = Date.now() + 12000
          for (const delay of [0, 500, 1000, 1500, 2000, 3000]) {
            if (request.signal.aborted || Date.now() >= deadline) break
            if (delay) await new Promise<void>(resolve => {
              const done = () => { clearTimeout(timer); request.signal.removeEventListener('abort', done); resolve() }
              const timer = setTimeout(done, Math.min(delay, Math.max(0, deadline - Date.now()))); request.signal.addEventListener('abort', done, { once: true })
            })
            if (request.signal.aborted) break
            try {
              const remaining = deadline - Date.now()
              if (remaining <= 0) break
              const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, remaining)
              request.signal.addEventListener('abort', abort, { once: true })
              let current: PrintJob | undefined
              try { current = await inspect(record, controller.signal) }
              finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort) }
              if (!current) break
              progress(current.status)
              if (current.status === 'SUBMITTED') { remove(record); return { status: 'accepted', jobId: current.id, message: '已送至印表機' } }
              if (current.status === 'FAILED') { remove(record); throw new MailroomPrintBlockedError('列印工作未完成，請核對印表機後再按列印') }
              if (current.status === 'UNKNOWN') return unknown()
            } catch (error) { if (error instanceof MailroomPrintBlockedError) throw error; break }
          }
          return { status: 'accepted', jobId: job.id, message: '列印工作已建立，仍在處理；再次點按只會查詢原工作' }
        }
        return { status: 'accepted', jobId: job.id }
      }
      return await resolve(record)
    } finally {
      ids.forEach(id => held.delete(id)); if (!held.size) locks.delete(lockKey)
    }
  }
}
