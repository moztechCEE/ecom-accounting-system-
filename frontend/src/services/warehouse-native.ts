import axios from 'axios'
import type { AxiosRequestConfig, AxiosResponse } from 'axios'
import { API_URL } from './api'
import { WMS_PORTAL_SECTIONS, wmsPortalOrigin } from '../config/wms-portal'

export type NativeWarehouseSession = {
  accessToken: string
  destination: string
  user: { id: number; role: string; erpSubject: string; entityId: string; [key: string]: unknown }
}
export type WarehouseManifest = { version: 1; sourceCommit: string; entry: string; styles: string[]; portalStyles: string[] }
export type WarehouseHandle = { navigate(path: string, options?: { replace?: boolean }): void; dispose(): void }
export type WarehouseHost = {
  session: NativeWarehouseSession
  initialPath: string
  manifest: WarehouseManifest
  assetOrigin: string
  socketOrigin: string
  signal: AbortSignal
  transport(config: AxiosRequestConfig): Promise<AxiosResponse>
  download(input: { id: number; kind: string }): Promise<AxiosResponse<Blob>>
  navigate(path: string, options?: { replace?: boolean }): void
  onAuthRequired(): void
  onReload(): void
}
export type WarehouseModule = { sourceCommit: string; mountWorkspace(container: HTMLElement, host: WarehouseHost): Promise<WarehouseHandle> }

const workPaths = new Set(['/tasks', '/admin', '/admin/marketplace-converter', '/admin/users', '/admin/operation-logs',
  '/admin/analytics', '/admin/scan-errors', '/admin/defects', '/admin/exceptions', '/settings', '/settings/logistics', '/team', '/cartons'])
const moduleCache = new Map<string, Promise<WarehouseModule>>()
// WMS expiry is independent of ERP login. This client never clears ERP credentials
// merely because the delegated warehouse session expired.
const nativeApi = axios.create({ baseURL: API_URL, timeout: 30000 })

export function nativeRecoveryEntity(value: unknown, key: string, actorId: string): string | null {
  const access = value as { userId?: unknown; entityId?: unknown; admin?: unknown; permissions?: unknown }
  const section = WMS_PORTAL_SECTIONS.find(section => section.key === key)
  if (!section || !access || access.userId !== actorId || typeof access.entityId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(access.entityId) || typeof access.admin !== 'boolean' || !Array.isArray(access.permissions)) return null
  if (!access.admin && (section.adminOnly || !access.permissions.includes('wms_tasks:read') ||
    !section.permissions?.some(permission => (access.permissions as unknown[]).includes(permission)))) return null
  return access.entityId
}

export async function nativeRecoveryRequest(key: string, actor: { userId: string; token: string }, signal: AbortSignal): Promise<string | null> {
  const { data } = await nativeApi.get('/wms/portal/access', { signal, headers: { Authorization: `Bearer ${actor.token}` } })
  return nativeRecoveryEntity(data, key, actor.userId)
}

