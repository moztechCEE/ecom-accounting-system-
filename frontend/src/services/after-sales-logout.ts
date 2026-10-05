export const AFTER_SALES_LOGOUT_PATH = '/after-sales-app/api/integration/erp/logout'
export const AFTER_SALES_LOGOUT_TIMEOUT_MS = 3000
export const AFTER_SALES_LOGOUT_ORIGINS = [
  'https://corely-erp-dev-sp5g377smq-de.a.run.app',
  'https://aftersales-review---corely-erp-dev-sp5g377smq-de.a.run.app',
  'https://aftersales-final---corely-erp-dev-sp5g377smq-de.a.run.app',
]

export async function clearAfterSalesBrowserSession(
  origin: string,
  moduleEnabled: boolean,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  // Preserve ordinary ERP logout outside this DEV-only integration, while
  // clearing an older DEV module cookie even after the module flag was disabled.
  if (!moduleEnabled && !AFTER_SALES_LOGOUT_ORIGINS.includes(origin)) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AFTER_SALES_LOGOUT_TIMEOUT_MS)
  try {
    const response = await fetcher(AFTER_SALES_LOGOUT_PATH, {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      signal: controller.signal, redirect: 'error', cache: 'no-store',
    })
    if (response.status !== 204) throw new Error('SESSION_CLEAR_FAILED')
  } catch {
    throw new Error('無法清除先前的售後登入狀態，請稍後重試')
  } finally {
    clearTimeout(timeout)
  }
}

export async function completeErpLogout(options: {
  clearModuleSession: () => Promise<void>
  logoutWms?: () => Promise<unknown>
  logoutLocal: () => void
}): Promise<void> {
  await options.clearModuleSession()
  await options.logoutWms?.()
  options.logoutLocal()
}

export async function completeErpLogin<T>(options: {
  clearModuleSession: () => Promise<void>
  login: () => Promise<T>
}): Promise<T> {
  await options.clearModuleSession()
  return options.login()
}

export async function clearInvalidErpSession(options: {
  clearModuleSession: () => Promise<void>
  logoutLocal: () => void
}): Promise<void> {
  try { await options.clearModuleSession() }
  catch { /* Startup cleanup is best effort; an invalid local JWT must be removed. */ }
  options.logoutLocal()
}
