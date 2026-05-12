import React, { useState, useEffect } from 'react'
import { Layout, theme } from 'antd'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

const { Content } = Layout
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'mainSidebarCollapsed'

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return true
    }
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) !== 'false'
  })
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [drawerVisible, setDrawerVisible] = useState(false)
  
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (!mobile) {
        setDrawerVisible(false)
      } else {
        setCollapsed(true)
      }
    }

    window.addEventListener('resize', handleResize)
    handleResize() // Init check

    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isMobile) {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        collapsed ? 'true' : 'false',
      )
    }
  }, [collapsed, isMobile])

  return (
    <Layout className="min-h-screen bg-[#f8fafc]">
      <Sidebar 
        collapsed={collapsed} 
        setCollapsed={setCollapsed} 
        isMobile={isMobile}
        drawerVisible={drawerVisible}
        setDrawerVisible={setDrawerVisible}
      />
      
      <Layout 
        className="transition-all duration-300 ease-in-out"
        style={{ 
          marginLeft: isMobile ? 0 : (collapsed ? 80 : 260) 
        }}
      >
        <Header 
          collapsed={collapsed} 
          setCollapsed={setCollapsed} 
          isMobile={isMobile}
          setDrawerVisible={setDrawerVisible}
        />
        
        <Content className="p-4 md:p-6 overflow-initial">
          <div className="animate-fade-in min-h-[calc(100vh-112px)]">
            <Outlet />
          </div>
          
          <div className="text-center text-gray-400 text-xs mt-8 pb-4">
            © 2025 Ecom Accounting System. All rights reserved.
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
