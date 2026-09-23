import { message } from 'antd'
import { openWarehouseEntry } from '../services/wms-workspace'
import type { NavigationItem } from '../config/navigation'

export default function WarehouseLink({ item, onOpen }: { item: NavigationItem; onOpen?: () => void }) {
  return <a href={item.key} onClick={event => {
    event.preventDefault()
    void openWarehouseEntry(item.key).catch(error => message.error(error.response?.data?.message || error.message || '無法開啟儲運系統'))
    onOpen?.()
  }}>{item.label}</a>
}
