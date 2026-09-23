import { openWarehouseEntry } from '../services/wms-workspace'
import { Button, Result, message } from 'antd'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { wmsPortalDestination } from '../config/wms-portal'

export default function WarehousePortalPage() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const destination = wmsPortalDestination(user, pathname)
  if (!destination) return <Result status="403" title="沒有此儲運功能權限" />
  return <Result title={destination.label} subTitle="使用目前營運系統帳號進入" extra={<Button type="primary" onClick={() => void openWarehouseEntry(destination.key).catch(error => message.error(error.response?.data?.message || error.message))}>開啟{destination.label}</Button>} />
}
