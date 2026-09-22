import { useEffect } from 'react'
import { Result } from 'antd'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { wmsPortalDestination } from '../config/wms-portal'

export default function WarehousePortalPage() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const destination = wmsPortalDestination(user, pathname)
  const url = destination?.externalUrl
  useEffect(() => { if (url) window.location.replace(url) }, [url])
  if (!destination) return <Result status="403" title="沒有此儲運功能權限" />
  return <Result title={`正在開啟${destination.label}`} extra={<a href={url} rel="noreferrer">開啟儲運系統</a>} />
}
