import React, { useState, useEffect } from 'react'
import { Table, Tag, Button, Space, Input, DatePicker, Card, Typography, Segmented, message } from 'antd'
import { 
  PlusOutlined, 
  SearchOutlined, 
  FilterOutlined, 
  MoreOutlined, 
  PrinterOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  AppstoreOutlined,
  BarsOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import * as XLSX from 'xlsx'
import dayjs, { Dayjs } from 'dayjs'
import OrderDetailsDrawer from '../components/OrderDetailsDrawer'
import SalesAnalytics from '../components/SalesAnalytics'
import BulkActionBar from '../components/BulkActionBar'
import { salesService, SalesOrder } from '../services/sales.service'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

type QuickRange = 'today' | 'last7Days' | 'lastMonth' | 'lastYear' | 'custom'

const KanbanColumn: React.FC<{ title: string; status: string; orders: SalesOrder[]; color: string; onClick: (order: SalesOrder) => void }> = ({ title, status, orders, color, onClick }) => (
  <div className="flex-1 min-w-[300px] glass-panel p-4">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${color}`} />
        <span className="font-medium text-gray-700">{title}</span>
        <span className="bg-white/50 px-2 py-0.5 rounded-full text-xs text-gray-500">{orders.length}</span>
      </div>
      <Button type="text" icon={<MoreOutlined />} size="small" />
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
          <div className="font-medium text-gray-800 dark:text-gray-200 mb-1">{order.customerName || 'Guest'}</div>
          <div className="text-xs text-gray-400">{order.sourceLabel || order.channelName || '未歸戶來源'}</div>
          <div className="flex justify-between items-center mt-3">
            <span className="text-gray-500 text-sm">{order.items?.length || 0} items</span>
            <span className="font-mono font-medium dark:text-gray-300">NT$ {Number(order.totalAmount).toLocaleString()}</span>
          </div>
        </motion.div>
      ))}
    </div>
  </div>
)

const SalesPage: React.FC = () => {
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const [quickRange, setQuickRange] = useState<QuickRange>('last7Days')
  const [customRange, setCustomRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null)

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const data = await salesService.findAll()
      setOrders(data)
    } catch (error) {
      message.error('無法載入訂單')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrders()
  }, [])

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(orders)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Sales Orders")
    XLSX.writeFile(wb, "sales_orders_export.xlsx")
    message.success('報表匯出成功')
  }

  const handleRowClick = (record: SalesOrder) => {
    setSelectedOrder(record)
    setDrawerOpen(true)
  }

  const handleBulkComplete = () => {
    message.success(`已完成 ${selectedRowKeys.length} 筆訂單`)
    setSelectedRowKeys([])
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
      title: '客戶 / 來源',
      key: 'customer',
      width: 260,
      render: (_: string, record: SalesOrder) => (
        <div>
          <div className="font-medium text-slate-900 leading-5">{record.customerName || 'Guest'}</div>
          <div className="text-xs text-slate-400">
            {record.customerEmail || '未填 Email'}
            {record.customerPhone ? ` · ${record.customerPhone}` : ''}
          </div>
          <div className="pt-1 text-xs text-slate-500">
            {record.sourceLabel || '未歸戶來源'} · {record.sourceBrand || record.channelName || '其他來源'}
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
          pending: 'processing',
          cancelled: 'error',
        }
        const icons: Record<string, React.ReactNode> = {
          completed: <CheckCircleOutlined />,
          pending: <ClockCircleOutlined />,
          cancelled: <CloseCircleOutlined />,
        }
        return (
          <Tag icon={icons[status]} color={colors[status]}>
            {status.toUpperCase()}
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
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: () => (
        <Button type="text" icon={<MoreOutlined />} />
      ),
    },
  ]

  const now = dayjs()
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
      className="p-6 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <Title level={2} className="!mb-0">銷售訂單</Title>
          <Text type="secondary">管理所有銷售渠道的訂單與出貨狀態</Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={fetchOrders}>重新整理</Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>匯出報表</Button>
          <Button type="primary" icon={<PlusOutlined />} size="large">新增訂單</Button>
        </Space>
      </div>

      {/* Analytics Cards */}
      <SalesAnalytics orders={filteredOrders} rangeLabel={rangeLabelMap[quickRange]} />

      {/* Filters & Actions */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 glass-panel p-4">
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
        <Card className="shadow-sm rounded-xl border-0 overflow-hidden" bodyStyle={{ padding: 0 }}>
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
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <KanbanColumn 
            title="待處理 (Pending)" 
            status="pending" 
            orders={filteredOrders.filter(o => o.status === 'pending')} 
            color="bg-blue-500"
            onClick={handleRowClick}
          />
          <KanbanColumn 
            title="已完成 (Completed)" 
            status="completed" 
            orders={filteredOrders.filter(o => o.status === 'completed')} 
            color="bg-green-500"
            onClick={handleRowClick}
          />
          <KanbanColumn 
            title="已取消 (Cancelled)" 
            status="cancelled" 
            orders={filteredOrders.filter(o => o.status === 'cancelled')} 
            color="bg-red-500"
            onClick={handleRowClick}
          />
        </div>
      )}

      {/* Bulk Actions */}
      <BulkActionBar 
        selectedCount={selectedRowKeys.length} 
        onClear={() => setSelectedRowKeys([])}
        actions={[
          { label: '批次完成', onClick: handleBulkComplete, type: 'primary' },
          { label: '列印出貨單', onClick: () => {}, icon: <PrinterOutlined /> },
          { label: '匯出選取', onClick: () => {}, icon: <DownloadOutlined /> },
        ]}
      />

      {/* Order Details Drawer */}
      <OrderDetailsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        order={selectedOrder as any}
        onUpdate={fetchOrders}
      />
    </motion.div>
  )
}

export default SalesPage
