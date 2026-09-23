import { Alert, Empty, Space, Tag, Typography } from 'antd'
import type { Role } from '../types'
import { navigationLeaves, workspaceNavigation } from '../config/navigation'
import { effectiveAccess } from '../utils/access-preview'
import { isAdminUser } from '../utils/access'
import { getActionName, getResourceName } from '../constants/translations'

export default function AccessPreview({ roles }: { roles: Role[] }) {
  const user = effectiveAccess(roles)
  const items = workspaceNavigation(user, 'all')
  const pageCount = navigationLeaves(items).length
  return <div className="mt-4 space-y-3" aria-label="可見功能預覽">
    <Typography.Text strong>可見介面預覽 · {pageCount} 個入口</Typography.Text>
    <Alert type={isAdminUser(user) ? 'warning' : 'info'} showIcon message={isAdminUser(user)
      ? '管理員具有全部功能權限；公司與資料範圍仍依帳號設定。'
      : '多個角色的權限會合併。此處顯示功能入口；實際資料仍受公司、部門及個人範圍限制。'} />
    {!pageCount ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未開放功能入口" /> : items.map(item =>
      <div key={item.key}>
        {item.children && <div className="mb-1 text-sm text-slate-500">{item.label}</div>}
        <Space wrap>{navigationLeaves([item]).map(page => <Tag key={page.key}>{page.label}</Tag>)}</Space>
      </div>)}
    {!isAdminUser(user) && <details><summary className="cursor-pointer text-sm text-slate-500">查看已授權操作（{user.permissions.length}）</summary>
      <Space wrap className="mt-2">{user.permissions.map(permission => {
        const [resource, action] = permission.split(':')
        return <Tag key={permission}>{getResourceName(resource)} · {getActionName(action)}</Tag>
      })}</Space>
    </details>}
  </div>
}
