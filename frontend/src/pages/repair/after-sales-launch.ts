export const AFTER_SALES_READY_TIMEOUT_MS = 45_000
export const AFTER_SALES_SOURCE_PATHS = {
  workbench: '/dashboard', cases: '/cases', quotes: '/cases/repair-quotes', repairs: '/cases/repairs',
  reshipments: '/cases/reshipments', 'exchange-returns': '/cases/exchange-returns',
  'refund-pickups': '/cases/refund-pickups', 'private-purchases': '/cases/private-purchases',
  'customer-issues': '/cases/customer-issues', shipping: '/cases?queue=warehouse',
  accounting: '/accounting-workbench', customers: '/customers', invoices: '/invoices',
  products: '/products', faqs: '/faqs', imports: '/imports', users: '/users',
  'audit-logs': '/audit-logs', settings: '/settings',
} as const
export type AfterSalesAttempt = {
  id: number; section: string; entityId: string; sourcePath: string
  phase: 'REQUESTING' | 'LOADING' | 'READY' | 'ERROR'; frame?: object
}
/** Each login attempt belongs to its own iframe; old requests cannot submit or clear a newer load. */
export function createAfterSalesLaunchSession() {
  let counter = 0, current: AfterSalesAttempt | undefined
  return {
    begin(section: string, entityId: string): AfterSalesAttempt {
      if (!Object.prototype.hasOwnProperty.call(AFTER_SALES_SOURCE_PATHS, section)) throw new Error('售後功能入口不存在')
      const sourcePath = AFTER_SALES_SOURCE_PATHS[section as keyof typeof AFTER_SALES_SOURCE_PATHS]
      if (!sourcePath) throw new Error('售後功能入口不存在')
      current = { id: ++counter, section, entityId, sourcePath, phase: 'REQUESTING' }
      return current
    },
    current: () => current,
    isCurrent: (attempt: AfterSalesAttempt) => current === attempt && attempt.phase !== 'ERROR',
    invalidate() { current = undefined },
    attach(attempt: AfterSalesAttempt, frame: object) {
      if (current !== attempt || attempt.phase !== 'REQUESTING') return false
      attempt.frame = frame; attempt.phase = 'LOADING'; return true
    },
    ready(attempt: AfterSalesAttempt, frame: object, reportedPath: unknown, actualUrl: string, origin: string): 'ignored' | 'mismatch' | 'ready' {
      if (current !== attempt || attempt.phase !== 'LOADING' || attempt.frame !== frame) return 'ignored'
      try {
        const expected = new URL('/after-sales-app' + attempt.sourcePath, origin), actual = new URL(actualUrl)
        const repairAlias = attempt.section === 'repairs' && actual.pathname === '/after-sales-app/cases' &&
          actual.searchParams.size === 2 && actual.searchParams.getAll('type').length === 1 &&
          actual.searchParams.get('type') === 'REPAIR' && actual.searchParams.getAll('queue').length === 1 &&
          actual.searchParams.get('queue') === 'technician'
        const canonical = actual.pathname === expected.pathname && actual.search === expected.search
        if (actual.origin !== origin || actual.hash || (!canonical && !repairAlias) ||
          (reportedPath !== actual.pathname && reportedPath !== actual.pathname.slice('/after-sales-app'.length))) return 'mismatch'
      } catch { return 'mismatch' }
      attempt.phase = 'READY'; return 'ready'
    },
    fail(attempt: AfterSalesAttempt) {
      if (current !== attempt || attempt.phase === 'ERROR') return false
      attempt.phase = 'ERROR'; return true
    },
    timeout(attempt: AfterSalesAttempt) {
      if (current !== attempt || !['REQUESTING', 'LOADING'].includes(attempt.phase)) return false
      attempt.phase = 'ERROR'; return true
    },
  }
}
/** Transport and framework failures must expose retry instead of looking like a successful page. */
export function afterSalesFrameFailure(body: string, contentType = '', frameworkError = false): string | undefined {
  const text = body.trim()
  if (frameworkError) return '售後頁面載入失敗，請重新開啟；若持續發生，請聯絡管理者'
  if (text.startsWith('{')) {
    try {
      const payload = JSON.parse(text) as { error?: unknown }
      if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.slice(0, 2000)
    } catch { /* A normal HTML page may contain customer text beginning with a brace. */ }
  }
  if (text === '售後模組暫時無法連線' || contentType.startsWith('text/plain') && text) return '售後模組暫時無法連線，請重新開啟'
  return undefined
}
