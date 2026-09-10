import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'antd/dist/reset.css'
import AfterSalesWorkbenchPage from '../src/pages/AfterSalesWorkbenchPage'
import { AuthProvider } from '../src/contexts/AuthContext'
import { authService } from '../src/services/auth.service'

// Standalone, development-only fixture entry. Never included by the production index.
window.__APP_CONFIG__ = { apiUrl: '/api/v1', stagedOperationsEnabled: true }
localStorage.setItem('entityId', 'test-entity')
authService.getToken = () => null
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider><BrowserRouter>
      <main style={{ padding: 24, background: '#f4f6f8', minHeight: '100vh' }}>
        <p>本機測試資料 · 非正式案件</p>
        <AfterSalesWorkbenchPage />
      </main>
    </BrowserRouter></AuthProvider>
  </React.StrictMode>,
)
