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
import WarehouseReportsPage from '../src/pages/WarehouseReportsPage'
import AfterSalesBrandsPage from '../src/pages/AfterSalesBrandsPage'
import AfterSalesQuotesPage from '../src/pages/AfterSalesQuotesPage'
import SalesOrderCreate from '../src/components/SalesOrderCreate'
import api from '../src/services/api'
import { WAREHOUSE_AREAS, WAREHOUSE_REPORTS } from '../src/config/workspaces'

// Test-only entry: no production API, real credentials or write operations.
window.__APP_CONFIG__ = { apiUrl: '/api/v1', stagedOperationsEnabled: true }
localStorage.setItem('entityId', 'test-entity')
authService.getToken = () => 'test-only'
const roleOptions=[{value:'admin',label:'系統管理員'},{value:'supervisor',label:'儲運主管'},{value:'business',label:'業務端'},{value:'worker',label:'倉儲員（雙工作站）'},{value:'picker',label:'揀貨員'},{value:'packer',label:'裝箱員'}]
const roleParam=new URLSearchParams(location.search).get('role')||'admin'
const previewRole=roleOptions.some(o=>o.value===roleParam)?roleParam:'admin'
const areaKey:Record<string,string>={business:'dispatch',dispatcher:'dispatch',picker:'pick',packer:'pack',shipping:'shipping'}
api.defaults.headers.common['X-Wms-Fixture-Role']=previewRole
authService.getCurrentUser = async () => ({ id: 'preview', email: 'preview@example.invalid', name: `測試${roleOptions.find(o=>o.value===previewRole)!.label}`, roles: [previewRole==='admin'?'SUPER_ADMIN':'EMPLOYEE'], permissions: previewRole==='admin'?[]:['wms_tasks:read',...(previewRole==='supervisor'?['wms_overview:read',...WAREHOUSE_REPORTS.map(r=>r.permission)]:[...(previewRole==='business'?['sales_orders:read','sales_orders:create']:[]),...(previewRole==='worker'?['wms_picking:execute','wms_packing:execute']:[WAREHOUSE_AREAS.find(a=>a.key===areaKey[previewRole])!.permission])]),'attendance_self:read','leave_self:read','profile_self:read'] })
authService.getLoginEntities = async () => [{ id: 'test-entity', loginCode: 'TEST' }]
webSocketService.connect = () => {}
notificationService.getNotifications = async () => []
const initial = new URLSearchParams(location.search).get('screen') || '/sales/after-sales?type=REPAIR'
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ThemeProvider><nav aria-label="本機測試帳號" style={{position:'relative',zIndex:1201,display:'flex',gap:16,padding:'8px 20px',background:'#eef3f9',fontSize:13,alignItems:'center',flexWrap:'wrap'}}><strong>本機預覽</strong>{roleOptions.map(role=><a key={role.value} aria-current={role.value===previewRole?'page':undefined} style={{fontWeight:role.value===previewRole?700:400,textDecoration:role.value===previewRole?'underline':'none'}} href={`?screen=%2Fwarehouse&role=${role.value}`}>{role.label}</a>)}</nav><AuthProvider><MemoryRouter initialEntries={[initial]}>
    <Routes><Route path="/login" element={<LoginPage />} /><Route element={<DashboardLayout />}>
      <Route path="/warehouse" element={<WarehouseCenterPage />} />
      <Route path="/warehouse/workstation" element={<WarehouseCenterPage workstationOnly />} />
      <Route path="/warehouse/:report" element={<WarehouseReportsPage />} />
      <Route path="/sales/orders/new" element={<SalesOrderCreate entityId="test-entity" onCreated={()=>{}} onClose={()=>{location.href='?screen=%2Fwarehouse&role=business'}}/>}/>
      <Route path="/sales/after-sales" element={<AfterSalesWorkbenchPage />} />
      <Route path="/sales/after-sales/quotes" element={<AfterSalesQuotesPage />} />
      <Route path="/admin/after-sales-brands" element={<AfterSalesBrandsPage />} />
      <Route path="*" element={<p>本機導覽驗證 · 非正式資料</p>} />
    </Route></Routes>
  </MemoryRouter></AuthProvider></ThemeProvider></React.StrictMode>,
)
