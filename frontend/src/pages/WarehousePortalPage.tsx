import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Result, Spin } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useEntityContext } from '../hooks/useEntityContext'
import { companyNavigationDestination } from '../config/workspaces'
import { wmsPortalDestination, wmsPortalOrigin } from '../config/wms-portal'
import { loadWarehouseModule, nativeEntryPath, nativeHostSection, nativeSessionRequest, nativeSessionExpired, nativeTransport, nativeRecoveryRequest, type WarehouseHandle } from '../services/warehouse-native'

export default function WarehousePortalPage() {
  const { user } = useAuth()
  const entityId = useEntityContext()
  const location = useLocation()
  const navigate = useNavigate()
  const destination = wmsPortalDestination(user, location.pathname)
  const path = destination ? nativeEntryPath(destination.key, location.search) : null
  const origin = wmsPortalOrigin()
  const token = localStorage.getItem('access_token') || ''
  const identity = JSON.stringify([user?.id, entityId, token, user?.roles, user?.permissions])
  const latest = useRef({ identity, location, user, path })
  latest.current = { identity, location, user, path }
  const container = useRef<HTMLDivElement>(null)
  const handle = useRef<WarehouseHandle | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'auth'>('loading')
  const [error, setError] = useState('')
  const [companyRecovery, setCompanyRecovery] = useState<{ identity: string; switchCompany(): void } | null>(null)
  const key = destination?.key

  useEffect(() => {
    if (!key || !path || !user?.id || !entityId || !token || !origin || !container.current) return
    const controller = new AbortController()
    const startingIdentity = identity
    const actor = { userId: user.id, entityId, token }
    let mounted: WarehouseHandle | null = null
    const active = () => {
      const explicit = new URLSearchParams(latest.current.location.search).get('entityId')?.trim()
      return !controller.signal.aborted && latest.current.identity === startingIdentity && localStorage.getItem('access_token') === token && (explicit === entityId || (!explicit && localStorage.getItem('entityId')?.trim() === entityId))
    }
    const dispose = () => {
      controller.abort()
      mounted?.dispose()
      if (handle.current === mounted) handle.current = null
    }
    const expired = () => {
      if (!active()) return
      dispose()
      setStatus('auth')
      setError('作業連線已逾時，請重新連線')
    }
    // Stop the old session when another window signs out or changes company.
    const storageChanged = () => {
      if (controller.signal.aborted) return
      const explicit = new URLSearchParams(latest.current.location.search).get('entityId')?.trim()
      if (localStorage.getItem('access_token') !== token || (!explicit && localStorage.getItem('entityId')?.trim() !== entityId)) {
        dispose(); setStatus('auth'); setError('作業身分已變更，請重新連線')
      }
    }
    window.addEventListener('storage', storageChanged)
    window.addEventListener('focus', storageChanged)
    setStatus('loading'); setError(''); setCompanyRecovery(null)
    const deadline = window.setTimeout(() => {
      if (active()) { dispose(); setStatus('error'); setError('儲運作業連線逾時，請重試') }
    }, 45000)
    void (async () => {
      try {
        // Do not rotate an operator session if its module is unpublished.
        const { manifest, module } = await loadWarehouseModule(origin, controller.signal)
        if (!active()) return
        const session = await nativeSessionRequest(key.replace(/^\/warehouse\/?/, '') || 'tasks', actor, controller.signal)
        if (!active()) return
        const transport = nativeTransport(actor, session, active, controller.signal)
        mounted = await module.mountWorkspace(container.current!, {
          session, initialPath: latest.current.path || path, manifest, assetOrigin: origin, socketOrigin: origin,
          signal: controller.signal, transport: transport.request,
          download: async input => {
            try { return await transport.download(input) }
            catch (cause) { if (nativeSessionExpired(cause)) expired(); throw cause }
          },
          navigate: (next, options) => {
            if (!active()) return
            const current = latest.current
            const nextKey = nativeHostSection(next, key, session.user.role)
            if (!nextKey || !wmsPortalDestination(current.user, nextKey)) return
            const params = new URLSearchParams()
            params.set('wms', next)
            const target = companyNavigationDestination(nextKey + '?' + params.toString(), current.location.search)
            if (target !== current.location.pathname + current.location.search) navigate(target, { replace: options?.replace })
          },
          onAuthRequired: expired,
          onReload: () => { if (active()) { dispose(); setAttempt(value => value + 1) } },
        })
        if (!active()) { mounted.dispose(); return }
        handle.current = mounted
        setStatus('ready')
      } catch (cause: any) {
        if (!active()) return
        const mismatch = cause?.response?.status === 403 && [cause?.response?.data?.code, cause?.response?.data?.message].includes('WMS_NATIVE_ENTITY_MISMATCH')
        if (mismatch) {
          try {
            const recoveryEntity = await nativeRecoveryRequest(key, actor, controller.signal)
            if (!active()) return
            setStatus('error')
            if (recoveryEntity && recoveryEntity !== entityId) {
              setError('請切換至倉儲公司')
              setCompanyRecovery({ identity: startingIdentity, switchCompany: () => {
                const current = latest.current.location
                if (!active() || current.pathname !== location.pathname || !nativeEntryPath(key, current.search)) return
                const params = new URLSearchParams(current.search)
                params.set('entityId', recoveryEntity)
                navigate(current.pathname + '?' + params.toString() + current.hash)
              } })
            } else setError('無法確認倉儲公司，請重試')
          } catch (recoveryCause: any) {
            if (!active()) return
            dispose()
            setStatus(recoveryCause?.response?.status === 401 ? 'auth' : 'error')
            setError(recoveryCause?.response?.status === 401 ? '作業連線已逾時，請重新連線' : recoveryCause?.response?.status === 403 ? '沒有此儲運功能權限，請聯絡管理員' : '無法確認倉儲公司，請重試')
          }
        } else {
          dispose()
          setStatus(cause?.response?.status === 401 ? 'auth' : 'error')
          setError(cause?.response?.status === 403 ? '沒有此儲運功能權限，請聯絡管理員' : '無法載入儲運作業，請重試')
        }
      } finally { window.clearTimeout(deadline) }
    })()
    return () => {
      window.clearTimeout(deadline)
      window.removeEventListener('storage', storageChanged)
      window.removeEventListener('focus', storageChanged)
      dispose()
    }
  }, [key, identity, origin, attempt, !!path])

  useEffect(() => {
    if (path && status === 'ready') handle.current?.navigate(path, { replace: true })
  }, [path, status])

  if (!destination) return <Result status="403" title="沒有此儲運功能權限" />
  if (!path) return <Result status="404" title="找不到這筆儲運作業" />
  if (!token || !entityId) return <Result status="403" title="請重新登入並選擇公司" />
  return <section aria-label={destination.label} style={{ minHeight: 420 }}>
    {status === 'loading' && <div role="status" style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}><Spin tip="載入儲運作業" size="large"><div style={{ width: 160, height: 80 }} /></Spin></div>}
    {(status === 'error' || status === 'auth') && <Alert type={status === 'auth' ? 'warning' : 'error'} message={error} showIcon
      action={companyRecovery?.identity === identity ? <Button onClick={companyRecovery.switchCompany}>切換至倉儲公司</Button> : <Button onClick={() => setAttempt(value => value + 1)}>重新連線</Button>} />}
    <div ref={container} hidden={status !== 'ready'} style={{ width: '100%' }} />
  </section>
}
