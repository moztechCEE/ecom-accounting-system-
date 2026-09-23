import { message } from 'antd'
import { openWarehouseWork } from '../services/wms-workspace'
import type { NavigationItem } from '../config/navigation'

export default function WarehouseLink({ item, onOpen }: { item: NavigationItem; onOpen?: () => void }) {
  return <a href={item.workRole ? item.key : item.externalUrl} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (item.workRole) {
      event.preventDefault()
      void openWarehouseWork(item.workRole).catch(error => message.error(error.response?.data?.message || error.message || '無法開啟儲運系統'))
    }
    onOpen?.()
  }}>{item.label}</a>
}
