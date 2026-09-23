import api from './api'
import { wmsPortalOrigin } from '../config/wms-portal'

export type WorkRole = 'picker' | 'packer'
// The ticket is transferred only to the popup we opened, after checking its
// origin and nonce. Passwords, ERP tokens and tickets never enter a URL.
export function openWarehouseWork(role: WorkRole): Promise<void> {
  const origin = wmsPortalOrigin()
  if (!origin) return Promise.reject(new Error('尚未設定儲運工作台'))
  const popup = window.open(origin + '/erp-entry', '_blank')
  if (!popup) return Promise.reject(new Error('請允許開啟工作台視窗後重試'))
  return new Promise((resolve, reject) => {
    let issued = false
    const cleanup = () => { window.removeEventListener('message', receive); window.clearTimeout(timeout) }
    const receive = async (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== popup) return
      if (event.data?.type === 'corely-wms-opened') { cleanup(); resolve(); return }
      if (event.data?.type === 'corely-wms-error') { cleanup(); reject(new Error('無法開啟工作台，請重試')); return }
      if (event.data?.type !== 'corely-wms-ready' || issued || !/^[a-f0-9]{64}$/.test(event.data?.nonce || '')) return
      issued = true
      try {
        const { data } = await api.post('/wms/portal/ticket', { role, nonce: event.data.nonce })
        popup.postMessage({ type: 'corely-erp-ticket', ticket: data.ticket, nonce: event.data.nonce }, origin)
      } catch (error) { cleanup(); popup.close(); reject(error) }
    }
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('工作台連線逾時，請重試')) }, 30000)
    window.addEventListener('message', receive)
  })
}
