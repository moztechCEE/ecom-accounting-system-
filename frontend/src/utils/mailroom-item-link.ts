const BASE = 'https://corely.invalid'
const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/
const ITEM_PATHS = new Set(['/operations/mailroom', '/operations/repair'])
const unsafeInput = (value: string) => [...value].some(char => char === '\\' || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)

/** Only an item deep link, never an arbitrary post-login redirect. */
export function safeItemReturnTo(raw: string | null | undefined, entityId?: string): string | null {
  if (!raw || raw.length > 600 || !raw.startsWith('/') || raw.startsWith('//') || unsafeInput(raw)) return null
  try {
    const url = new URL(raw, BASE)
    if (url.origin !== BASE || !ITEM_PATHS.has(url.pathname) || url.hash) return null
    if ([...url.searchParams.keys()].some(key => !['entityId', 'itemId', 'queue'].includes(key))) return null
    if (['entityId', 'itemId', 'queue'].some(key => url.searchParams.getAll(key).length > 1)) return null
    const item = url.searchParams.get('itemId') || '', entity = url.searchParams.get('entityId') || ''
    if (!ITEM_ID.test(item) || !ENTITY_ID.test(entity) || (entityId && entityId !== entity)) return null
    if (url.searchParams.has('queue') && (url.pathname !== '/operations/repair' || url.searchParams.get('queue') !== 'all')) return null
    const params = new URLSearchParams({ entityId: entity, itemId: item })
    if (url.pathname === '/operations/repair' && url.searchParams.has('queue')) params.set('queue', 'all')
    return url.pathname + '?' + params.toString()
  } catch { return null }
}

export function itemLoginPath(location: { pathname: string; search: string }): string {
  const target = safeItemReturnTo(location.pathname === '/auth/change-password'
    ? new URLSearchParams(location.search).get('returnTo')
    : location.pathname + location.search)
  return target ? '/login?' + new URLSearchParams({ returnTo: target }) : '/login'
}

export function physicalItemLink(origin: string, entityId: string, itemId: string): string {
  const target = safeItemReturnTo('/operations/repair?' + new URLSearchParams({ entityId, itemId, queue: 'all' }))
  if (!target) throw new Error('物件標籤資料不完整')
  const url = new URL(origin)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('無法建立物件連結')
  return new URL(target, url.origin).href
}

/** Hardware scanners may enter the printed URL or the exact native item UUID. */
export function parsePhysicalItemScan(raw: string, origin: string, entityId: string): { itemId: string; entityId: string; path: string } | null {
  const text = raw.trim()
  if (!ENTITY_ID.test(entityId) || text.length > 600 || unsafeInput(text)) return null
  let target: string | null = null
  if (ITEM_ID.test(text)) target = safeItemReturnTo('/operations/repair?' + new URLSearchParams({ entityId, itemId: text, queue: 'all' }), entityId)
  else {
    try {
      const base = new URL(origin), url = new URL(text, base.origin)
      if (url.origin !== base.origin || url.username || url.password) return null
      target = safeItemReturnTo(url.pathname + url.search + url.hash, entityId)
    } catch { return null }
  }
  if (!target) return null
  const url = new URL(target, BASE)
  return { itemId: url.searchParams.get('itemId')!, entityId, path: target }
}
