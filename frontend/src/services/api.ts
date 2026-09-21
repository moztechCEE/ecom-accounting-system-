import axios from 'axios'

declare global {
  interface Window {
    __APP_CONFIG__?: {
      apiUrl?: string
      defaultEntityId?: string
      wsUrl?: string
      stagedOperationsEnabled?: boolean
      devEnvironment?: boolean
      dataSnapshotDate?: string
    }
  }
}

// 根據環境自動選擇 baseURL
// 本地開發：使用 proxy (/api/v1)
// 正式環境：使用環境變數 (VITE_API_URL)
const getBaseURL = () => {
  const runtimeUrlRaw = window.__APP_CONFIG__?.apiUrl?.trim()
  if (runtimeUrlRaw) {
    return runtimeUrlRaw.replace(/\/+$/, '')
  }

  const envUrlRaw = import.meta.env.VITE_API_URL?.trim()
  if (envUrlRaw) {
    const envUrl = envUrlRaw.replace(/\/+$/, '')
    // If a full API prefix is not provided, default to backend global prefix `/api/v1`.
    // This prevents 404s in production when VITE_API_URL is set to a bare host.
    if (envUrl.startsWith('/')) {
      return envUrl
    }

    try {
      const url = new URL(envUrl)
      const pathname = (url.pathname || '/').replace(/\/+$/, '')

      if (pathname === '' || pathname === '/' || pathname === '/api') {
        url.pathname = '/api/v1'
        return url.toString().replace(/\/+$/, '')
      }

      if (pathname.startsWith('/api/')) {
        return envUrl
      }

      url.pathname = `${pathname}/api/v1`
      return url.toString().replace(/\/+$/, '')
    } catch {
      return envUrl
    }
  }
  if (import.meta.env.DEV) {
    return '/api/v1'
  }

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin.replace(/\/+$/, '')
      : ''

  return origin ? `${origin}/api/v1` : '/api/v1'
}

export const API_URL = getBaseURL()

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 請求攔截器：自動添加 token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 回應攔截器：處理錯誤
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
