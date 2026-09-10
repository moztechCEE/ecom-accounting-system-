import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import 'antd/dist/reset.css'
import '../src/index.css'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import { AuthProvider } from '../src/contexts/AuthContext'
import { authService } from '../src/services/auth.service'
import { webSocketService } from '../src/services/websocket.service'
import { notificationService } from '../src/services/notification.service'
import DashboardLayout from '../src/components/DashboardLayout'
import AfterSalesWorkbenchPage from '../src/pages/AfterSalesWorkbenchPage'
import LoginPage from '../src/pages/LoginPage'
import WarehouseCenterPage from '../src/pages/WarehouseCenterPage'
import AfterSalesBrandsPage from '../src/pages/AfterSalesBrandsPage'
import AfterSalesQuotesPage from '../src/pages/AfterSalesQuotesPage'

// Test-only entry: no production API, real credentials or write operations.
window.__APP_CONFIG__ = { apiUrl: '/api/v1' }
localStorage.setItem('entityId', 'test-entity')
authService.getToken = () => 'test-only'
authService.getCurrentUser = async () => ({ id: 'preview', email: 'preview@example.invalid', name: '設計驗證', roles: ['SUPER_ADMIN'], permissions: [] })
authService.getLoginEntities = async () => [{ id: 'test-entity', loginCode: 'TEST' }]
webSocketService.connect = () => {}
notificationService.getNotifications = async () => []
const initial = new URLSearchParams(location.search).get('screen') || '/sales/after-sales?type=REPAIR'
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ThemeProvider><AuthProvider><MemoryRouter initialEntries={[initial]}>
    <Routes><Route path="/login" element={<LoginPage />} /><Route element={<DashboardLayout />}>
      <Route path="/warehouse" element={<WarehouseCenterPage />} />
      <Route path="/sales/after-sales" element={<AfterSalesWorkbenchPage />} />
      <Route path="/sales/after-sales/quotes" element={<AfterSalesQuotesPage />} />
      <Route path="/admin/after-sales-brands" element={<AfterSalesBrandsPage />} />
      <Route path="*" element={<p>本機導覽驗證 · 非正式資料</p>} />
    </Route></Routes>
  </MemoryRouter></AuthProvider></ThemeProvider></React.StrictMode>,
)
