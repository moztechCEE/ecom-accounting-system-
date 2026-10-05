/** Visible operating workbenches use a bounded DB fallback across independent websocket instances. */
export function notificationRefreshInterval(pathname: string) {
  return (/^\/operations\/(?:after-sales|repair|mailroom)(?:\/|$)/.test(pathname) || pathname === '/my/inbox' || pathname === '/inventory/after-sales-stock') ? 15000 : 60000;
}
export function createVisibleRefresh(visible: () => boolean, work: () => Promise<void>) {
  let running = false;
  return async () => {
    if (running || !visible()) return false;
    running = true;
    try { await work(); return true; }
    finally { running = false; }
  };
}
