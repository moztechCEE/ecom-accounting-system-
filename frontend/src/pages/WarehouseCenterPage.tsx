import { Alert, Button, Card, Space, Tag, Typography } from 'antd'
import { ExportOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { isAdminUser } from '../utils/access'
import './WarehouseCenterPage.css'

export default function WarehouseCenterPage() {
  const { user } = useAuth()
  return <section className="warehouse-center">
    <header><Typography.Title level={2}>儲運管理中心</Typography.Title><Tag>WMS 獨立作業</Tag></header>
    <div className="warehouse-center-grid">
      <Card title="揀貨與裝箱"><p>揀貨、裝箱、SN 核對</p><Button type="primary" href="https://wms.corely.cc/tasks" target="_blank" rel="noopener noreferrer" icon={<ExportOutlined />}>開啟作業工作台</Button></Card>
      <Card title="作業公告"><p>班別公告與現場交接</p><Button href="https://wms.corely.cc/team" target="_blank" rel="noopener noreferrer" icon={<ExportOutlined />}>開啟公告板</Button></Card>
      {isAdminUser(user) && <Card title="出貨管理"><p>訂單、異常審核、匯入與匯出</p><Button href="https://wms.corely.cc/admin" target="_blank" rel="noopener noreferrer" icon={<ExportOutlined />}>開啟出貨管理</Button></Card>}
    </div>
    <Alert type="info" showIcon message="目前使用 WMS 原帳號登入；ERP 不會自動授予 WMS 權限。" />
    <Card title="物流與退回">
      <Space wrap><Tag>ERP 查詢待串接</Tag><Tag>倉庫實收待串接</Tag></Space>
      <p>物流退回與倉庫實收分開核對，庫存仍以 ECOUNT 為準。</p>
    </Card>
  </section>
}
