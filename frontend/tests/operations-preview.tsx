import React from 'react'
import { Select } from 'antd'
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
import SalesOrderCreate from '../src/components/SalesOrderCreate'
import api from '../src/services/api'
import { WAREHOUSE_AREAS } from '../src/config/workspaces'

// Test-only entry: no production API, real credentials or write operations.
window.__APP_CONFIG__ = { apiUrl: '/api/v1' }
localStorage.setItem('entityId', 'test-entity')
authService.getToken = () => 'test-only'
const roleOptions=[{value:'admin',label:'管理員'},{value:'business',label:'業務建單'},{value:'worker',label:'揀貨／裝箱'},{value:'dispatcher',label:'訂單調度'},{value:'picker',label:'揀貨員'},{value:'packer',label:'裝箱員'},{value:'shipping',label:'出貨人員'}]
const roleParam=new URLSearchParams(location.search).get('role')||'admin'
const previewRole=roleOptions.some(o=>o.value===roleParam)?roleParam:'admin'
const areaKey:Record<string,string>={business:'dispatch',dispatcher:'dispatch',picker:'pick',packer:'pack',shipping:'shipping'}
api.defaults.headers.common['X-Wms-Fixture-Role']=previewRole
authService.getCurrentUser = async () => ({ id: 'preview', email: 'preview@example.invalid', name: `測試${roleOptions.find(o=>o.value===previewRole)!.label}`, roles: [previewRole==='admin'?'SUPER_ADMIN':'EMPLOYEE'], permissions: previewRole==='admin'?[]:['wms_tasks:read',...(previewRole==='business'?['sales_orders:read','sales_orders:create']:[]),...(previewRole==='worker'?['wms_picking:execute','wms_packing:execute']:[WAREHOUSE_AREAS.find(a=>a.key===areaKey[previewRole])!.permission]),'attendance_self:read','leave_self:read','profile_self:read'] })
authService.getLoginEntities = async () => [{ id: 'test-entity', loginCode: 'TEST' }]
webSocketService.connect = () => {}
notificationService.getNotifications = async () => []
const initial = new URLSearchParams(location.search).get('screen') || '/sales/after-sales?type=REPAIR'
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ThemeProvider><div style={{position:'fixed',bottom:16,right:20,zIndex:1200,background:'white',padding:'6px 10px',border:'1px solid #ddd',borderRadius:8}}>預覽角色 <Select aria-label="預覽角色" value={previewRole} options={roleOptions} style={{width:120}} onChange={value=>{const url=new URL(location.href);url.searchParams.set('role',value);location.assign(url)}} /></div><AuthProvider><MemoryRouter initialEntries={[initial]}>
    <Routes><Route path="/login" element={<LoginPage />} /><Route element={<DashboardLayout />}>
      <Route path="/warehouse" element={<WarehouseCenterPage />} />
      <Route path="/sales/orders/new" element={<SalesOrderCreate entityId="test-entity" onCreated={()=>{}} onClose={()=>{location.href='?screen=%2Fwarehouse&role=business'}}/>}/>
      <Route path="/sales/after-sales" element={<AfterSalesWorkbenchPage />} />
      <Route path="/sales/after-sales/quotes" element={<AfterSalesQuotesPage />} />
      <Route path="/admin/after-sales-brands" element={<AfterSalesBrandsPage />} />
      <Route path="*" element={<p>本機導覽驗證 · 非正式資料</p>} />
    </Route></Routes>
  </MemoryRouter></AuthProvider></ThemeProvider></React.StrictMode>,
)
