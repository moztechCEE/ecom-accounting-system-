import { useEffect, useState } from 'react'
import { Input, Modal, Empty } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { navigationLeaves, visibleNavigation } from '../config/navigation'

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { user } = useAuth()
  const navigate = useNavigate()
  const pages = navigationLeaves(visibleNavigation(user)).filter((item) => item.label.includes(search.trim()))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearch('')
        setOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return <Modal title="搜尋功能" open={open} footer={null} onCancel={() => setOpen(false)} destroyOnHidden
    afterOpenChange={(visible) => { if (visible) document.getElementById('operations-command-search')?.focus() }}>
    <Input id="operations-command-search" aria-label="搜尋功能" prefix={<SearchOutlined />}
      value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
    <nav aria-label="功能搜尋結果" className="operations-command-results">
      {pages.map((item) => <button type="button" key={item.key}
        onClick={() => { navigate(item.key); setOpen(false) }}>{item.label}</button>)}
      {!pages.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="沒有符合的功能" />}
    </nav>
  </Modal>
}
