import { useMemo, useState } from 'react'
import { Checkbox, Empty, Input, Space, Typography } from 'antd'
import type { Permission } from '../types'
import { getActionName, getResourceName } from '../constants/translations'
import { groupPermissions, togglePermissionGroup } from '../utils/access-preview'

export default function PermissionMatrix({ permissions, value = [], onChange, disabled = false }: {
  permissions: Permission[]; value?: string[]; onChange?: (ids: string[]) => void; disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const groups = useMemo(() => groupPermissions(permissions).filter(group => {
    const query = search.trim().toLowerCase()
    return !query || `${getResourceName(group.resource)} ${group.resource} ${group.permissions.map(p => `${getActionName(p.action)} ${p.description || ''}`).join(' ')}`.toLowerCase().includes(query)
  }), [permissions, search])
  return <div className="space-y-3">
    <Input.Search value={search} onChange={event => setSearch(event.target.value)} allowClear placeholder="搜尋功能模組或操作" />
    <Typography.Text type="secondary">已選 {value.length} 項操作；勾選模組可一次開放該模組全部操作。</Typography.Text>
    <div className="max-h-96 overflow-y-auto space-y-3">
      {!groups.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="沒有符合的模組" />}
      {groups.map(group => {
        const ids = group.permissions.map(permission => permission.id)
        const count = ids.filter(id => value.includes(id)).length
        return <div key={group.resource} className="rounded-lg border border-slate-200 p-3">
          <Checkbox disabled={disabled} checked={count === ids.length} indeterminate={count > 0 && count < ids.length}
            onChange={event => onChange?.(togglePermissionGroup(value, ids, event.target.checked))}>
            <strong>{getResourceName(group.resource)}</strong> <span className="text-slate-400">{count}/{ids.length}</span>
          </Checkbox>
          <div className="mt-2 ml-6"><Space wrap>{group.permissions.map(permission =>
            <Checkbox key={permission.id} disabled={disabled} checked={value.includes(permission.id)}
              onChange={event => onChange?.(togglePermissionGroup(value, [permission.id], event.target.checked))}>
              {getActionName(permission.action)}
            </Checkbox>)}</Space></div>
        </div>
      })}
    </div>
  </div>
}
