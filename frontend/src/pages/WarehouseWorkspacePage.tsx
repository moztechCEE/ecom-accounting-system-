import { useEffect, useState } from 'react'
import { Alert, Button, Card, Space, Typography } from 'antd'
import { InboxOutlined, ScanOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import type { WorkRole } from '../services/wms-workspace'
import { wmsPortalLinks } from '../config/wms-portal'
import { companyNavigationDestination } from '../config/workspaces'
import WarehousePortalPage from './WarehousePortalPage'

export default function WarehouseWorkspacePage() {
  const { search } = useLocation()
  return new URLSearchParams(search).has('wms') ? <WarehousePortalPage /> : <WarehouseHome />
}

function WarehouseHome() {
  const { user, refreshCurrentUser } = useAuth()
  const { search } = useLocation()
  const navigate = useNavigate()
  const [roles, setRoles] = useState<WorkRole[]>([])
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setRoles([])
    void (async () => {
      try {
        await refreshCurrentUser()
        if (controller.signal.aborted) return
        const { data } = await api.get('/wms/portal/access', { signal: controller.signal })
        if (!Array.isArray(data?.roles) || data.roles.some((role: unknown) => !['picker', 'packer', 'dispatcher'].includes(String(role)))) throw new Error('Invalid work roles')
        if (!controller.signal.aborted) setRoles(data.roles)
      } catch (cause: any) {
        if (!controller.signal.aborted) setError(cause.response?.data?.message || '無法載入作業權限，請重試')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [user?.id, attempt])
  const operationLinks = wmsPortalLinks(user).filter(link => ['/warehouse/marketplace', '/warehouse/intakes', '/warehouse/exceptions'].includes(link.key))
  const open = (key: string) => navigate(companyNavigationDestination(key, search))
  return <div style={{ maxWidth: 1040, margin: '0 auto', padding: '16px 0' }}>
    <Typography.Title level={2} style={{ marginTop: 0, marginBottom: 24 }}>儲運工作台</Typography.Title>
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重新整理</Button>} style={{ marginBottom: 20 }} />}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 20 }}>
      {([{ role: 'picker', key: '/warehouse/picking', label: '揀貨', icon: <ScanOutlined /> }, { role: 'packer', key: '/warehouse/packing', label: '裝箱', icon: <InboxOutlined /> }] as const).filter(item => roles.includes(item.role)).map(item =>
        <Card key={item.role} styles={{ body: { padding: 28 } }}>
          <div style={{ fontSize: 28, marginBottom: 16 }}>{item.icon}</div>
          <Typography.Title level={3}>{item.label}</Typography.Title>
          <Button size="large" type="primary" block onClick={() => open(item.key)}>開始{item.label}</Button>
        </Card>)}
    </div>
    {loading && <Card loading style={{ marginTop: 20 }} />}
    {!loading && !error && !roles.length && !operationLinks.length && <Alert type="info" message="尚未指派儲運作業權限，請聯絡管理員" />}
    {operationLinks.length > 0 && <Card title="出貨與例外" style={{ marginTop: 24 }}><Space wrap>{operationLinks.map(link => <Button key={link.key} onClick={() => open(link.key)}>{link.label}</Button>)}</Space></Card>}
  </div>
}
