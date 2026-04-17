import React from 'react'
import { Layout, Menu, Button, Drawer, Avatar, Dropdown, theme } from 'antd'
import type { MenuProps } from 'antd'
import { 
  MenuFoldOutlined, 
  MenuUnfoldOutlined,
  DashboardOutlined,
  UserOutlined,
  TeamOutlined,
  ShoppingOutlined,
  FileTextOutlined,
  BankOutlined,
  DollarOutlined,
  ImportOutlined,
  LogoutOutlined,
  SettingOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { GlassDrawer } from '../ui/GlassDrawer'
import { useAuth } from '../../contexts/AuthContext'

const { Sider, Content } = Layout

interface SidebarProps {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  isMobile: boolean
  drawerVisible: boolean
  setDrawerVisible: (visible: boolean) => void
}

const Sidebar: React.FC<SidebarProps> = ({ 
  collapsed, 
  setCollapsed, 
  isMobile,
  drawerVisible,
  setDrawerVisible
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const menuItems: MenuProps['items'] = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '儀表板',
    },
    {
      key: '/users',
      icon: <UserOutlined />,
      label: '使用者與權限',
      // hidden: !user?.roles.includes('ADMIN') // Example permission check
    },
    {
      key: '/partners',
      icon: <TeamOutlined />,
      label: '客戶與廠商',
      children: [
        { key: '/customers', label: '客戶管理' },
        { key: '/vendors', label: '廠商管理' },
      ]
    },
    {
      key: '/sales',
      icon: <ShoppingOutlined />,
      label: '訂單與銷售',
    },
    {
      key: '/expenses',
      icon: <FileTextOutlined />,
      label: '費用與審批',
      children: [
        { key: '/ap/expenses', label: '費用申請' },
        { key: '/ap/expense-review', label: '費用審核中心' },
        { key: '/ap/payable', label: '應付帳款 (AP)' },
      ],
    },
    {
      key: '/attendance',
      icon: <ClockCircleOutlined />,
      label: '考勤管理',
      children: [
        { key: '/attendance/dashboard', label: '打卡儀表板' },
        { key: '/attendance/leaves', label: '請假申請' },
      ],
    },
    {
      key: '/payroll',
      icon: <DollarOutlined />,
      label: '薪資管理',
      children: [
        { key: '/payroll/runs', label: '薪資計算' },
        { key: '/payroll/employees', label: '員工與部門' },
        { key: '/attendance/admin', label: '完整考勤後台' },
      ],
    },
    {
      key: '/banking',
      icon: <BankOutlined />,
      label: '銀行對帳',
    },
    {
      key: '/import',
      icon: <ImportOutlined />,
      label: '匯入中心',
    },
  ]

  const handleMenuClick = (e: { key: string }) => {
    navigate(e.key)
    if (isMobile) {
      setDrawerVisible(false)
    }
  }

  const MenuContent = (
    <div className="h-full flex flex-col">
      <div className={`h-16 flex items-center justify-center border-b border-gray-200/50 transition-all duration-300 ${collapsed ? 'px-2' : 'px-6'}`}>
        {!collapsed ? (
          <div className="flex items-center gap-2 animate-fade-in">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-bold shadow-lg">
              E
            </div>
            <span className="text-gray-800 font-medium text-lg tracking-wide">Ecom System</span>
          </div>
        ) : (
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-bold shadow-lg">
            E
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['/partners', '/expenses']} // Optional: keep some submenus open
          items={menuItems}
          onClick={handleMenuClick}
          className="!bg-transparent !border-none"
          theme="light"
          inlineCollapsed={collapsed && !isMobile}
        />
      </div>

      {!collapsed && (
        <div className="p-4 border-t border-gray-200/50">
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-200/50">
            <div className="text-xs text-gray-400 mb-1">系統狀態</div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
              <span className="text-xs text-gray-600">系統運作正常</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <GlassDrawer
        placement="left"
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        width={280}
      >
        {MenuContent}
      </GlassDrawer>
    )
  }

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={260}
      className="!bg-white/80 !backdrop-blur-xl border-r border-gray-200/50 shadow-sm z-20 hidden md:block"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        height: '100vh',
      }}
    >
      {MenuContent}
    </Sider>
  )
}

export default Sidebar
