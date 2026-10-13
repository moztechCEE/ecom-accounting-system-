import { Link, useLocation } from 'react-router-dom'
import type { NavigationItem } from '../config/navigation'
import { companyNavigationDestination } from '../config/workspaces'

export default function WarehouseLink({ item, onOpen }: { item: NavigationItem; onOpen?: () => void }) {
  const { search } = useLocation()
  return <Link to={companyNavigationDestination(item.key, search)} onClick={onOpen}>{item.label}</Link>
}
