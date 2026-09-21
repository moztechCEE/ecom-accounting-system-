import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.__APP_CONFIG__?.devEnvironment && <div role="status" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2000, background: '#fff3cd', color: '#664d03', padding: '6px 16px', textAlign: 'center', fontSize: 13 }}>
      DEV 測試環境 · 正式資料副本 {window.__APP_CONFIG__.dataSnapshotDate} · 測試不回寫正式系統，外部同步與發送停用
    </div>}
    <App />
  </StrictMode>,
)
