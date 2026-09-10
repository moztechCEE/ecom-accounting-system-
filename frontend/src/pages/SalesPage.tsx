import React, { useCallback, useState, useEffect } from 'react'
import { Alert, Table, Tag, Button, Space, Input, DatePicker, Card, Typography, Segmented, message } from 'antd'
import { 
  SearchOutlined, 
  FilterOutlined, 
  DownloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  AppstoreOutlined,
  BarsOutlined,
  ReloadOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import * as XLSX from 'xlsx'
import dayjs, { Dayjs } from 'dayjs'
import OrderDetailsDrawer from '../components/OrderDetailsDrawer'
import SalesAnalytics from '../components/SalesAnalytics'
import { salesService, SalesOrder } from '../services/sales.service'
import { dashboardService, EcommerceHistory } from '../services/dashboard.service'
import { resolveEntityId } from '../services/entities.service'
import SalesOrderCreate from '../components/SalesOrderCreate'
import {useAuth} from '../contexts/AuthContext'
import {useEntityContext} from '../hooks/useEntityContext'
import {hasPermission} from '../utils/access'
import {stagedOperationsEnabled} from '../config/release'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

type QuickRange = 'today' | 'last7Days' | 'lastMonth' | 'lastYear' | 'custom'

const KanbanColumn: React.FC<{ title: string; orders: SalesOrder[]; color: string; onClick: (order: SalesOrder) => void }> = ({ title, orders, color, onClick }) => (
  <div className="flex-1 min-w-[300px] glass-panel p-4">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${color}`} />
        <span className="font-medium text-gray-700">{title}</span>
        <span className="bg-white/50 px-2 py-0.5 rounded-full text-xs text-gray-500">{orders.length}</span>
      </div>
    </div>
    <div className="space-y-3">
      {orders.map(order => (
        <motion.div
          key={order.id}
          whileHover={{ y: -4, scale: 1.02 }}
          onClick={() => onClick(order)}
          className="glass-card p-4 cursor-pointer !bg-white/80 hover:!bg-white/90 dark:!bg-white/10 dark:hover:!bg-white/20"
        >
          <div className="flex justify-between items-start mb-2">
            <span className="text-blue-600 font-medium text-sm">{order.orderNumber}</span>
            <span className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="font-medium text-gray-800 dark:text-gray-200 mb-1">{order.customerName || '訪客'}</div>
          <div className="flex flex-wrap gap-1 text-xs">
            <Tag color="geekblue" className="m-0">{order.sourceBrand || '未分類品牌'}</Tag>
            <Tag className="m-0">{order.sourcePlatform || order.sourceLabel || order.channelName || '未歸戶平台'}</Tag>
          </div>
          <div className="flex justify-between items-center mt-3">
            <span className="text-gray-500 text-sm">{order.items?.length || 0} 項</span>
            <span className="font-mono font-medium dark:text-gray-300">NT$ {Number(order.totalAmount).toLocaleString()}</span>
          </div>
        </motion.div>
      ))}
    </div>
  </div>
)

const SalesPage: React.FC = () => {
  const {user}=useAuth(),entityId=useEntityContext(),[createOpen,setCreateOpen]=useState(false)
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const [quickRange, setQuickRange] = useState<QuickRange>('last7Days')
  const [customRange, setCustomRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [ecommerceHistory, setEcommerceHistory] = useState<EcommerceHistory | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null)
  const [syncingInvoiceBatch, setSyncingInvoiceBatch] = useState(false)
  const now = dayjs()

  const resolveRangePayload = useCallback(() => {
    const rangeNow = dayjs()

    if (quickRange === 'today') {
      return {
        startDate: rangeNow.startOf('day').toISOString(),
        endDate: rangeNow.endOf('day').toISOString(),
      }
    }

    if (quickRange === 'last7Days') {
      return {
        startDate: rangeNow.subtract(6, 'day').startOf('day').toISOString(),
        endDate: rangeNow.endOf('day').toISOString(),
      }
    }

    if (quickRange === 'lastMonth') {
      return {
        startDate: rangeNow.subtract(1, 'month').startOf('day').toISOString(),
        endDate: rangeNow.endOf('day').toISOString(),
      }
    }

    if (quickRange === 'lastYear') {
      return {
        startDate: rangeNow.subtract(1, 'year').startOf('day').toISOString(),
        endDate: rangeNow.endOf('day').toISOString(),
      }
    }

    if (customRange?.[0] && customRange?.[1]) {
      return {
        startDate: customRange[0].startOf('day').toISOString(),
        endDate: customRange[1].endOf('day').toISOString(),
      }
    }

    return {}
  }, [customRange, quickRange])

  const fetchOrders = useCallback(async () => {
    if (quickRange === 'custom' && (!customRange?.[0] || !customRange?.[1])) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const rangePayload = resolveRangePayload()
      const entityId = await resolveEntityId()
      const [orderData, historyData] = await Promise.all([
        salesService.findAll({
          entityId,
          ...rangePayload,
          limit: quickRange === 'lastYear' ? 500 : 300,
        }),
        dashboardService.getEcommerceHistory({
          entityId,
          ...rangePayload,
          groupBy: quickRange === 'lastYear' ? 'month' : 'day',
        }),
      ])
      setOrders(orderData)
      setEcommerceHistory(historyData)
    } catch {
      message.error('無法載入銷售分析')
    } finally {
      setLoading(false)
    }
  }, [customRange, quickRange, resolveRangePayload])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const exportOrders = (rows: SalesOrder[], fileName: string) => {
    if (rows.length === 0) {
      message.warning('目前沒有可匯出的訂單')
      return
    }

    const exportRows = rows.map((order) => ({
      訂單編號: order.orderNumber,
      日期: dayjs(order.createdAt).format('YYYY-MM-DD HH:mm'),
      客戶: order.customerName || '訪客',
      Email: order.customerEmail || '',
      電話: order.customerPhone || '',
      品牌: order.sourceBrand || '未分類品牌',
      平台: order.sourcePlatform || order.sourceLabel || order.channelName || '',
      通路: order.channelName || order.channelCode || '',
      金額: order.totalAmount,
      幣別: order.currency,
      訂單狀態: order.status,
      付款狀態: order.paymentStatus,
      發票號碼: order.invoiceNumber || '',
      發票狀態: order.invoiceStatus || '',
      應收餘額: order.outstandingAmountOriginal || 0,
      手續費: (order.feeGatewayOriginal || 0) + (order.feePlatformOriginal || 0),
      淨額: order.amountNetOriginal || 0,
    }))
    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Sales Orders")
    XLSX.writeFile(wb, fileName)
    message.success(`已匯出 ${rows.length} 筆訂單`)
  }

  const handleExport = () => {
    exportOrders(filteredOrders, 'sales_orders_export.xlsx')
  }

  const handleSelectedExport = () => {
    const selectedIds = new Set(selectedRowKeys.map(String))
    const selectedOrders = orders.filter((order) => selectedIds.has(String(order.id)))
    exportOrders(selectedOrders, 'sales_orders_selected_export.xlsx')
  }

  const handleRowClick = (record: SalesOrder) => {
    setSelectedOrder(record)
    setDrawerOpen(true)
  }

  const handleBatchSyncInvoiceStatus = async () => {
    setSyncingInvoiceBatch(true)
    try {
      const entityId = await resolveEntityId()
      const result = await salesService.syncInvoiceStatusBatch({
        entityId,
        ...resolveRangePayload(),
        limit: 80,
      })
      message.success(`已同步 ${result.synced || 0} 筆，略過 ${result.skipped || 0} 筆`)
      await fetchOrders()
    } catch {
      message.error('批次同步發票狀態失敗')
    } finally {
      setSyncingInvoiceBatch(false)
    }
  }

  const columns = [
    {
      title: '訂單 / 日期',
      key: 'order',
      width: 180,
      render: (_: string, record: SalesOrder) => (
        <div>
          <a className="font-medium text-blue-600">{record.orderNumber}</a>
          <div className="text-xs text-slate-400">
            {dayjs(record.createdAt).format('YYYY/MM/DD HH:mm')}
          </div>
        </div>
      ),
    },
    {
      title: '客戶 / 品牌平台',
      key: 'customer',
      width: 300,
      render: (_: string, record: SalesOrder) => (
        <div>
          <div className="font-medium text-slate-900 leading-5">{record.customerName || '訪客'}</div>
          <div className="text-xs text-slate-400">
            {record.customerEmail || '未填 Email'}
            {record.customerPhone ? ` · ${record.customerPhone}` : ''}
          </div>
          <div className="flex min-w-0 flex-wrap gap-1 pt-1">
            <Tag color="geekblue" className="m-0 max-w-[130px] truncate">
              {record.sourceBrand || '未分類品牌'}
            </Tag>
            <Tag className="m-0 max-w-[150px] truncate">
              {record.sourcePlatform || record.sourceLabel || record.channelName || '未歸戶平台'}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: '客群',
      key: 'segment',
      render: (_: unknown, record: SalesOrder) => (
        <Tag color={record.customerType === 'company' ? 'purple' : 'green'}>
          {record.customerType === 'company' ? 'B2B' : 'B2C'}
        </Tag>
      ),
    },
    {
      title: '金額 / 應收',
      dataIndex: 'totalAmount',
      key: 'amount',
      width: 170,
      render: (_: number, record: SalesOrder) => (
        <div>
          <div className="font-mono font-medium">NT$ {Number(record.totalAmount).toLocaleString()}</div>
          <div className="text-xs text-slate-400">
            應收 NT$ {Number(record.outstandingAmountOriginal || 0).toLocaleString()}
          </div>
        </div>
      ),
    },
    {
      title: '訂單狀態',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string) => {
        const colors: Record<string, string> = {
          completed: 'success',
          shipped: 'cyan',
          fulfilling: 'gold',
          paid: 'blue',
          pending: 'processing',
          cancelled: 'error',
          refunded: 'error',
        }
        const icons: Record<string, React.ReactNode> = {
          completed: <CheckCircleOutlined />,
          pending: <ClockCircleOutlined />,
          cancelled: <CloseCircleOutlined />,
        }
        const labels: Record<string, string> = {
          pending: '待處理', paid: '已付款', fulfilling: '出貨中', fulfilled: '已出貨', shipped: '已出貨', completed: '已完成', cancelled: '已取消', refunded: '已退款',
        }
        return (
          <Tag icon={icons[status]} color={colors[status]}>
            {labels[status] || status}
          </Tag>
        )
      },
    },
    {
      title: '付款 / 對帳',
      key: 'payment',
      width: 200,
      render: (_: unknown, record: SalesOrder) => (
        <div>
          <Tag>{record.paymentStatus}</Tag>
          <div className="pt-1 text-xs text-slate-400">
            {record.payments?.some((payment) => payment.reconciledFlag) ? '已對帳' : '待對帳'}
          </div>
        </div>
      )
    },
    {
      title: '手續費 / 淨額',
      key: 'fees',
      width: 160,
      render: (_: unknown, record: SalesOrder) => (
        <div>
          <div className="font-medium text-rose-600">
            NT$ {Number((record.feeGatewayOriginal || 0) + (record.feePlatformOriginal || 0)).toLocaleString()}
          </div>
          <div className="text-xs text-slate-400">
            淨額 NT$ {Number(record.amountNetOriginal || 0).toLocaleString()}
          </div>
        </div>
      ),
    },
    {
      title: '發票 / 入帳',
      key: 'accounting',
      width: 180,
      render: (_: unknown, record: SalesOrder) => (
        <div>
          <div className="font-medium text-slate-900">{record.invoiceNumber || '待開票'}</div>
          <div className="flex flex-wrap gap-1 pt-1">
            <Tag color={record.invoiceNumber ? 'green' : 'orange'}>
              {record.invoiceStatus || 'pending'}
            </Tag>
            <Tag color={record.accountingPosted ? 'green' : 'default'}>
              {record.accountingPosted ? '已入帳' : '待入帳'}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: '通路',
      key: 'channel',
      width: 110,
      render: (_: unknown, record: SalesOrder) => (
        <Tag color="blue">{record.channelName || record.channelCode || '未知通路'}</Tag>
      ),
    },
  ]

  const rangeLabelMap: Record<QuickRange, string> = {
    today: '今天',
    last7Days: '過去 7 天',
    lastMonth: '過去一個月',
    lastYear: '過去一年',
    custom: customRange?.[0] && customRange?.[1]
      ? `${customRange[0].format('YYYY/MM/DD')} - ${customRange[1].format('YYYY/MM/DD')}`
      : '自定義區間',
  }

  const isWithinQuickRange = (createdAt: string) => {
    const orderDate = dayjs(createdAt)

    if (quickRange === 'today') {
      return orderDate.isSame(now, 'day')
    }

    if (quickRange === 'last7Days') {
      return orderDate.isAfter(now.subtract(6, 'day').startOf('day')) || orderDate.isSame(now.subtract(6, 'day').startOf('day'))
    }

    if (quickRange === 'lastMonth') {
      return orderDate.isAfter(now.subtract(1, 'month').startOf('day')) || orderDate.isSame(now.subtract(1, 'month').startOf('day'))
    }

    if (quickRange === 'lastYear') {
      return orderDate.isAfter(now.subtract(1, 'year').startOf('day')) || orderDate.isSame(now.subtract(1, 'year').startOf('day'))
    }

    if (customRange?.[0] && customRange?.[1]) {
      const start = customRange[0].startOf('day')
      const end = customRange[1].endOf('day')
      return (orderDate.isAfter(start) || orderDate.isSame(start)) && (orderDate.isBefore(end) || orderDate.isSame(end))
    }

    return true
  }

  const filteredOrders = orders.filter(order => {
    const keyword = searchText.trim().toLowerCase()
    const matchesKeyword = !keyword || (
      (order.orderNumber || '').toLowerCase().includes(keyword) ||
      (order.customerName || '').toLowerCase().includes(keyword) ||
      (order.channelName || '').toLowerCase().includes(keyword) ||
      (order.sourceLabel || '').toLowerCase().includes(keyword) ||
      (order.sourcePlatform || '').toLowerCase().includes(keyword) ||
      (order.sourceBrand || '').toLowerCase().includes(keyword) ||
      (order.customerEmail || '').toLowerCase().includes(keyword)
    )

    return matchesKeyword && isWithinQuickRange(order.createdAt)
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="page-section-stack p-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <Title level={2} className="!mb-0">銷售訂單</Title>
        </div>
        <Space wrap>
          {stagedOperationsEnabled()&&hasPermission(user,'sales_orders:create')&&<Button type="primary" disabled={!entityId} onClick={()=>setCreateOpen(true)}>新增訂單</Button>}
          <Button icon={<ReloadOutlined />} onClick={fetchOrders}>重新整理</Button>
          <Button
            icon={<SyncOutlined spin={syncingInvoiceBatch} />}
            loading={syncingInvoiceBatch}
            onClick={handleBatchSyncInvoiceStatus}
          >
            同步發票狀態
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>匯出報表</Button>
        </Space>
      </div>

      {createOpen&&<SalesOrderCreate key={entityId} entityId={entityId} onClose={()=>setCreateOpen(false)} onCreated={()=>void fetchOrders()}/>}

      {/* Analytics Cards */}
      <SalesAnalytics
        orders={filteredOrders}
        ecommerceHistory={ecommerceHistory}
        rangeLabel={rangeLabelMap[quickRange]}
        quickRange={quickRange}
        customRange={customRange}
        onQuickRangeChange={setQuickRange}
        onCustomRangeChange={setCustomRange}
      />

      {quickRange === 'custom' && (!customRange?.[0] || !customRange?.[1]) ? (
        <Alert
          type="info"
          showIcon
          message="請選擇完整的自訂日期區間"
          description="選擇開始與結束日期前，系統會保留上一個成功載入的訂單快照，不會改成無日期範圍的查詢。"
        />
      ) : null}

      {/* Filters & Actions */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-5 glass-panel p-5">
        <Space size="middle" wrap>
          <Input 
            placeholder="搜尋訂單編號、客戶、來源或品牌..." 
            prefix={<SearchOutlined className="text-gray-400" />} 
            className="w-72"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
          <Segmented
            options={[
              { label: '今天', value: 'today' },
              { label: '過去 7 天', value: 'last7Days' },
              { label: '過去一個月', value: 'lastMonth' },
              { label: '過去一年', value: 'lastYear' },
              { label: '自定義區間', value: 'custom' },
            ]}
            value={quickRange}
            onChange={(value) => setQuickRange(value as QuickRange)}
          />
          {quickRange === 'custom' ? (
            <RangePicker
              value={customRange}
              onChange={(value) => setCustomRange((value || null) as [Dayjs | null, Dayjs | null] | null)}
            />
          ) : null}
          <Button
            icon={<FilterOutlined />}
            onClick={() => {
              setSearchText('')
              if (quickRange === 'custom') {
                setCustomRange(null)
              }
            }}
          >
            清除條件
          </Button>
        </Space>
        <Segmented
          options={[
            { label: '列表', value: 'list', icon: <BarsOutlined /> },
            { label: '看板', value: 'board', icon: <AppstoreOutlined /> },
          ]}
          value={viewMode}
          onChange={(val) => setViewMode(val as 'list' | 'board')}
        />
      </div>

      {/* Content */}
      {viewMode === 'list' ? (
        <Card className="shadow-sm rounded-3xl border-0 overflow-hidden" bodyStyle={{ padding: 0 }}>
          <Table
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys,
            }}
            columns={columns}
            dataSource={filteredOrders}
            rowKey="id"
            loading={loading}
            size="small"
            tableLayout="fixed"
            onRow={(record) => ({
              onClick: () => handleRowClick(record),
              className: 'cursor-pointer hover:bg-gray-50 transition-colors'
            })}
            pagination={{ pageSize: 12, showSizeChanger: false }}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-7">
          <KanbanColumn 
            title="待處理"
            orders={filteredOrders.filter(o => ['pending', 'paid', 'fulfilled'].includes(o.status))}
            color="bg-blue-500"
            onClick={handleRowClick}
          />
          <KanbanColumn
            title="已出貨"
            orders={filteredOrders.filter(o => o.status === 'shipped')}
            color="bg-cyan-500"
            onClick={handleRowClick}
          />
          <KanbanColumn 
            title="已完成"
            orders={filteredOrders.filter(o => o.status === 'completed')} 
            color="bg-green-500"
            onClick={handleRowClick}
          />
          <KanbanColumn 
            title="已取消"
            orders={filteredOrders.filter(o => o.status === 'cancelled')} 
            color="bg-red-500"
            onClick={handleRowClick}
          />
        </div>
      )}

      {/* Bulk Actions */}
      {selectedRowKeys.length > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2"
        >
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/10 bg-gray-900/90 px-5 py-3 text-white shadow-2xl backdrop-blur-md">
            <span className="font-medium">已選擇 {selectedRowKeys.length} 筆訂單</span>
            <Button type="link" size="small" onClick={() => setSelectedRowKeys([])} className="!text-gray-300">
              取消
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleSelectedExport}>
              匯出選取
            </Button>
          </div>
        </motion.div>
      )}

      {/* Order Details Drawer */}
      <OrderDetailsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        order={selectedOrder}
        onUpdate={fetchOrders}
      />
    </motion.div>
  )
}

export default SalesPage
