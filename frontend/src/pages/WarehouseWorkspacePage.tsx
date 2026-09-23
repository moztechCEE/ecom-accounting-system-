import { useEffect, useState } from 'react'
import { Alert, Button, Card, Space, Typography } from 'antd'
import { InboxOutlined, ScanOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { hasAnyPermission } from '../utils/access'
import api from '../services/api'
import { openWarehouseEntry, openWarehouseWork, type WorkRole } from '../services/wms-workspace'
import { wmsPortalLinks } from '../config/wms-portal'

export default function WarehouseWorkspacePage() {
  const { user, refreshCurrentUser } = useAuth()
  const [roles, setRoles] = useState<WorkRole[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<WorkRole | null>(null)
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true); setError('')
    try { await refreshCurrentUser(); const { data } = await api.get('/wms/portal/access'); setRoles(data.roles) }
    catch (e: any) { setError(e.response?.data?.message || '無法載入作業權限，請重試') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const start = async (role: WorkRole) => {
    setBusy(role); setError('')
    try { await openWarehouseWork(role) }
    catch (e: any) { setError(e.response?.data?.message || e.message || '無法開啟工作台') }
    finally { setBusy(null) }
  }
  const operationLinks = wmsPortalLinks(user).filter(link => ['/warehouse/marketplace','/warehouse/intakes','/warehouse/exceptions'].includes(link.key))
  return <div style={{ maxWidth: 1040, margin: '0 auto', padding: '16px 0' }}>
    <Typography.Title level={2}>作業工作台</Typography.Title>
    <Typography.Paragraph type="secondary">選擇今天的作業</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={load}>重新整理</Button>} style={{ marginBottom: 20 }} />}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 20 }}>
      {([{ role: 'picker', label: '揀貨', description: '領取任務，核對商品與數量', icon: <ScanOutlined /> }, { role: 'packer', label: '裝箱', description: '核對商品與序號，完成裝箱', icon: <InboxOutlined /> }] as const).filter(item => roles.includes(item.role)).map(item =>
        <Card key={item.role} styles={{ body: { padding: 28 } }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>{item.icon}</div>
          <Typography.Title level={3}>{item.label}</Typography.Title>
          <Typography.Paragraph type="secondary">{item.description}</Typography.Paragraph>
          <Button size="large" type="primary" block loading={busy === item.role} disabled={!!busy && busy !== item.role} onClick={() => start(item.role)}>開始{item.label}</Button>
        </Card>)}
    </div>
    {loading && <Card loading style={{ marginTop: 20 }} />}
    {!loading && !error && !roles.length && <Alert type="info" message="尚未指派揀貨或裝箱權限，請聯絡管理員。" />}
    {hasAnyPermission(user, ['wms_orders:create','wms_exceptions:read']) && operationLinks.length > 0 && <Card title="出貨與例外" style={{ marginTop: 24 }}><Space wrap>{operationLinks.map(link => <Button key={link.key} onClick={() => void openWarehouseEntry(link.key).catch(e => setError(e.response?.data?.message || e.message))}>{link.label}</Button>)}</Space></Card>}
  </div>
}
