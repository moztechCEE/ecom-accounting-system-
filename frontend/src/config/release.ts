// Availability only, never an authorization check. Backend permissions and
// command gates remain authoritative when these staged workflows are enabled.
export function stagedOperationsEnabled(): boolean {
  return typeof window !== 'undefined' && window.__APP_CONFIG__?.stagedOperationsEnabled === true
}
