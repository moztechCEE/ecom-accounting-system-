/** Isolated localhost preview only; never used by the production entrypoint. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

if (process.env.REPAIR_LOCAL_TEST !== 'true')
  throw new Error('Set REPAIR_LOCAL_TEST=true to use the isolated repair preview.');

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = new URL(process.env.REPAIR_PREVIEW_API_URL || 'http://127.0.0.1:57654');
if (
  api.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) ||
  api.username || api.password || api.search || api.hash ||
  !['/', '/api/v1', '/api/v1/'].includes(api.pathname) ||
  ['57643', '57644', '57646', '57656'].includes(api.port)
)
  throw new Error('REPAIR_PREVIEW_API_URL must be a separate localhost fixture API, outside existing mailroom ports.');

const users = {
  'fixture-doa-tech': { name: '維修師', destination: '/operations/repair' },
  'fixture-doa-clerk': { name: '收發室人員', destination: '/operations/mailroom' },
  'fixture-doa-csr': { name: '客服覆核', destination: '/my/inbox' },
};
const config = {
  apiUrl: '/api/v1',
  wsUrl: 'http://127.0.0.1:57656',
  mailroomEnabled: true,
  stagedOperationsEnabled: true,
  defaultEntityId: process.env.REPAIR_PREVIEW_ENTITY_ID || 'fixture-doa-company',
  devEnvironment: true,
  wmsPortalUrl: '',
  b2bPublicOrderEnabled: false,
};
const websocketStub = `
class PreviewWebSocketService {
  connect() {}
  disconnect() {}
  subscribe() { return () => {}; }
}
export const webSocketService = new PreviewWebSocketService();
`;
const server = await createServer({
  root: frontendRoot,
  configFile: false,
  define: {
    'import.meta.env.VITE_MAILROOM_ENABLED': JSON.stringify('true'),
    'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1'),
    'import.meta.env.VITE_WMS_PORTAL_URL': JSON.stringify(''),
  },
  plugins: [
    react(),
    {
      name: 'isolated-doa-local-preview',
      enforce: 'pre',
      transform(_code, id) {
        // Notification sockets are disabled only in this preview. HTTP refresh
        // and persisted fixture notifications remain available for inspection.
        if (id.split('?')[0].replaceAll('\\', '/').endsWith('/src/services/websocket.service.ts'))
          return { code: websocketStub, map: null };
      },
      transformIndexHtml: () => [{
        tag: 'script',
        children: `window.__APP_CONFIG__=${JSON.stringify(config)};`,
        injectTo: 'head-prepend',
      }, {
        tag: 'aside',
        attrs: {
          'aria-label': '本機維修工作台示範',
          style: 'position:fixed;right:12px;bottom:12px;z-index:2000;background:#fff8d8;border:1px solid #dac578;border-radius:8px;padding:8px 12px;font:12px system-ui;box-shadow:0 2px 8px #0002',
        },
        children: '本機合成資料 · 通知不對外發送 · <a href="/_repair_fixture">切換示範角色</a>',
        injectTo: 'body',
      }],
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1:57656');
          if (url.pathname !== '/_repair_fixture') return next();
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          const user = url.searchParams.get('user');
          if (user && Object.hasOwn(users, user)) {
            res.end(`<script>localStorage.setItem('access_token',${JSON.stringify(user)});localStorage.setItem('entityId',${JSON.stringify(config.defaultEntityId)});location.href=${JSON.stringify(users[user].destination)};</script>`);
            return;
          }
          res.end(`<html lang="zh-TW"><meta charset="utf-8"><title>DOA 售後維修工作台本機示範</title><body style="font:18px system-ui;padding:48px;max-width:800px;background:#f3f7f8"><h1>DOA 售後維修工作台</h1><p>獨立 localhost 合成資料。這個入口不啟動資料庫、不使用原收發室 fixture，也不發送外部通知。</p><p>檢修單、維修單與交接操作只由隔離的本機 API 處理；AI 客服、虛擬帳號及 WMS 庫存尚未串接。</p>${Object.entries(users).map(([id, user]) => `<p><a href="/_repair_fixture?user=${id}">${user.name}</a></p>`).join('')}</body></html>`);
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 57656,
    strictPort: true,
    proxy: { '/api': { target: api.origin, changeOrigin: true, ws: false } },
  },
});
await server.listen();
console.log(`Isolated DOA preview: http://127.0.0.1:57656/_repair_fixture (local API ${api.origin})`);

const stop = async () => { await server.close(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