export function nativeWorkPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value)) return null
  const pathname = value.split(/[?#]/, 1)[0]
  if (pathname.includes('%') || pathname.includes('//') || pathname.split('/').some(part => part === '.' || part === '..')) return null
  try {
    const url = new URL(value, 'https://warehouse.invalid')
    if (url.origin !== 'https://warehouse.invalid' || /%|(?:^|\/)\.\.?\//.test(url.pathname)) return null
    if (!workPaths.has(url.pathname) && !/^\/(order|warehouse-intakes|batches|team)\/[1-9]\d{0,11}$/.test(url.pathname) && url.pathname !== '/warehouse-intakes') return null
    if ([...url.searchParams.keys()].some(key => /token|ticket|nonce|password|secret|session|authorization/i.test(key))) return null
    return url.pathname + url.search + url.hash
  } catch { return null }
}

export function nativeHostSection(path: string, currentKey: string, stationRole?: string): string | null {
  const safe = nativeWorkPath(path)
  if (!safe) return null
  const url = new URL(safe, 'https://warehouse.invalid')
  if (/^\/(order|batches)\//.test(url.pathname) || url.pathname === '/cartons') return currentKey
  if (url.pathname.startsWith('/warehouse-intakes')) return '/warehouse/intakes'
  if (url.pathname.startsWith('/team/')) return '/warehouse/team'
  if (url.pathname === '/tasks') {
    if (url.searchParams.get('group') === 'pick') return '/warehouse/picking'
    if (url.searchParams.get('group') === 'pack') return '/warehouse/packing'
    if (url.searchParams.get('view') === 'completed') return '/warehouse/completed'
    if (currentKey === '/warehouse/intakes' && !url.searchParams.has('group') && !url.searchParams.has('view')) {
      if (stationRole === 'picker') return '/warehouse/picking'
      if (stationRole === 'packer') return '/warehouse/packing'
    }
    return ['/warehouse/picking', '/warehouse/packing'].includes(currentKey) ? currentKey : '/warehouse'
  }
  return WMS_PORTAL_SECTIONS.find(section => new URL(section.path, 'https://warehouse.invalid').pathname === url.pathname)?.key || null
}

export function nativeEntryPath(key: string, search: string): string | null {
  const section = WMS_PORTAL_SECTIONS.find(section => section.key === (key === '/warehouse/workstation' ? '/warehouse' : key))
  if (!section) return null
  const supplied = new URLSearchParams(search).get('wms')
  if (!supplied) return section.path
  const safe = nativeWorkPath(supplied)
  return safe && nativeHostSection(safe, section.key) === section.key ? safe : null
}

export function warehouseManifest(raw: unknown): WarehouseManifest {
  const value = raw as WarehouseManifest
  const asset = (path: unknown, extension: string) => typeof path === 'string' && new RegExp(`^/assets/[A-Za-z0-9_-]+\\.${extension}$`).test(path)
  if (!value || value.version !== 1 || !/^[a-f0-9]{40}$/.test(value.sourceCommit || '') ||
    !asset(value.entry, 'js') || !Array.isArray(value.styles) || !value.styles.length || value.styles.length > 8 || !value.styles.every(path => asset(path, 'css')) ||
    !Array.isArray(value.portalStyles) || !value.portalStyles.length || value.portalStyles.length > 8 || !value.portalStyles.every(path => asset(path, 'css'))) {
    throw new Error('儲運模組版本資料不完整')
  }
  return { version: 1, sourceCommit: value.sourceCommit, entry: value.entry, styles: [...value.styles], portalStyles: [...value.portalStyles] }
}

export async function loadWarehouseModule(origin: string, signal: AbortSignal,
  importModule: (url: string) => Promise<WarehouseModule> = url => import(/* @vite-ignore */ url),
): Promise<{ manifest: WarehouseManifest; module: WarehouseModule }> {
  if (!origin || origin !== wmsPortalOrigin()) throw new Error('儲運模組來源未設定')
  const response = await fetch(origin + '/workspace-manifest.json', { credentials: 'omit', cache: 'no-store', signal, redirect: 'error' })
  if (!response.ok) throw new Error('儲運模組尚未就緒，請稍後重試')
  const text = await response.text()
  if (text.length > 16000) throw new Error('儲運模組版本資料無效')
  const manifest = warehouseManifest(JSON.parse(text))
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const url = origin + manifest.entry
  let promise = moduleCache.get(url)
  if (!promise) {
    promise = importModule(url)
    moduleCache.set(url, promise)
    promise.catch(() => { if (moduleCache.get(url) === promise) moduleCache.delete(url) })
  }
  const module = await promise
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (typeof module?.mountWorkspace !== 'function' || module.sourceCommit !== manifest.sourceCommit) throw new Error('儲運模組版本已更新，請重新連線')
  return { manifest, module }
}

export function nativeSessionRequest(entry: string, actor: { userId: string; entityId: string; token: string }, signal: AbortSignal) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('')
  return nativeApi.post<NativeWarehouseSession>('/wms/native/session', { entry, nonce, entityId: actor.entityId }, {
    signal, headers: { Authorization: `Bearer ${actor.token}`, 'X-WMS-Entity': actor.entityId },
  }).then(({ data }) => {
    if (!data?.accessToken || data.user?.erpSubject !== actor.userId || data.user?.entityId !== actor.entityId || !Number.isSafeInteger(data.user?.id) || data.user.id < 1 || !nativeWorkPath(data.destination)) {
      throw new Error('作業身分不符，請重新連線')
    }
    return data
  })
}

export function nativeSessionExpired(error: any): boolean {
  const { status, data } = error?.response || {}
  return status === 401 || (status === 403 && (
    /(?:AUTH_REQUIRED|WMS_SESSION_INVALID|WMS_SESSION_EXPIRED|AUTH_SESSION_INVALID)/.test(data?.code || '') ||
    /Token 無效或已過期|帳號或登入已失效|作業身分已失效/.test(data?.message || '')
  ))
}

export function nativeTransport(actor: { token: string; entityId: string }, session: NativeWarehouseSession,
  active: () => boolean, lifecycle: AbortSignal,
  client = nativeApi,
) {
  const assertActive = () => {
    if (!active() || lifecycle.aborted) throw new DOMException('作業身分已變更，請重新連線', 'AbortError')
  }
  const headers = () => ({ Authorization: `Bearer ${actor.token}`, 'X-WMS-Session': session.accessToken, 'X-WMS-Entity': actor.entityId })
  const request = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
    assertActive()
    const raw = String(config.url || '')
    const pathname = raw.split('?')[0]
    if (!/^\/api\/[A-Za-z0-9]/.test(raw) || /[\\\u0000-\u0020\u007f#]/.test(raw) || pathname.includes('//') || pathname.includes('%') || pathname.split('/').some(part => part === '.' || part === '..')) throw new Error('儲運請求路徑無效')
    const original = axios.AxiosHeaders.from(config.headers as Parameters<typeof axios.AxiosHeaders.from>[0])
    const claimed = original.get('Authorization')
    if (claimed && claimed !== `Bearer ${session.accessToken}`) throw new Error('作業身分已變更，請重新連線')
    const forwarded = axios.AxiosHeaders.from(headers())
    for (const key of ['Content-Type', 'Accept', 'If-None-Match']) if (original.has(key)) forwarded.set(key, original.get(key))
    if (config.data instanceof FormData) forwarded.delete('Content-Type')
    const controller = new AbortController()
    const abort = () => controller.abort()
    lifecycle.addEventListener('abort', abort, { once: true })
    config.signal?.addEventListener?.('abort', abort, { once: true })
    if (config.signal?.aborted) abort()
    try {
      const response = await client.request({ url: '/wms/native/proxy/' + raw.slice(1), method: config.method || 'get',
        params: config.params, paramsSerializer: config.paramsSerializer, data: config.data,
        responseType: config.responseType, timeout: config.timeout || 30000, signal: controller.signal,
        headers: forwarded, validateStatus: config.validateStatus, withCredentials: false })
      assertActive()
      return { ...response, config: config as AxiosResponse['config'] }
    } catch (error: any) {
      // Keep the original WMS request identity in the result. ERP credentials
      // must not leak back into module errors or its error-reporting adapter.
      if (error.config) error.config = config
      if (error.response?.config) error.response.config = config
      throw error
    } finally {
      lifecycle.removeEventListener('abort', abort)
      config.signal?.removeEventListener?.('abort', abort)
    }
  }
  const download = async ({ id, kind }: { id: number; kind: string }): Promise<AxiosResponse<Blob>> => {
    assertActive()
    if (!Number.isSafeInteger(id) || id < 1 || !['ecount', 'ecount-grouped', 'prepick'].includes(kind)) throw new Error('下載批次或格式無效')
    const safeConfig = { url: `/api/marketplace-intakes/${id}/download-link`, method: 'post', data: { kind }, headers: { Authorization: `Bearer ${session.accessToken}` } } as AxiosResponse['config']
    try {
      const response = await client.post<Blob>(`/wms/native/files/${id}/${kind}`, {}, {
        headers: headers(), signal: lifecycle, responseType: 'blob', timeout: 60000,
      })
      assertActive()
      return { ...response, config: safeConfig }
    } catch (error: any) {
      if (error.config) error.config = safeConfig
      if (error.response?.config) error.response.config = safeConfig
      // Axios uses the requested Blob type even for an upstream JSON failure.
      // Recover only that small error body so expiry and permissions remain
      // distinguishable; a workbook response is never decoded as text.
      const body = error.response?.data
      if (body instanceof Blob && body.size <= 16000 && /application\/json/i.test(String(error.response.headers?.['content-type'] || body.type))) {
        try { error.response.data = JSON.parse(await body.text()) } catch { /* Preserve the original failed response. */ }
      }
      throw error
    }
  }
  return { request, download }
}
