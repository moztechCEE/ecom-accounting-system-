import React from 'react'
import { Layout, Button, Avatar, Dropdown, Badge, theme } from 'antd'
import type { MenuProps } from 'antd'
import { 
  MenuFoldOutlined, 
  MenuUnfoldOutlined,
  BellOutlined,
  SearchOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined
} from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

const { Header: AntHeader } = Layout

interface HeaderProps {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  isMobile: boolean
  setDrawerVisible: (visible: boolean) => void
}

const Header: React.FC<HeaderProps> = ({ 
  collapsed, 
  setCollapsed, 
  isMobile,
  setDrawerVisible 
}) => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { token } = theme.useToken()

  const handleLogout = async () => {
    if (await logout()) navigate('/login')
  }

  const userMenu: MenuProps['items'] = [
    {
      key: 'profile',
      label: '個人設定',
      icon: <UserOutlined />,
    },
    {
      key: 'settings',
      label: '系統設定',
      icon: <SettingOutlined />,
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      label: '登出',
      icon: <LogoutOutlined />,
      danger: true,
      onClick: handleLogout,
    },
  ]

  return (
    <AntHeader 
      className="!bg-white/80 !backdrop-blur-md sticky top-0 z-10 flex items-center justify-between px-4 md:px-6 border-b border-gray-200/50 shadow-sm transition-all duration-300"
      style={{ 
        paddingLeft: isMobile ? 16 : (collapsed ? 100 : 280), // Adjust padding based on sidebar
        height: 64,
      }}
    >
      <div className="flex items-center gap-4">
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => isMobile ? setDrawerVisible(true) : setCollapsed(!collapsed)}
          className="!text-gray-600 hover:!bg-gray-100 !w-10 !h-10 !rounded-xl flex items-center justify-center"
        />
        
        {!isMobile && (
          <div className="hidden md:flex items-center bg-gray-100/50 rounded-xl px-3 py-2 w-64 border border-transparent focus-within:border-blue-500/30 focus-within:bg-white transition-all">
            <SearchOutlined className="text-gray-400 mr-2" />
            <input 
              type="text" 
              placeholder="搜尋..." 
              className="bg-transparent border-none outline-none text-sm w-full text-gray-600 placeholder-gray-400"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 md:gap-6">
        <Button 
          type="text" 
          className="!text-gray-600 hover:!bg-gray-100 !w-10 !h-10 !rounded-xl flex items-center justify-center relative"
        >
          <Badge count={3} size="small" offset={[2, -2]} color="#ef4444">
            <BellOutlined className="text-lg" />
          </Badge>
        </Button>

        <Dropdown menu={{ items: userMenu }} placement="bottomRight" trigger={['click']}>
          <div className="flex items-center gap-3 cursor-pointer hover:bg-gray-100/50 p-1.5 pr-3 rounded-full transition-all border border-transparent hover:border-gray-200">
            <Avatar 
              size="default" 
              icon={<UserOutlined />} 
              className="!bg-gradient-to-br !from-blue-500 !to-purple-600"
            />
            {!isMobile && (
              <div className="flex flex-col items-start">
                <span className="text-sm font-medium text-gray-700 leading-tight">{user?.name || 'User'}</span>
                <span className="text-[10px] text-gray-500 leading-tight">Admin</span>
              </div>
            )}
          </div>
        </Dropdown>
      </div>
    </AntHeader>
  )
}

export default Header
