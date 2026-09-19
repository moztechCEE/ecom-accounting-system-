import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  plugins: [react(), { name: 'sn-readonly-fixture', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next()
      res.setHeader('Content-Type', 'application/json')
      if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return }
      if (req.url === '/api/v1/products') {
        res.end(JSON.stringify([{ id: 'sn-test-a16', name: '太空艙（測試商品）', sku: 'TEST-A16-LK', barcode: '4710000000000', modelNumber: 'MOA16', type: 'FINISHED_GOOD' }]))
      } else { res.statusCode = 404; res.end('{}') }
    })
  } }],
})
