import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { preparationFixture } from './preparation-fixture'
import { wmsFixture } from './wms-fixture'

const rows = Array.from({ length: 57 }, (_, index) => ({
  id: `fixture-${index + 1}`,
  caseNumber: `TEST-${String(index + 1).padStart(4, '0')}`,
  type: [
    'RESHIPMENT',
    'PRIVATE_PURCHASE',
    'REPAIR',
    'EXCHANGE_RETURN',
    'REFUND_PICKUP',
    'CUSTOMER_ISSUE',
  ][index % 6],
  status: index > 46 ? 'CLOSED' : 'PENDING_SHIPMENT',
  contactName: `測試聯絡人 ${index + 1}`,
  sourceChannel: '1SHOP',
  isUrgent: index < 3,
  assigneeName: '測試客服',
  updatedAt: '2026-09-04T03:00:00Z',
  workflow: {
    stageLabel: index > 46 ? '已結案' : '待出貨',
    ownerRoleLabel: '倉管',
    isOverdue: false,
  },
}))
const meta = {
  mode: 'read_only',
  checkedAt: '2026-09-04T03:00:00Z',
  sourceCommit: 'fixture',
  featureBaseline: 'fixture',
}

export default defineConfig({
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  plugins: [
    wmsFixture(),
    preparationFixture(),
    react(),
    {
      name: 'read-only-after-sales-test-fixture',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url || '/', 'http://localhost')
          if (!url.pathname.startsWith('/api/v1/after-sales/workbench/'))
            return next()
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('{}')
            return
          }
          if (url.searchParams.get('entityId') !== 'test-entity') {
            res.statusCode = 403
            res.end('{}')
            return
          }
          if (url.searchParams.get('search') === 'simulate-error') {
            res.statusCode = 502
            res.end('{}')
            return
          }
          if (url.pathname.endsWith('/cases')) {
            const search = url.searchParams.get('search') || ''
            const base = rows.filter(
              (row) =>
                (!url.searchParams.get('type') ||
                  row.type === url.searchParams.get('type')) &&
                (!url.searchParams.get('status') ||
                  row.status === url.searchParams.get('status')) &&
                (!search || row.caseNumber.includes(search)),
            )
            const view = url.searchParams.get('view') || 'active'
            const filtered = base.filter(
              (row) =>
                view === 'all' ||
                (view === 'closed'
                  ? row.status === 'CLOSED'
                  : row.status !== 'CLOSED' &&
                    (view !== 'urgent' || row.isUrgent)),
            )
            const page = Number(url.searchParams.get('page') || 1),
              pageSize = Number(url.searchParams.get('pageSize') || 25)
            res.end(
              JSON.stringify({
                ...meta,
                items: filtered.slice((page - 1) * pageSize, page * pageSize),
                page: {
                  number: page,
                  pageSize,
                  totalCount: filtered.length,
                  hasMore: page * pageSize < filtered.length,
                },
                summary: {
                  total: base.length,
                  active: base.filter((r) => r.status !== 'CLOSED').length,
                  urgent: base.filter(
                    (r) => r.isUrgent && r.status !== 'CLOSED',
                  ).length,
                  closed: base.filter((r) => r.status === 'CLOSED').length,
                },
              }),
            )
            return
          }
          const row = rows.find((r) => url.pathname.endsWith(`/${r.id}`))
          if (!row) {
            res.statusCode = 404
            res.end('{}')
            return
          }
          const field = (
            key: string,
            label: string,
            value: string | number | boolean,
          ) => ({ key, label, value })
          res.end(
            JSON.stringify({
              ...meta,
              ...row,
              sections: [
                {
                  key: 'contact',
                  title: '案件',
                  records: [
                    {
                      key: row.id,
                      fields: [
                        field('contactName', '聯絡人', row.contactName),
                        field('referenceNumber', '原始單號', 'TEST-ORDER-001'),
                        field('sourceChannel', '來源通路', '1SHOP'),
                      ],
                    },
                  ],
                },
                {
                  key: 'items',
                  title: '商品',
                  records: [
                    {
                      key: 'item',
                      fields: [
                        field('productNameSnapshot', '商品', '測試補件商品'),
                        field('quantity', '數量', 1),
                        field('unitPrice', '來源單價', '0.00'),
                      ],
                    },
                  ],
                },
                {
                  key: 'invoiceRecords',
                  title: '發票',
                  records: [
                    {
                      key: 'invoice',
                      fields: [
                        field('isRequired', '需發票', false),
                        field('status', '狀態', 'NOT_REQUIRED'),
                      ],
                    },
                  ],
                },
                { key: 'refundRecords', title: '退款', records: [] },
              ],
            }),
          )
        })
      },
    },
  ],
  server: { host: '127.0.0.1', port: 4390, strictPort: true },
})
