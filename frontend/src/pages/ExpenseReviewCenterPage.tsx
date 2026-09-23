import ReceiptEvidenceViewer from '../components/ReceiptEvidenceViewer'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useNavigate } from 'react-router-dom'
import {
  AuditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileSearchOutlined,
  FilterOutlined,
  FireOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  BulbOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { GlassCard } from '../components/ui/GlassCard'
import { GlassDrawer, GlassDrawerSection } from '../components/ui/GlassDrawer'
import { GlassButton } from '../components/ui/GlassButton'
import { GlassInput } from '../components/ui/GlassInput'
import { GlassSelect } from '../components/ui/GlassSelect'
import { useAuth } from '../contexts/AuthContext'
import {
  expenseService,
  type ExpenseRequest,
  type ExpenseHistoryEntry,
  type LegacyApprovalRoutePreview,
} from '../services/expense.service'
import { accountingService } from '../services/accounting.service'
import type { Account } from '../types'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

type FilterState = {
  statuses: string[]
  payeeType: string
  priority: string
  search: string
  dateRange: [Dayjs, Dayjs] | null
  minAmount?: number
  maxAmount?: number
}

type ActionMode = 'reject'

type ActionState = {
  mode: ActionMode
  request: ExpenseRequest | null
}

const baseFilters: FilterState = {
  statuses: ['pending'],
  payeeType: 'all',
  priority: 'all',
  search: '',
  dateRange: null,
}

const createDefaultFilters = (): FilterState => ({
  statuses: [...baseFilters.statuses],
  payeeType: baseFilters.payeeType,
  priority: baseFilters.priority,
  search: baseFilters.search,
  dateRange: baseFilters.dateRange,
  minAmount: baseFilters.minAmount,
  maxAmount: baseFilters.maxAmount,
})

const statusLabelMap: Record<string, string> = {
  pending: '審核中',
  approved: '已核准',
  rejected: '已駁回',
  draft: '草稿',
  paid: '已付款',
}

const statusColorMap: Record<string, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
  draft: 'default',
  paid: 'blue',
}

const historyLabelMap: Record<string, string> = {
  submitted: '已提交',
  approval_assigned: '管理員建立主管審批',
  approved: '核准',
  rejected: '駁回',
  pending: '審核中',
}

const toNumber = (value?: number | string | null) => {
  if (value === null || value === undefined) return 0
  return typeof value === 'number' ? value : Number(value)
}

const isUrgentRequest = (request: ExpenseRequest) => {
  if (request.status !== 'pending') return false
  if (request.priority === 'urgent') return true
  if (!request.dueDate) return false
  return dayjs(request.dueDate).diff(dayjs(), 'day') <= 2
}

const isOverdue = (request: ExpenseRequest) => {
  if (!request.dueDate) return false
  return dayjs().isAfter(dayjs(request.dueDate), 'day')
}

const ExpenseReviewCenterPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = useMemo(
    () => (user?.roles ?? []).some((role) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'ACCOUNTANT') || Boolean(user?.permissions?.includes('accounts:read')),
    [user],
  )

  const canAssignLegacy = (user?.roles ?? []).some((role) => role === 'ADMIN' || role === 'SUPER_ADMIN')
  const [legacyRouteLoadingId, setLegacyRouteLoadingId] = useState<string | null>(null)
  const [legacyRoutePreview, setLegacyRoutePreview] = useState<LegacyApprovalRoutePreview | null>(null)
  const [legacyRouteSaving, setLegacyRouteSaving] = useState(false)

  const [requests, setRequests] = useState<ExpenseRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterState>(() => createDefaultFilters())
  const [filterForm] = Form.useForm()
  const [actionForm] = Form.useForm()
  const [actionState, setActionState] = useState<ActionState>({ mode: 'reject', request: null })
  const [actionLoading, setActionLoading] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)

  // Detail Drawer State
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<ExpenseRequest | null>(null)
  const [history, setHistory] = useState<ExpenseHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [reviewAccountId, setReviewAccountId] = useState<string | undefined>(undefined)
  const [reviewRemark, setReviewRemark] = useState<string>('')

  const entityId = localStorage.getItem('entityId') || DEFAULT_ENTITY_ID

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true)
      const result = await expenseService.getExpenseRequests({ entityId }).then((rows) => rows.filter((row) => row.canReview || isAdmin))
      setRequests(Array.isArray(result) ? result : [])
    } catch (error) {
      console.error(error)
      message.error('無法載入費用資料，請稍後再試')
    } finally {
      setLoading(false)
    }
  }, [entityId, isAdmin])

  useEffect(() => {
    void loadRequests()
  }, [loadRequests])

  useEffect(() => {
    filterForm.setFieldsValue(createDefaultFilters())
  }, [filterForm])

  useEffect(() => {
    if (!isAdmin) return
    setAccountsLoading(true)
    accountingService
      .getAccounts(entityId)
      .then(setAccounts)
      .catch((error) => {
        console.error(error)
        message.error('無法載入會計科目')
      })
      .finally(() => setAccountsLoading(false))
  }, [entityId, isAdmin])

  const handleFiltersChange = (_: unknown, values: FilterState) => {
    setFilters({
      statuses: values.statuses?.length ? values.statuses : [],
      payeeType: values.payeeType ?? 'all',
      priority: values.priority ?? 'all',
      search: values.search ?? '',
      dateRange:
        values.dateRange && values.dateRange.length === 2 ? values.dateRange : null,
      minAmount: values.minAmount,
      maxAmount: values.maxAmount,
    })
  }

  const handleResetFilters = () => {
    const defaults = createDefaultFilters()
    filterForm.setFieldsValue(defaults)
    setFilters(defaults)
  }

  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === 'pending'),
    [requests],
  )

  const urgentQueue = useMemo(
    () => pendingRequests.filter(isUrgentRequest).sort((a, b) => {
      const dueA = a.dueDate ? dayjs(a.dueDate).valueOf() : Number.MAX_SAFE_INTEGER
      const dueB = b.dueDate ? dayjs(b.dueDate).valueOf() : Number.MAX_SAFE_INTEGER
      return dueA - dueB
    }),
    [pendingRequests],
  )

  const flaggedRequests = useMemo(
    () =>
      pendingRequests.filter(
        (request) => {
          const metadata = request.metadata as Record<string, any> || {}
          const isInvoicePending = metadata.isInvoicePending === true
          const daysSinceCreation = dayjs().diff(dayjs(request.createdAt), 'day')
          const isInvoiceOverdue = isInvoicePending && daysSinceCreation > 20

          return !request.suggestedAccount || isOverdue(request) || isInvoiceOverdue
        },
      ),
    [pendingRequests],
  )

  const filteredRequests = useMemo(() => {
    return requests.filter((request) => {
      if (filters.statuses.length && !filters.statuses.includes(request.status)) {
        return false
      }
      if (filters.payeeType !== 'all' && request.payeeType !== filters.payeeType) {
        return false
      }
      if (filters.priority !== 'all' && request.priority !== filters.priority) {
        return false
      }
      if (filters.search) {
        const keyword = filters.search.trim().toLowerCase()
        const haystack = `${request.description || ''} ${request.reimbursementItem?.name || ''}`.toLowerCase()
        if (!haystack.includes(keyword)) {
          return false
        }
      }
      if (filters.dateRange) {
        const [start, end] = filters.dateRange
        const windowStart = start.startOf('day').valueOf()
        const windowEnd = end.endOf('day').valueOf()
        const created = dayjs(request.createdAt).valueOf()
        if (created < windowStart || created > windowEnd) {
          return false
        }
      }
      if (filters.minAmount && toNumber(request.amountOriginal) < filters.minAmount) {
        return false
      }
      if (filters.maxAmount && toNumber(request.amountOriginal) > filters.maxAmount) {
        return false
      }
      return true
    })
  }, [filters, requests])

  const backlogAmount = useMemo(
    () => pendingRequests.reduce((sum, request) => sum + toNumber(request.amountOriginal), 0),
    [pendingRequests],
  )

  const averagePendingAge = useMemo(() => {
    if (!pendingRequests.length) return 0
    const totalDays = pendingRequests.reduce(
      (sum, request) => sum + dayjs().diff(dayjs(request.createdAt), 'day'),
      0,
    )
    return Math.round(totalDays / pendingRequests.length)
  }, [pendingRequests])

  const aiCoverage = useMemo(() => {
    if (!requests.length) return 0
    const withSuggestions = requests.filter((request) => request.suggestedAccount).length
    return Math.round((withSuggestions / requests.length) * 100)
  }, [requests])

  const handleOpenDetail = async (request: ExpenseRequest) => {
    setSelectedRequest(request)
    setDetailDrawerOpen(true)
    setHistoryLoading(true)
    try {
      const historyData = await expenseService.getExpenseRequestHistory(request.id)
      setHistory(historyData)
    } catch (error) {
      console.error(error)
      message.error('無法載入歷程紀錄')
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleCloseDetail = () => {
    setDetailDrawerOpen(false)
    setSelectedRequest(null)
    setHistory([])
  }

  useEffect(() => {
    if (selectedRequest) {
      setReviewAccountId(selectedRequest.suggestedAccount?.id || selectedRequest.finalAccount?.id)
      setReviewRemark('')
    }
  }, [selectedRequest])

  const handleAssignLegacyRoute = async (record: ExpenseRequest) => {
    setLegacyRouteLoadingId(record.id)
    try {
      const preview = await expenseService.previewLegacyApprovalRoute(record.id)
      setLegacyRoutePreview(preview)
    } catch (error) {
      const failure = error as { response?: { data?: { message?: string } } }
      message.error(failure.response?.data?.message || '無法預覽，請先核對申請人與主管設定')
    } finally {
      setLegacyRouteLoadingId(null)
    }
  }

  const handleConfirmLegacyRoute = async () => {
    if (!legacyRoutePreview || legacyRouteSaving) return
    setLegacyRouteSaving(true)
    try {
      await expenseService.assignLegacyApprovalRoute(legacyRoutePreview.requestId, legacyRoutePreview)
      setLegacyRoutePreview(null)
      message.success('已建立主管審批，原申請仍維持待審')
      await loadRequests()
    } catch (error) {
      const failure = error as { response?: { data?: { message?: string } } }
      message.error(failure.response?.data?.message || '無法建立審批，請重新預覽')
    } finally {
      setLegacyRouteSaving(false)
    }
  }

  const handleDirectApprove = async () => {
    if (!selectedRequest?.canReview) return
    try {
      setActionLoading(true)
      await expenseService.approveExpenseRequest(selectedRequest.id, {
        approvalStepId: selectedRequest.approvalSteps?.find((step) => step.status === "pending")?.id,
        finalAccountId: isAdmin ? reviewAccountId : undefined,
        remark: reviewRemark.trim() || undefined,
      })
      message.success('已完成本關審批')
      handleCloseDetail()
      void loadRequests()
    } catch (error) {
      console.error(error)
      message.error('核准失敗，請稍後再試')
    } finally {
      setActionLoading(false)
    }
  }

  const openActionModal = (mode: ActionMode, request: ExpenseRequest) => {
    setActionState({ mode, request })
    actionForm.resetFields()
  }

  const closeActionModal = () => {
    setActionState({ mode: 'reject', request: null })
    actionForm.resetFields()
  }

  const handleActionSubmit = async () => {
    if (!actionState.request) {
      return
    }
    try {
      setActionLoading(true)
      const values = await actionForm.validateFields(['reason', 'note'])
      if (!values.reason || !values.reason.trim()) {
        message.error('請輸入駁回原因')
        return
      }
      await expenseService.rejectExpenseRequest(actionState.request.id, {
        approvalStepId: actionState.request.approvalSteps?.find((step) => step.status === "pending")?.id,
        reason: values.reason.trim(),
        note: values.note?.trim() || undefined,
      })
      message.success('已駁回該申請')
      closeActionModal()
      void loadRequests()
    } catch (error) {
      console.error(error)
      if ('errorFields' in (error as Record<string, unknown>)) {
        return
      }
      message.error('操作失敗，請稍後再試')
    } finally {
      setActionLoading(false)
    }
  }

  const columns: ColumnsType<ExpenseRequest> = [
    {
      title: '費用項目',
      dataIndex: 'reimbursementItem',
      key: 'reimbursementItem',
      width: '20%',
      className: '!bg-transparent align-middle',
      render: (_value, record) => (
        <div className="flex flex-col justify-center h-full">
          <span className="font-medium text-gray-800 text-base">
            {record.reimbursementItem?.name || '—'}
          </span>
          {record.description && (
            <Text type="secondary" className="text-xs text-gray-500 line-clamp-1">
              {record.description}
            </Text>
          )}
          <div className="sm:hidden mt-1">
            <Tag 
              color={statusColorMap[record.status] || 'default'} 
              className="mr-0 text-[10px] px-1.5 leading-5 h-5 border-0"
            >
              {statusLabelMap[record.status] || record.status}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: '申請人',
      dataIndex: 'creator',
      key: 'creator',
      width: '12%',
      responsive: ['sm'],
      className: 'align-middle',
      render: (_value, record) => (
        <div className="flex flex-col justify-center">
          <Text className="font-medium text-slate-700">{record.creator?.name || '—'}</Text>
          <Text type="secondary" className="text-xs text-gray-500">{record.creator?.email}</Text>
        </div>
      ),
    },
    {
      title: '金額',
      dataIndex: 'amountOriginal',
      key: 'amountOriginal',
      width: '10%',
      align: 'right',
      className: 'align-middle',
      render: (_value, record) => (
        <Text className="font-mono font-semibold text-slate-700">
          {(record.amountCurrency || 'TWD') + ' ' + toNumber(record.amountOriginal).toLocaleString()}
        </Text>
      ),
    },
    {
      title: '狀態',
      dataIndex: 'status',
      key: 'status',
      width: '8%',
      align: 'center',
      responsive: ['sm'],
      className: 'align-middle',
      render: (value: string) => (
        <Tag color={statusColorMap[value] || 'default'} className="mx-0">
          {statusLabelMap[value] || value}
        </Tag>
      ),
    },
    {
      title: '優先度 / 付款',
      key: 'priority',
      width: '15%',
      responsive: ['md'],
      className: 'align-middle',
      render: (_value, record) => (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1 flex-wrap items-center">
            {record.priority === 'urgent' && (
              <Tag color="red" className="mr-0">急件</Tag>
            )}
            {record.dueDate && (
              <Tag color={isOverdue(record) ? 'red' : 'blue'} className="mr-0">
                到期 {dayjs(record.dueDate).format('MM/DD')}
              </Tag>
            )}
          </div>
          {record.paymentStatus && (
            <Text type="secondary" className="text-xs">
              {record.paymentStatus}
            </Text>
          )}
          {(() => {
            const metadata = record.metadata as Record<string, any> || {}
            if (metadata.isPrepaidCustoms) {
              return (
                <Tag color="purple" className="mt-1 mr-0">
                  關稅預付
                </Tag>
              )
            }
            return null
          })()}
        </div>
      ),
    },
    {
      title: '系統建議',
      key: 'ai',
      width: '15%',
      responsive: ['lg'],
      className: 'align-middle',
      render: (_value, record) => {
        if (!record.suggestedAccount) {
          return <Text type="secondary" className="text-xs">—</Text>
        }
        const confidence = Number(record.suggestionConfidence ?? 0)
        return (
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Tag color="blue" bordered={false} className="mr-0">
                {record.suggestedAccount.code}
              </Tag>
              <Text className="text-sm">{record.suggestedAccount.name}</Text>
            </div>
            <Text type="secondary" className="text-xs mt-0.5">
              信心 {(confidence * 100).toFixed(0)}%
            </Text>
          </div>
        )
      },
    },
    {
      title: '等待天數',
      key: 'aging',
      width: '8%',
      responsive: ['md'],
      className: 'align-middle',
      render: (_value, record) => (
        <Text>{dayjs().diff(dayjs(record.createdAt), 'day')} 天</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      fixed: 'right',
      className: '!bg-transparent align-middle',
      render: (_value, record) => (
        <div className="flex items-center justify-end gap-2">
          {canAssignLegacy && record.status === 'pending' && !record.approvalSteps?.length && (
            <Button loading={legacyRouteLoadingId === record.id} onClick={() => void handleAssignLegacyRoute(record)}>建立主管審批</Button>
          )}
          {record.canReview ? (
            <Button
              type="primary"
              size="middle"
              className="!bg-green-600 hover:!bg-green-500 border-none shadow-sm flex items-center"
              onClick={() => handleOpenDetail(record)}
            >
              <CheckCircleOutlined /> 審核
            </Button>
          ) : (
            <Button
              type="default"
              size="middle"
              onClick={() => handleOpenDetail(record)}
            >
              查看詳情
            </Button>
          )}
        </div>
      ),
    },
  ]


  return (
    <div className="space-y-8 animate-[fadeInUp_0.4s_ease-out]">
      <Modal
        title="依目前主管建立審批"
        open={Boolean(legacyRoutePreview)}
        onCancel={() => { if (!legacyRouteSaving) setLegacyRoutePreview(null) }}
        onOk={() => void handleConfirmLegacyRoute()}
        confirmLoading={legacyRouteSaving}
        cancelButtonProps={{ disabled: legacyRouteSaving }}
        closable={!legacyRouteSaving}
        maskClosable={!legacyRouteSaving}
        okText="確認建立審批"
        cancelText="取消"
      >
        {legacyRoutePreview && <div className="space-y-3">
          <p>申請人：{legacyRoutePreview.requesterName}。目前已設定的直屬主管：<strong>{legacyRoutePreview.supervisor.name}</strong>。</p>
          <p>確認後會建立以下審批順序；原申請保持待審，完成核准後才會加入出納待付款。</p>
          <ol>{legacyRoutePreview.steps.map((step) => <li key={step.order}>{step.order}. {step.approverName || step.roleCode || '待確認審批人'}</li>)}</ol>
        </div>}
      </Modal>
      {requests.some((request) => request.status === 'pending' && !request.approvalSteps?.length) && (
        <Alert showIcon type="warning" message="有舊費用申請尚未指派審批人" description="這些申請暫停審批。請管理員核對原申請與組織主管後，使用該筆「建立主管審批」操作並確認審批順序，不能直接略過主管核准。新申請會自動保存送出時的直屬主管。" />
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 mb-1">
            費用審核中心
          </h1>
          <p className="text-slate-500 text-sm">
            顯示目前指派給你的費用申請；核准後依政策送下一位審批人，最後自動加入出納待付款。
          </p>
        </div>
        <div className="flex gap-3">
          <GlassButton onClick={() => navigate('/ap/expenses')} className="flex items-center gap-2">
            <FileSearchOutlined /> 回到費用申請
          </GlassButton>
          <GlassButton onClick={() => void loadRequests()} isLoading={loading} className="flex items-center gap-2">
            <ReloadOutlined /> 重新整理
          </GlassButton>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 w-full">
        <GlassCard className="relative overflow-hidden group h-full p-4 md:p-6">
          <div className="absolute top-0 right-0 p-2 md:p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <AuditOutlined className="text-4xl md:text-6xl text-blue-500" />
          </div>
          <div className="text-xs md:text-sm text-slate-500 mb-1 md:mb-2 font-medium">待審件數</div>
          <div className="text-xl md:text-3xl font-semibold text-blue-600 mb-1">
            {pendingRequests.length} <span className="text-xs md:text-sm font-normal text-slate-400">件</span>
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full p-4 md:p-6">
          <div className="absolute top-0 right-0 p-2 md:p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <FireOutlined className="text-4xl md:text-6xl text-red-500" />
          </div>
          <div className="text-xs md:text-sm text-slate-500 mb-1 md:mb-2 font-medium">急件</div>
          <div className="text-xl md:text-3xl font-semibold text-red-600 mb-1">
            {urgentQueue.length} <span className="text-xs md:text-sm font-normal text-slate-400">件</span>
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full p-4 md:p-6">
          <div className="absolute top-0 right-0 p-2 md:p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <ThunderboltOutlined className="text-4xl md:text-6xl text-amber-500" />
          </div>
          <div className="text-xs md:text-sm text-slate-500 mb-1 md:mb-2 font-medium">待審金額</div>
          <div className="text-xl md:text-3xl font-semibold text-amber-600 mb-1 truncate">
            {backlogAmount.toLocaleString()}
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full p-4 md:p-6">
          <div className="absolute top-0 right-0 p-2 md:p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <WarningOutlined className="text-4xl md:text-6xl text-purple-500" />
          </div>
          <div className="text-xs md:text-sm text-slate-500 mb-1 md:mb-2 font-medium">平均等待</div>
          <div className="text-xl md:text-3xl font-semibold text-purple-600 mb-1">
            {averagePendingAge} <span className="text-xs md:text-sm font-normal text-slate-400">天</span>
          </div>
        </GlassCard>
      </div>

      {/* Top Row: Filter & Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_1fr] gap-6 w-full">
        {/* Left: Filter Section */}
        <GlassCard className="w-full p-6 h-full">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2 text-slate-700 font-medium">
              <FilterOutlined /> 審核篩選
            </div>
            <Button type="link" onClick={handleResetFilters} className="text-slate-500 hover:text-blue-600 px-0">
              清除篩選
            </Button>
          </div>
          
          <Form
            layout="vertical"
            form={filterForm}
            onValuesChange={handleFiltersChange}
            initialValues={createDefaultFilters()}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Form.Item name="search" label="關鍵字" className="mb-0">
                <Input allowClear placeholder="輸入描述或報銷項目" prefix={<FileSearchOutlined className="text-slate-400" />} className="rounded-xl" />
              </Form.Item>
              
              <Form.Item name="statuses" label="狀態" initialValue={['pending']} className="mb-0">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="選擇狀態"
                  options={Object.entries(statusLabelMap).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  className="rounded-xl"
                />
              </Form.Item>
              
              <Form.Item name="dateRange" label="申請期間" className="mb-0">
                <RangePicker className="w-full rounded-xl" />
              </Form.Item>
              
              <Form.Item name="payeeType" label="受款人" initialValue="all" className="mb-0">
                <Select
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '員工', value: 'employee' },
                    { label: '廠商', value: 'vendor' },
                  ]}
                  className="rounded-xl"
                />
              </Form.Item>
              
              <Form.Item name="priority" label="優先度" initialValue="all" className="mb-0">
                <Select
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '一般', value: 'normal' },
                    { label: '急件', value: 'urgent' },
                  ]}
                  className="rounded-xl"
                />
              </Form.Item>
              
              <Form.Item name="minAmount" label="最低金額" className="mb-0">
                <InputNumber className="w-full rounded-xl" min={0} placeholder="金額下限" />
              </Form.Item>
            </div>
          </Form>
        </GlassCard>

        {/* Right: Notifications */}
        <div className="flex flex-col gap-4 h-full">
          <GlassCard className="w-full p-0 overflow-hidden flex-1">
            <div className="p-3 border-b border-white/20 bg-red-50/30 flex items-center gap-2">
              <FireOutlined className="text-red-500" />
              <span className="font-medium text-red-700">急件提醒</span>
            </div>
            <div className="p-3 overflow-y-auto max-h-[200px]">
              {urgentQueue.length === 0 ? (
                <Empty description="目前沒有急件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <div className="flex flex-col gap-2">
                  {urgentQueue.slice(0, 4).map((request) => (
                    <div
                      key={request.id}
                      className="p-2 bg-white/40 rounded-lg border border-red-100 hover:border-red-200 transition-all hover:shadow-sm cursor-pointer"
                      onClick={() => handleOpenDetail(request)}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-medium text-slate-800 line-clamp-1 text-sm">
                          {request.reimbursementItem?.name || '未分類'}
                        </span>
                        <span className="font-mono font-medium text-red-600 whitespace-nowrap ml-2 text-sm">
                          ${toNumber(request.amountOriginal).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-red-600 bg-red-100/50 px-1.5 py-0.5 rounded-full">
                          到期：{request.dueDate ? dayjs(request.dueDate).format('MM/DD') : '未設定'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </GlassCard>

          <GlassCard className="w-full p-0 overflow-hidden flex-1">
            <div className="p-3 border-b border-white/20 bg-amber-50/30 flex items-center gap-2">
              <WarningOutlined className="text-amber-500" />
              <span className="font-medium text-amber-700">需注意 / 補件</span>
            </div>
            <div className="p-3 overflow-y-auto max-h-[200px]">
              {flaggedRequests.length === 0 ? (
                <Empty description="無須補件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <div className="flex flex-col gap-2">
                  {flaggedRequests.slice(0, 4).map((request) => (
                    <div
                      key={request.id}
                      className="p-2 bg-white/40 rounded-lg border border-amber-100 hover:border-amber-200 transition-all hover:shadow-sm cursor-pointer"
                      onClick={() => handleOpenDetail(request)}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-medium text-slate-800 line-clamp-1 text-sm">
                          {request.reimbursementItem?.name || '未分類'}
                        </span>
                        <span className="text-amber-600 text-[10px] bg-amber-100/50 px-1.5 py-0.5 rounded-full">處理</span>
                      </div>
                      <div className="text-[10px] text-slate-500 space-y-1 mt-1">
                        {isOverdue(request) && (
                          <div className="flex items-center gap-1 text-red-500">
                            <WarningOutlined /> 已逾期 {dayjs().diff(dayjs(request.dueDate), 'day')} 天
                          </div>
                        )}
                        {!request.suggestedAccount && (
                          <div className="flex items-center gap-1 text-amber-600">
                            <WarningOutlined /> 缺少科目建議
                          </div>
                        )}
                        {(() => {
                          const metadata = request.metadata as Record<string, any> || {}
                          const isInvoicePending = metadata.isInvoicePending === true
                          const daysSinceCreation = dayjs().diff(dayjs(request.createdAt), 'day')
                          if (isInvoicePending && daysSinceCreation > 20) {
                            return (
                              <div className="flex items-center gap-1 text-red-500">
                                <ClockCircleOutlined /> 發票補正逾期 ({daysSinceCreation} 天)
                              </div>
                            )
                          }
                          return null
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Bottom Row: Review List (Full Width) */}
      <GlassCard className="w-full p-0 overflow-hidden h-fit">
          <div className="p-4 md:p-6 border-b border-white/20 flex justify-between items-center bg-white/10">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">待審核清單</h3>
              <p className="text-slate-500 text-sm mt-1">符合目前篩選的 {filteredRequests.length} 筆申請</p>
            </div>
            <Tooltip title="查看科目建議覆蓋率">
              <div className="text-right hidden md:block">
                <div className="text-xs text-slate-500 mb-1">科目建議覆蓋率</div>
                <Progress percent={aiCoverage} size="small" style={{ width: 120 }} strokeColor="#3b82f6" />
              </div>
            </Tooltip>
          </div>
          
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={filteredRequests}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              rowClassName={(record) => (isUrgentRequest(record) ? 'bg-red-50/30' : 'hover:bg-white/20 transition-colors')}
              locale={{ emptyText: <Empty description="沒有符合條件的申請" /> }}
              className="w-full"
              scroll={{ x: 1200 }}
            />
          </div>

          {/* Mobile Card View */}
          <div className="block md:hidden p-4 space-y-4 bg-slate-50/50">
            {loading ? (
              <div className="text-center py-8 text-slate-500">載入中...</div>
            ) : filteredRequests.length === 0 ? (
              <Empty description="沒有符合條件的申請" />
            ) : (
              filteredRequests.map((request) => (
                <div 
                  key={request.id} 
                  className={`bg-white rounded-xl shadow-sm border overflow-hidden ${
                    isUrgentRequest(request) ? 'border-red-200 shadow-red-100' : 'border-slate-100'
                  }`}
                >
                  {/* Card Header */}
                  <div className={`px-4 py-3 flex justify-between items-center border-b ${
                    isUrgentRequest(request) ? 'bg-red-50/30 border-red-100' : 'bg-slate-50/50 border-slate-100'
                  }`}>
                    <span className="font-medium text-slate-800 truncate max-w-[60%]">
                      {request.reimbursementItem?.name || '未分類'}
                    </span>
                    <Tag color={statusColorMap[request.status] || 'default'} className="mr-0">
                      {statusLabelMap[request.status] || request.status}
                    </Tag>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="text-xs text-slate-500">申請人</div>
                        <div className="font-medium text-slate-700">{request.creator?.name || '—'}</div>
                      </div>
                      <div className="space-y-1 text-right">
                        <div className="text-xs text-slate-500">金額</div>
                        <div className="font-mono font-semibold text-lg text-slate-800">
                          ${toNumber(request.amountOriginal).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {request.suggestedAccount && (
                      <div className="bg-blue-50/50 rounded-lg p-2 flex items-center gap-2 border border-blue-100">
                        <BulbOutlined className="text-blue-500" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-blue-600 font-medium truncate">
                            系統建議: {request.suggestedAccount.code} {request.suggestedAccount.name}
                          </div>
                        </div>
                        <div className="text-[10px] text-blue-400 whitespace-nowrap">
                          {(Number(request.suggestionConfidence) * 100).toFixed(0)}%
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      {request.priority === 'urgent' && <Tag color="red">急件</Tag>}
                      {request.dueDate && (
                        <Tag color={isOverdue(request) ? 'red' : 'blue'}>
                          到期 {dayjs(request.dueDate).format('MM/DD')}
                        </Tag>
                      )}
                      <span className="text-xs text-slate-400 ml-auto self-center">
                        等待 {dayjs().diff(dayjs(request.createdAt), 'day')} 天
                      </span>
                    </div>
                  </div>

                  {/* Card Footer - Actions */}
                  <div className="grid grid-cols-2 border-t border-slate-100 divide-x divide-slate-100">
                    {request.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleOpenDetail(request)}
                          className="col-span-2 py-3 bg-green-600 text-white font-medium active:bg-green-700 transition-colors flex items-center justify-center gap-2"
                        >
                          <CheckCircleOutlined /> 核准 / 審核
                        </button>
                        <button
                          onClick={() => handleOpenDetail(request)}
                          className="py-3 text-slate-600 font-medium active:bg-slate-50 transition-colors flex items-center justify-center gap-2 hover:bg-slate-50"
                        >
                          <FileSearchOutlined /> 詳情
                        </button>
                        <button
                          onClick={() => openActionModal('reject', request)}
                          className="py-3 text-red-600 font-medium active:bg-red-50 transition-colors flex items-center justify-center gap-2 hover:bg-red-50"
                        >
                          <CloseCircleOutlined /> 駁回
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleOpenDetail(request)}
                        className="col-span-2 py-3 text-slate-600 font-medium active:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                      >
                        查看詳情
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
      </GlassCard>

      <GlassDrawer
        title="申請詳情"
        placement="right"
        onClose={handleCloseDetail}
        open={detailDrawerOpen}
        width={420}
        destroyOnClose
      >
        {!selectedRequest ? (
          <Text type="secondary" className="p-6 block">請選擇申請查看詳情</Text>
        ) : (
          <div className="space-y-4">
            <GlassDrawerSection>
              <Descriptions bordered column={1} size="small" labelStyle={{ width: 100, background: 'transparent' }} contentStyle={{ background: 'transparent' }}>
                <Descriptions.Item label="報銷項目">
                  <span className="font-medium text-slate-800 text-base">
                    {selectedRequest.reimbursementItem?.name || '--'}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="申請人">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{selectedRequest.creator?.name || '--'}</span>
                    <span className="text-xs text-slate-400">{selectedRequest.creator?.email}</span>
                  </div>
                </Descriptions.Item>
                <Descriptions.Item label="申請日期">
                  {dayjs(selectedRequest.createdAt).format('YYYY/MM/DD HH:mm')}
                </Descriptions.Item>
                {selectedRequest.dueDate && (
                  <Descriptions.Item label="預計付款">
                    <span className={isOverdue(selectedRequest) ? 'text-red-600 font-medium' : ''}>
                      {dayjs(selectedRequest.dueDate).format('YYYY/MM/DD')}
                      {isOverdue(selectedRequest) && ' (已逾期)'}
                    </span>
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="金額">
                  <span className="font-mono font-semibold text-lg text-slate-700">
                    {selectedRequest.amountCurrency || 'TWD'} {toNumber(selectedRequest.amountOriginal).toLocaleString()}
                  </span>
                </Descriptions.Item>
                {(selectedRequest.paymentBankName || selectedRequest.paymentAccountLast5) && (
                  <Descriptions.Item label="收款帳戶">
                    <div className="flex flex-col">
                      <span>{selectedRequest.paymentBankName || '未指定銀行'}</span>
                      {selectedRequest.paymentAccountLast5 && (
                        <span className="text-xs text-slate-500">
                          帳號末五碼: {selectedRequest.paymentAccountLast5}
                        </span>
                      )}
                    </div>
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="狀態">
                  <div className="flex gap-2 items-center">
                    <Tag color={statusColorMap[selectedRequest.status] || 'default'} className="rounded-full px-2 border-none mr-0">
                      {statusLabelMap[selectedRequest.status] || selectedRequest.status}
                    </Tag>
                    {selectedRequest.priority === 'urgent' && <Tag color="red" className="rounded-full px-2 border-none mr-0">急件</Tag>}
                  </div>
                </Descriptions.Item>
                <Descriptions.Item label="會計科目">
                  {isAdmin && selectedRequest.status === 'pending' ? (
                    <div className="space-y-2 py-1">
                      <Select
                        value={reviewAccountId}
                        onChange={setReviewAccountId}
                        options={accounts.map((account) => ({
                          label: `${account.code} ｜ ${account.name}`,
                          value: account.id,
                        }))}
                        showSearch
                        optionFilterProp="label"
                        placeholder="選擇會計科目"
                        className="w-full"
                        status={!reviewAccountId ? 'error' : undefined}
                      />
                      {selectedRequest.suggestedAccount && (
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <BulbOutlined className="text-yellow-500" />
                          系統建議: {selectedRequest.suggestedAccount.code} {selectedRequest.suggestedAccount.name}
                          {selectedRequest.suggestionConfidence && (
                            <span className="text-slate-400">
                              (信心 {(Number(selectedRequest.suggestionConfidence) * 100).toFixed(0)}%)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span>
                      {selectedRequest.finalAccount
                        ? `${selectedRequest.finalAccount.code} · ${selectedRequest.finalAccount.name}`
                        : selectedRequest.suggestedAccount
                        ? `${selectedRequest.suggestedAccount.code} · ${selectedRequest.suggestedAccount.name}`
                        : '未指定'}
                    </span>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="備註">
                  {selectedRequest.description || <Text type="secondary">—</Text>}
                </Descriptions.Item>
                {(() => {
                  const metadata = selectedRequest.metadata as Record<string, any> || {}
                  if (metadata.isPrepaidCustoms) {
                    return (
                      <Descriptions.Item label="報關單號">
                        <Space>
                          <Text copyable>{metadata.customsDeclarationNumber || '未填寫'}</Text>
                          <Tag color="purple">關稅預付</Tag>
                        </Space>
                      </Descriptions.Item>
                    )
                  }
                  return null
                })()}
              </Descriptions>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">單據憑證</div>
              <ReceiptEvidenceViewer files={selectedRequest.evidenceFiles} attachmentUrl={selectedRequest.attachmentUrl} />
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">歷程紀錄</div>
              <div className="max-h-72 overflow-y-auto px-1 pt-1 pb-4">
                <Timeline
                  mode="left"
                  pending={historyLoading ? '讀取中...' : undefined}
                  items={history.map((entry) => ({
                    color:
                      entry.action === 'approved'
                        ? 'green'
                        : entry.action === 'rejected'
                        ? 'red'
                        : 'blue',
                    children: (
                      <div className="pb-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm font-medium leading-relaxed">
                          <span className="font-bold text-slate-700">
                            {historyLabelMap[entry.action] || entry.action}
                          </span>
                          <span className="text-xs text-slate-400 whitespace-nowrap">
                            {dayjs(entry.createdAt).format('YYYY/MM/DD HH:mm')}
                          </span>
                        </div>
                        {entry.actor && (
                          <div className="text-xs text-slate-500 mt-1">由 {entry.actor.name}</div>
                        )}
                        {entry.note && (
                          <div className="text-sm mt-2 text-slate-600 break-words whitespace-pre-wrap leading-relaxed p-2 bg-white/40 rounded-md border border-white/20">
                            {entry.note}
                          </div>
                        )}
                      </div>
                    ),
                  }))}
                />
                {!historyLoading && history.length === 0 && (
                  <Text type="secondary">尚無歷程紀錄</Text>
                )}
              </div>
            </GlassDrawerSection>

            {selectedRequest.canReview && (
              <GlassDrawerSection>
                <div className="flex gap-3">
                  <Button
                    block
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={() => {
                      handleCloseDetail()
                      openActionModal('reject', selectedRequest)
                    }}
                    className="rounded-full"
                  >
                    駁回
                  </Button>
                  <Button
                    block
                    type="primary"
                    className="!bg-green-600/85 !backdrop-blur-md !border-green-400/30 !text-white !shadow-md hover:!bg-green-600/95 hover:!shadow-lg transition-all duration-300 rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
                    icon={<CheckCircleOutlined />}
                    onClick={handleDirectApprove}
                    disabled={!selectedRequest.canReview}
                    loading={actionLoading}
                  >
                    核准
                  </Button>
                </div>
              </GlassDrawerSection>
            )}
          </div>
        )}
      </GlassDrawer>

      <Modal
        open={Boolean(actionState.request)}
        title="駁回申請"
        onCancel={closeActionModal}
        onOk={handleActionSubmit}
        confirmLoading={actionLoading}
        okText="駁回"
        okButtonProps={{
          danger: true,
        }}
      >
        {!actionState.request ? null : (
          <Form form={actionForm} layout="vertical">
            <Form.Item
              name="reason"
              label="駁回原因"
              rules={[{ required: true, message: '請輸入駁回原因' }]}
            >
              <Input.TextArea rows={3} placeholder="請輸入駁回原因" />
            </Form.Item>
            <Form.Item name="note" label="補充說明">
              <Input.TextArea rows={3} placeholder="可填寫需要申請人補齊的內容" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  )
}

export default ExpenseReviewCenterPage
