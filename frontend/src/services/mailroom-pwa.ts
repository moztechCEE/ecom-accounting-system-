/** The public offline shell never stores application pages or business requests. */
export function registerMailroomPwa(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return
  const { protocol, hostname } = window.location
  const loopback = hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  if (!window.isSecureContext || !('serviceWorker' in navigator) ||
    !(protocol === 'https:' || (protocol === 'http:' && loopback))) return
  try {
    void navigator.serviceWorker.register('/mailroom-sw.js', {
      scope: '/operations/',
      updateViaCache: 'none',
    }).catch(() => undefined)
  } catch {
    // An unsupported or blocked registration must not prevent normal app startup.
  }
}
