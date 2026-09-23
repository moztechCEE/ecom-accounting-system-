import { openWarehouseWork } from '../services/wms-workspace'
import { useEffect } from 'react'
import { Button, Result, message } from 'antd'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { wmsPortalDestination } from '../config/wms-portal'

export default function WarehousePortalPage() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const destination = wmsPortalDestination(user, pathname)
  const url = destination?.externalUrl
  useEffect(() => { if (url && !destination?.workRole) window.location.replace(url) }, [url])
  if (!destination) return <Result status="403" title="沒有此儲運功能權限" />
  if (destination.workRole) return <Result title={destination.label} subTitle="使用目前營運系統帳號進入" extra={<Button type="primary" onClick={() => void openWarehouseWork(destination.workRole!).catch(error => message.error(error.response?.data?.message || error.message))}>開啟出貨管理</Button>} />
  return <Result title={`正在開啟${destination.label}`} extra={<a href={url} rel="noreferrer">開啟儲運系統</a>} />
}
