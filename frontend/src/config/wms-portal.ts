import type { User } from '../types'
import { hasAnyPermission, isAdminUser } from '../utils/access'

// Only the named WMS environment is a valid destination. No ERP token is sent.
export function wmsPortalOrigin(): string {
  const config = typeof window === 'undefined' ? undefined : window.__APP_CONFIG__
  const raw = config?.wmsPortalUrl?.trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const allowedHost = config?.devEnvironment
      ? 'corely-wms-dev-sp5g377smq-de.a.run.app'
      : 'corely-wms-sp5g377smq-de.a.run.app'
    return url.protocol === 'https:' && url.hostname === allowedHost && !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : ''
  } catch { return '' }
}

export const WMS_PORTAL_SECTIONS = [
  { key: '/warehouse', label: '作業工作台', path: '/tasks', permissions: ['wms_tasks:read'] },
  { key: '/warehouse/picking', label: '揀貨作業', path: '/tasks?group=pick', permissions: ['wms_picking:execute'] },
  { key: '/warehouse/packing', label: '裝箱核對', path: '/tasks?group=pack', permissions: ['wms_packing:execute'] },
  { key: '/warehouse/completed', label: '完成紀錄', path: '/tasks?view=completed', permissions: ['wms_tasks:read'] },
  { key: '/warehouse/dispatch', label: '出貨管理', path: '/admin', workRole: 'dispatcher', permissions: ['wms_orders:create'] },
  { key: '/warehouse/marketplace', label: '通路訂單轉檔', path: '/admin/marketplace-converter', permissions: ['wms_orders:create'] },
  { key: '/warehouse/intakes', label: '預揀與倉庫放行', path: '/warehouse-intakes', permissions: ['wms_orders:create', 'wms_picking:execute', 'wms_packing:execute'] },
  { key: '/warehouse/overview', label: '儲運分析', path: '/admin/analytics', permissions: ['wms_overview:read'] },
  { key: '/warehouse/logs', label: '操作日誌', path: '/admin/operation-logs', permissions: ['wms_logs:read'] },
  { key: '/warehouse/exceptions', label: '例外總覽', path: '/admin/exceptions', permissions: ['wms_exceptions:read'] },
  { key: '/warehouse/scan-errors', label: '刷錯分析', path: '/admin/scan-errors', permissions: ['wms_scan_errors:read'] },
  { key: '/warehouse/defects', label: '新品不良分析', path: '/admin/defects', permissions: ['wms_defects:read'] },
  { key: '/warehouse/logistics', label: '物流查詢', path: '/settings/logistics', adminOnly: true },
  { key: '/warehouse/team', label: '團隊公告', path: '/team', permissions: ['wms_tasks:read'] },
  { key: '/warehouse/users', label: '儲運人員', path: '/admin/users', adminOnly: true },
  { key: '/warehouse/settings', label: '儲運設定', path: '/settings', permissions: ['wms_tasks:read'] },
] satisfies { key: string; label: string; path: string; workRole?: 'dispatcher'; permissions?: string[]; adminOnly?: boolean }[]

export function wmsPortalLinks(user: User | null | undefined) {
  const origin = wmsPortalOrigin()
  if (!origin || !hasAnyPermission(user, ['wms_tasks:read'])) return []
  return WMS_PORTAL_SECTIONS.filter(section =>
    section.adminOnly ? isAdminUser(user) : hasAnyPermission(user, section.permissions || []),
  ).map(section => ({ ...section, externalUrl: origin + section.path }))
}

export function wmsPortalDestination(user: User | null | undefined, key: string) {
  const canonicalKey = key === '/warehouse/workstation' ? '/warehouse' : key
  return wmsPortalLinks(user).find(section => section.key === canonicalKey)
}
