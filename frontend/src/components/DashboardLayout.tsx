import React, { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Button, Drawer, Dropdown, Grid, Input, Menu } from 'antd'
import { AppstoreOutlined, BankOutlined, CustomerServiceOutlined, DashboardOutlined, LogoutOutlined, MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, SearchOutlined, SettingOutlined, ShoppingOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { PRODUCT } from '../config/product'
import { activeNavigation, navigationParent, visibleNavigation, type NavigationItem } from '../config/navigation'
import CommandPalette from './CommandPalette'
import NotificationCenter from './NotificationCenter'
import SettingsDrawer from './SettingsDrawer'
import './OperationsLayout.css'

const STORAGE_KEY = 'corely.operations.navigation.v1'
const icons: Record<string, React.ReactNode> = {
  '/dashboard': <DashboardOutlined />, sales: <ShoppingOutlined />,
  service: <CustomerServiceOutlined />, warehouse: <AppstoreOutlined />, inventory: <AppstoreOutlined />,
  finance: <BankOutlined />, people: <TeamOutlined />, admin: <SettingOutlined />,
  '/profile': <UserOutlined />,
}
function savedNavigation(): { collapsed: boolean; closed: string[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { collapsed: saved.collapsed === true, closed: Array.isArray(saved.closed) ? saved.closed.filter((key: unknown) => typeof key === 'string') : [] }
  } catch { return { collapsed: false, closed: [] } }
}

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const mobile = screens.md === false
  const reducedMotion = useReducedMotion()
  const [preferences, setPreferences] = useState(savedNavigation)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menuSearch, setMenuSearch] = useState('')
  const items = visibleNavigation(user)
  const active = activeNavigation(items, location.pathname, location.search)
  const parent = navigationParent(items, active?.key || '')

  useEffect(() => { document.title = PRODUCT.title }, [])
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)) } catch { /* Storage may be unavailable. */ }
  }, [preferences])
  useEffect(() => {
    if (parent) setPreferences((current) => ({ ...current, closed: current.closed.filter((key) => key !== parent) }))
  }, [parent, location.pathname, location.search])

  const filter = (entries: NavigationItem[]): NavigationItem[] => entries.flatMap((item) => {
    if (!menuSearch.trim() || item.label.includes(menuSearch.trim())) return [item]
    const children = item.children?.filter((child) => child.label.includes(menuSearch.trim()))
    return children?.length ? [{ ...item, children }] : []
  })
  const shown = filter(items)
  const toMenu = (entries: NavigationItem[]): NonNullable<React.ComponentProps<typeof Menu>['items']> => entries.map((item) => ({
    key: item.key, label: item.label, icon: icons[item.key],
    children: item.children ? toMenu(item.children) : undefined,
  }))
  const menu = (collapsed = false) => <Menu
    mode="inline" inlineCollapsed={collapsed} selectedKeys={active ? [active.key] : []}
    {...(!collapsed ? {
      openKeys: shown.filter((item) => item.children && (menuSearch || !preferences.closed.includes(item.key))).map((item) => item.key),
      onOpenChange: (keys: string[]) => setPreferences((current) => ({ ...current, closed: items.filter((item) => item.children && !keys.includes(item.key)).map((item) => item.key) })),
    } : {})}
    items={toMenu(shown)} onClick={({ key }) => { navigate(key); setMobileOpen(false); setMenuSearch('') }}
  />
  const navContent = (collapsed = false) => <>
    <div className="operations-brand">
      <img src={collapsed ? PRODUCT.mark : PRODUCT.logo} alt={PRODUCT.brand} />
      {!collapsed && <span>{PRODUCT.name}</span>}
    </div>
    {!collapsed && <div className="operations-nav-search"><Input prefix={<SearchOutlined />} placeholder="搜尋功能" aria-label="搜尋功能"
      value={menuSearch} allowClear onChange={(event) => setMenuSearch(event.target.value)} /></div>}
    <nav aria-label="主選單" className="operations-nav-scroll">
      {menu(collapsed)}
      {!shown.length && <p className="operations-nav-empty">沒有符合的功能</p>}
    </nav>
  </>

  return <div className={`operations-layout${preferences.collapsed ? ' operations-layout--collapsed' : ''}`}>
    <a className="operations-skip" href="#operations-content">跳至主要內容</a>
    <CommandPalette />
    <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    {!mobile && <aside className="operations-sidebar">
      {navContent(preferences.collapsed)}
      <div className="operations-sidebar-footer"><Button type="text" block
        icon={preferences.collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        aria-label={preferences.collapsed ? '展開側欄' : '收合側欄'} aria-expanded={!preferences.collapsed}
        onClick={() => { setPreferences((current) => ({ ...current, collapsed: !current.collapsed })); setMenuSearch('') }}
      >{!preferences.collapsed && '收合側欄'}</Button></div>
    </aside>}
    <Drawer title={PRODUCT.name} placement="left" width="min(320px, 90vw)"
      open={mobile && mobileOpen} onClose={() => setMobileOpen(false)}
      className="operations-mobile-drawer" styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}>
      {navContent()}
    </Drawer>
    <div className="operations-main">
      <header className="operations-header">
        <div className="operations-header-title">
          {mobile && <Button type="text" icon={<MenuOutlined />} aria-label="開啟主選單" onClick={() => setMobileOpen(true)} />}
          <span>{active?.label || PRODUCT.name}</span>
        </div>
        <div className="operations-header-actions">
          <NotificationCenter />
          <Dropdown trigger={['click']} menu={{ items: [
            { key: 'profile', label: '個人資料', icon: <UserOutlined />, onClick: () => navigate('/profile') },
            { key: 'preferences', label: '介面設定', icon: <SettingOutlined />, onClick: () => setSettingsOpen(true) },
            { type: 'divider' },
            { key: 'logout', label: '登出', icon: <LogoutOutlined />, onClick: () => { logout(); navigate('/login') } },
          ] }}>
            <button type="button" className="operations-user" aria-label="帳號選單">
              <Avatar size={30} icon={<UserOutlined />} src={user?.avatar} />
              {!mobile && <span>{user?.name || user?.email}</span>}
            </button>
          </Dropdown>
        </div>
      </header>
      <main id="operations-content" className="operations-content" tabIndex={-1}>
        <motion.div key={location.pathname} initial={reducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}><Outlet /></motion.div>
      </main>
    </div>
  </div>
}
