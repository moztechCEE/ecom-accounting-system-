import { Alert, Empty, Space, Tag, Typography } from 'antd'
import type { ManagedUser, Role } from '../types'
import { navigationLeaves, workspaceNavigation } from '../config/navigation'
import { effectiveAccess } from '../utils/access-preview'
import { isAdminUser } from '../utils/access'
import { getActionName, getResourceName } from '../constants/translations'

export const SENSITIVE_ACCESS = [
  { key: 'product_cost:read', label: '產品與採購成本', requires: ['product_cost:read'] },
  { key: 'financial_margin:read', label: '毛利', requires: ['product_cost:read', 'financial_margin:read'] },
  { key: 'financial_net_profit:read', label: '淨利與完整損益', requires: ['product_cost:read', 'financial_margin:read', 'financial_net_profit:read'] },
  { key: 'employee_compensation:read', label: '同仁薪資', requires: ['employee_compensation:read'] },
  { key: 'banking:read', label: '銀行資料', requires: ['banking:read'] },
] as const

type AccessPreviewProps = {
  roles: Role[]
  permissions?: string[]
  actual?: boolean
  companyNames?: string[]
  departmentName?: string | null
  scopeSummary?: string[]
  serverAccess?: ManagedUser['effectiveAccess']
}

export default function AccessPreview({
  roles,
  permissions = [],
  actual = false,
  companyNames = [],
  departmentName,
  scopeSummary = [],
  serverAccess,
}: AccessPreviewProps) {
  const user = effectiveAccess(roles)
  user.permissions = actual && serverAccess ? permissions : [...new Set([...user.permissions, ...permissions])]
  const fullAccess = serverAccess?.permissionMode === 'all' || isAdminUser(user)
  const items = workspaceNavigation(user, 'all')
  const pageCount = navigationLeaves(items).length
  const available = SENSITIVE_ACCESS.filter((item) => fullAccess || item.requires.every((key) => user.permissions.includes(key)))
  const unavailable = SENSITIVE_ACCESS.filter((item) => !fullAccess && !item.requires.every((key) => user.permissions.includes(key)))

  return (
    <div className="mt-4 space-y-4" aria-label="權限結果預覽">
      <div>
        <Typography.Text strong>{actual ? '目前有效權限' : '儲存前權限預估'}</Typography.Text>
        <Alert
          className="mt-2"
          type={fullAccess ? 'warning' : 'info'}
          showIcon
          message={fullAccess
            ? '系統管理員目前可通過所有一般權限檢查，請只指派給必要人員。'
            : actual
              ? '此摘要依帳號目前的角色與指派計算；資料仍受公司與對象範圍限制。'
              : '多個職務的權限會合併。儲存後請再核對帳號的有效權限。'}
        />
      </div>

      {(companyNames.length > 0 || departmentName || scopeSummary.length > 0 || serverAccess?.companyMode === 'all') && (
        <section className="rounded-xl border border-slate-200 bg-white/80 p-3">
          <Typography.Text strong>資料範圍</Typography.Text>
          <div className="mt-2 flex flex-wrap gap-2">
            {serverAccess?.companyMode === 'all' ? <Tag color="orange">所有公司</Tag> : companyNames.map((name) => <Tag key={name}>公司：{name}</Tag>)}
            {departmentName && <Tag>部門：{departmentName}</Tag>}
            {scopeSummary.map((scope) => <Tag key={scope}>{scope}</Tag>)}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white/80 p-3">
        <Typography.Text strong>敏感資料</Typography.Text>
        <div className="mt-2 flex flex-wrap gap-2">
          {available.map((item) => <Tag key={item.key} color="orange">可看：{item.label}</Tag>)}
          {unavailable.map((item) => <Tag key={item.key} color="default">不開放：{item.label}</Tag>)}
        </div>
        {!fullAccess && user.permissions.includes('financial_margin:read') && !user.permissions.includes('product_cost:read') &&
          <Alert type="warning" showIcon className="mt-3" message="毛利權限尚缺成本讀取權限，因此目前不會顯示毛利。" />}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white/80 p-3">
        <Typography.Text strong>可見介面 · {pageCount} 個入口</Typography.Text>
        {!pageCount ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未開放功能入口" /> : items.map((item) => (
          <div key={item.key} className="mt-2">
            {item.children && <div className="mb-1 text-sm text-slate-500">{item.label}</div>}
            <Space wrap>{navigationLeaves([item]).map((page) => <Tag key={page.key}>{page.label}</Tag>)}</Space>
          </div>
        ))}
      </section>

      {!fullAccess && (
        <details>
          <summary className="cursor-pointer text-sm text-slate-500">查看已授權操作（{user.permissions.length}）</summary>
          <Space wrap className="mt-2">{user.permissions.map((permission) => {
            const [resource, action] = permission.split(':')
            return <Tag key={permission}>{getResourceName(resource)} · {getActionName(action)}</Tag>
          })}</Space>
        </details>
      )}
      {actual && serverAccess && serverAccess.permissionSources.length > 0 && <details>
        <summary className="cursor-pointer text-sm text-slate-500">查看權限來源（{serverAccess.permissionSources.length}）</summary>
        <div className="mt-2 space-y-1 text-sm">
          {serverAccess.permissionSources.map((entry) => {
            const [resource, action] = entry.permission.split(':')
            const sources = [
              ...entry.roles.map((role) => role.name || role.code),
              ...(entry.employeeAssignment ? ['員工職責'] : []),
              ...(entry.derivedFrom ? [`由 ${entry.derivedFrom} 衍生`] : []),
            ]
            return <div key={entry.permission}><Typography.Text>{getResourceName(resource)} · {getActionName(action)}</Typography.Text>
              <Typography.Text type="secondary">　← {sources.join('、') || '系統規則'}</Typography.Text></div>
          })}
        </div>
      </details>}
    </div>
  )
}
