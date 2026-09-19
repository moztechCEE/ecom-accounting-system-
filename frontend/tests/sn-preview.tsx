// Test-only entry. All API traffic is served by the local read-only fixture.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import 'antd/dist/reset.css'
import '../src/index.css'
import { AuthProvider } from '../src/contexts/AuthContext'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import { authService } from '../src/services/auth.service'
import { notificationService } from '../src/services/notification.service'
import { webSocketService } from '../src/services/websocket.service'
import DashboardLayout from '../src/components/DashboardLayout'
import PermissionRoute from '../src/components/PermissionRoute'
import SnLabelsPage from '../src/pages/SnLabelsPage'

window.__APP_CONFIG__ = { apiUrl: '/api/v1' }
const denied = new URLSearchParams(location.search).has('denied')
localStorage.setItem('entityId', 'sn-preview-entity')
authService.getToken = () => 'fixture-only'
authService.getCurrentUser = async () => ({ id: 'sn-preview-user', name: '設計測試', email: 'sn@example.invalid', roles: ['EMPLOYEE'], permissions: denied ? [] : ['inventory:read'] })
notificationService.getNotifications = async () => []
webSocketService.connect = () => {}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><AuthProvider>
  <MemoryRouter initialEntries={['/inventory/sn-labels']}><Routes><Route element={<DashboardLayout />}>
    <Route path="/inventory/sn-labels" element={<PermissionRoute anyPermissions={['inventory:read']}><SnLabelsPage /></PermissionRoute>} />
    <Route path="*" element={<p>本機測試頁面</p>} />
  </Route></Routes></MemoryRouter>
</AuthProvider></ThemeProvider></React.StrictMode>)
