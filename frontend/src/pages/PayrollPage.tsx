import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd'
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  DownloadOutlined,
  DollarOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
  SendOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import { GlassDrawer, GlassDrawerSection } from '../components/ui/GlassDrawer'
import { payrollService } from '../services/payroll.service'
import {
  AuditLogEntry,
  BankAccount,
  PayrollItem,
  PayrollRun,
  PayrollRunPrecheckIssue,
  PayrollRunPrecheckResult,
} from '../types'
import { useAuth } from '../contexts/AuthContext'
import { hasPermission } from '../utils/access'

const { Title, Text } = Typography

const statusMetaMap: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'orange' },
  pending_approval: { label: '待批准', color: 'blue' },
  approved: { label: '已批准', color: 'green' },
  posted: { label: '已封存', color: 'purple' },
  paid: { label: '已發薪', color: 'gold' },
}

const payrollItemLabelMap: Record<string, string> = {
  BASE_SALARY: '月薪',
  TRANSPORT_ALLOWANCE: '車資補助',
  SUPERVISOR_ALLOWANCE: '主管加級',
  EXTRA_ALLOWANCE: '額外補貼',
  COURSE_ALLOWANCE: '課程補助',
  SENIORITY_PAY: '年工薪',
  BONUS: '獎金',
  SALARY_ADJUSTMENT: '調薪',
  ANNUAL_ADJUSTMENT: '年度調節',
  OVERTIME: '加班費',
  LATE_DEDUCTION: '遲到扣款',
  LEAVE_DEDUCTION: '請假扣款',
  LABOR_INSURANCE_DEDUCTION: '勞保扣照額',
  HEALTH_INSURANCE_DEDUCTION: '健保扣照額',
  PENSION_SELF_CONTRIBUTION: '個人自提 6%',
  DEPENDENT_INSURANCE: '家人加保',
  SALARY_ADVANCE: '薪資預支',
  DISASTER_CLOSURE_DEDUCTION: '統一放假扣款',
  ANNUAL_LEAVE_OVERUSE_DEDUCTION: '特休超用扣款',
  INS_EMP_LABOR: '勞保扣款（舊制）',
  INS_EMP_HEALTH: '健保扣款（舊制）',
  INS_EMP_SOCIAL: '社保扣款（舊制）',
}

type DetailScope = 'admin' | 'mine'
type PayrollRunCreatePayload = {
  periodStart: string
  periodEnd: string
  payDate: string
}

const PayrollPage: React.FC = () => {
  const { user } = useAuth()
  const [adminRuns, setAdminRuns] = useState<PayrollRun[]>([])
  const [myRuns, setMyRuns] = useState<PayrollRun[]>([])
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [loadingMine, setLoadingMine] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [precheckModalOpen, setPrecheckModalOpen] = useState(false)
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null)
  const [createLoading, setCreateLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailScope, setDetailScope] = useState<DetailScope>('admin')
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [myRunsError, setMyRunsError] = useState<string | null>(null)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [precheckResult, setPrecheckResult] = useState<PayrollRunPrecheckResult | null>(null)
  const [pendingCreatePayload, setPendingCreatePayload] = useState<PayrollRunCreatePayload | null>(null)
  const [form] = Form.useForm()
  const [payForm] = Form.useForm()

  const canManagePayroll = useMemo(
    () => hasPermission(user, 'payroll_admin:update'),
    [user],
  )

  const canReviewPayroll = useMemo(
    () => hasPermission(user, 'payroll_admin:read'),
    [user],
  )

  const fetchAdminRuns = async () => {
    if (!canReviewPayroll) {
      setAdminRuns([])
      return
    }

    setLoadingAdmin(true)
    try {
      const result = await payrollService.getPayrollRuns()
      setAdminRuns(Array.isArray(result?.items) ? result.items : [])
    } catch (error) {
      message.error('載入薪資批次失敗')
      setAdminRuns([])
    } finally {
      setLoadingAdmin(false)
    }
  }

  const fetchMyRuns = async () => {
    setLoadingMine(true)
    try {
      const result = await payrollService.getMyPayrollRuns()
      setMyRuns(Array.isArray(result) ? result : [])
      setMyRunsError(null)
    } catch (error: any) {
      setMyRuns([])
      setMyRunsError(error?.response?.data?.message || '尚未綁定員工資料，暫時無法顯示個人薪資單。')
    } finally {
      setLoadingMine(false)
    }
  }

  const fetchBankAccounts = async () => {
    if (!canManagePayroll) {
      setBankAccounts([])
      return
    }

    try {
      const accounts = await payrollService.getBankAccounts()
      setBankAccounts(Array.isArray(accounts) ? accounts : [])
    } catch (error) {
      message.error('載入發薪帳戶失敗')
      setBankAccounts([])
    }
  }

  useEffect(() => {
    fetchAdminRuns()
    fetchMyRuns()
    fetchBankAccounts()
  }, [canReviewPayroll, canManagePayroll])

  const adminMonthTotal = useMemo(() => {
    const currentMonth = dayjs().format('YYYY-MM')
    return adminRuns
      .filter((run) => dayjs(run.payDate).format('YYYY-MM') === currentMonth)
      .reduce((sum, run) => sum + (run.totalAmount ?? 0), 0)
  }, [adminRuns])

  const pendingEmployees = useMemo(
    () =>
      adminRuns
        .filter((run) => run.status === 'draft' || run.status === 'pending_approval')
        .reduce((sum, run) => sum + (run.employeeCount ?? 0), 0),
    [adminRuns],
  )

  const nextPayDate = useMemo(() => {
    const sourceRuns = canReviewPayroll ? adminRuns : myRuns
    const upcoming = sourceRuns
      .map((run) => dayjs(run.payDate))
      .filter((date) => date.isSame(dayjs(), 'day') || date.isAfter(dayjs(), 'day'))
      .sort((a, b) => a.valueOf() - b.valueOf())

    return upcoming[0]?.format('YYYY-MM-DD') ?? '尚未排程'
  }, [adminRuns, myRuns, canReviewPayroll])

  const latestMyRun = myRuns[0]
  const myLatestNetPay = latestMyRun?.totalAmount ?? 0
  const myApprovedCount = myRuns.length

  const syncRunIntoLists = (updated: PayrollRun) => {
    setAdminRuns((prev) => prev.map((run) => (run.id === updated.id ? updated : run)))
    setMyRuns((prev) => prev.map((run) => (run.id === updated.id ? updated : run)))
    if (selectedRun?.id === updated.id) {
      setSelectedRun(updated)
    }
  }

  const finalizeCreate = async (payload: PayrollRunCreatePayload) => {
    setCreateLoading(true)
    try {
      await payrollService.createPayrollRun(payload)
      message.success('薪資批次已建立')
      setDrawerOpen(false)
      setPrecheckModalOpen(false)
      setPendingCreatePayload(null)
      setPrecheckResult(null)
      form.resetFields()
      fetchAdminRuns()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '建立薪資批次失敗')
    } finally {
      setCreateLoading(false)
    }
  }

  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      const payload: PayrollRunCreatePayload = {
        periodStart: values.period[0].toISOString(),
        periodEnd: values.period[1].toISOString(),
        payDate: values.payDate.toISOString(),
      }
      setCreateLoading(true)
      const preview = await payrollService.previewPayrollRunWarnings(payload)
      if (preview.issueCount > 0) {
        setPendingCreatePayload(payload)
        setPrecheckResult(preview)
        setPrecheckModalOpen(true)
        return
      }
      await finalizeCreate(payload)
    } catch (error: any) {
      if (error?.errorFields) {
        return
      }
      message.error(error?.response?.data?.message || '薪資前檢查失敗')
    } finally {
      setCreateLoading(false)
    }
  }

  const handleViewDetail = async (runId: string, scope: DetailScope) => {
    setDetailLoading(true)
    setDetailOpen(true)
    setDetailScope(scope)
    try {
      const [detail, logs] = await Promise.all([
        scope === 'admin'
          ? payrollService.getPayrollRun(runId)
          : payrollService.getMyPayrollRun(runId),
        scope === 'admin'
          ? payrollService.getPayrollRunAuditLogs(runId)
          : Promise.resolve([] as AuditLogEntry[]),
      ])
      setSelectedRun(detail)
      setAuditLogs(logs)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '載入薪資明細失敗')
      setDetailOpen(false)
      setSelectedRun(null)
      setAuditLogs([])
    } finally {
      setDetailLoading(false)
    }
  }

  const handleSubmitRun = async (runId: string) => {
    setActionLoadingId(runId)
    try {
      const updated = await payrollService.submitPayrollRun(runId)
      message.success('薪資批次已送審')
      syncRunIntoLists(updated)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '送審失敗')
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleApproveRun = async (runId: string) => {
    setActionLoadingId(runId)
    try {
      const updated = await payrollService.approvePayrollRun(runId)
      message.success('薪資批次已批准並封存')
      syncRunIntoLists(updated)
      fetchMyRuns()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '批准失敗')
    } finally {
      setActionLoadingId(null)
    }
  }

  const handlePostRun = async (runId: string) => {
    setActionLoadingId(runId)
    try {
      const updated = await payrollService.postPayrollRun(runId)
      message.success('薪資批次已過帳至會計')
      syncRunIntoLists(updated)
      fetchMyRuns()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '過帳失敗')
    } finally {
      setActionLoadingId(null)
    }
  }

  const openPayModal = (run: PayrollRun) => {
    setSelectedRun(run)
    payForm.setFieldsValue({
      bankAccountId: run.bankAccount?.id,
      paidAt: dayjs(),
    })
    setPayModalOpen(true)
  }

  const handlePayRun = async () => {
    if (!selectedRun) {
      return
    }

    try {
      const values = await payForm.validateFields()
      setActionLoadingId(selectedRun.id)
      const updated = await payrollService.payPayrollRun(selectedRun.id, {
        bankAccountId: values.bankAccountId,
        paidAt: values.paidAt?.toISOString(),
      })
      message.success('薪資已標記為完成發薪')
      syncRunIntoLists(updated)
      setPayModalOpen(false)
      payForm.resetFields()
      fetchMyRuns()
    } catch (error: any) {
      if (error?.errorFields) {
        return
      }
      message.error(error?.response?.data?.message || '發薪失敗')
    } finally {
      setActionLoadingId(null)
    }
  }

  const escapeHtml = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')

  const handlePrintPayslip = () => {
    if (!selectedRun || detailScope !== 'mine') {
      return
    }

    const itemRows = (selectedRun.items ?? [])
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(payrollItemLabelMap[item.type] || item.type)}</td>
            <td>${escapeHtml(item.remark || '—')}</td>
            <td style="text-align:right;">$${(item.amountBase ?? 0).toLocaleString()}</td>
          </tr>
        `,
      )
      .join('')

    const html = `
      <!doctype html>
      <html lang="zh-Hant">
        <head>
          <meta charset="utf-8" />
          <title>薪資單 ${dayjs(selectedRun.payDate).format('YYYY-MM-DD')}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif; padding: 32px; color: #0f172a; }
            h1 { margin: 0 0 8px; font-size: 28px; }
            .meta { margin-bottom: 24px; color: #475569; font-size: 14px; line-height: 1.8; }
            .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
            .box { border: 1px solid #dbeafe; border-radius: 16px; padding: 16px; background: #f8fbff; }
            .label { font-size: 12px; color: #64748b; margin-bottom: 6px; }
            .value { font-size: 24px; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 12px 8px; font-size: 14px; text-align: left; vertical-align: top; }
            th { color: #475569; }
          </style>
        </head>
        <body>
          <h1>員工薪資單</h1>
          <div class="meta">
            <div>計薪期間：${dayjs(selectedRun.periodStart).format('YYYY-MM-DD')} ~ ${dayjs(selectedRun.periodEnd).format('YYYY-MM-DD')}</div>
            <div>發薪日：${dayjs(selectedRun.payDate).format('YYYY-MM-DD')}</div>
            <div>批准者：${escapeHtml(selectedRun.approver?.name || '—')}</div>
          </div>
          <div class="summary">
            <div class="box">
              <div class="label">實發金額</div>
              <div class="value">$${(selectedRun.totalAmount ?? 0).toLocaleString()}</div>
            </div>
            <div class="box">
              <div class="label">薪資項目</div>
              <div class="value">${selectedRun.items?.length ?? 0}</div>
            </div>
            <div class="box">
              <div class="label">狀態</div>
              <div class="value">${escapeHtml(selectedStatusMeta?.label || '已批准')}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th>備註</th>
                <th style="text-align:right;">金額</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        </body>
      </html>
    `

    const printWindow = window.open('', '_blank', 'width=960,height=720')
    if (!printWindow) {
      message.error('瀏覽器阻擋了列印視窗，請允許彈出視窗後重試。')
      return
    }

    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const handleDownloadPayslipPdf = async () => {
    if (!selectedRun || detailScope !== 'mine') {
      return
    }

    try {
      await payrollService.downloadMyPayrollRunPdf(selectedRun.id)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '下載薪資單 PDF 失敗')
    }
  }

  const adminColumns = [
    {
      title: '計薪期間',
      key: 'period',
      render: (_: unknown, record: PayrollRun) =>
        `${dayjs(record.periodStart).format('YYYY-MM-DD')} ~ ${dayjs(record.periodEnd).format('YYYY-MM-DD')}`,
    },
    {
      title: '發薪日',
      dataIndex: 'payDate',
      key: 'payDate',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
    },
    {
      title: '人數',
      dataIndex: 'employeeCount',
      key: 'employeeCount',
      render: (value?: number) => `${value ?? 0} 人`,
    },
    {
      title: '總金額',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      render: (val?: number) => `$${(val || 0).toLocaleString()}`,
    },
    {
      title: '狀態',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const meta = statusMetaMap[status] ?? { label: status, color: 'default' }
        return <Tag color={meta.color}>{meta.label}</Tag>
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: PayrollRun) => (
        <Space wrap>
          <Button type="text" icon={<FileTextOutlined />} onClick={() => handleViewDetail(record.id, 'admin')}>
            明細
          </Button>
          {canManagePayroll && record.status === 'draft' ? (
            <Button
              type="text"
              icon={<SendOutlined />}
              loading={actionLoadingId === record.id}
              onClick={() => handleSubmitRun(record.id)}
            >
              送審
            </Button>
          ) : null}
          {canManagePayroll && record.status === 'pending_approval' ? (
            <Button
              type="text"
              icon={<CheckCircleOutlined />}
              loading={actionLoadingId === record.id}
              onClick={() => handleApproveRun(record.id)}
            >
              批准
            </Button>
          ) : null}
          {canManagePayroll && record.status === 'approved' ? (
            <Button
              type="text"
              icon={<CheckCircleOutlined />}
              loading={actionLoadingId === record.id}
              onClick={() => handlePostRun(record.id)}
            >
              過帳
            </Button>
          ) : null}
          {canManagePayroll && record.status === 'posted' ? (
            <Button
              type="text"
              icon={<DollarOutlined />}
              loading={actionLoadingId === record.id}
              onClick={() => openPayModal(record)}
            >
              發薪
            </Button>
          ) : null}
        </Space>
      ),
    },
  ]

  const myColumns = [
    {
      title: '計薪期間',
      key: 'period',
      render: (_: unknown, record: PayrollRun) =>
        `${dayjs(record.periodStart).format('YYYY-MM-DD')} ~ ${dayjs(record.periodEnd).format('YYYY-MM-DD')}`,
    },
    {
      title: '發薪日',
      dataIndex: 'payDate',
      key: 'payDate',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
    },
    {
      title: '實發金額',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      render: (value?: number) => `$${(value ?? 0).toLocaleString()}`,
    },
    {
      title: '狀態',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const meta = statusMetaMap[status] ?? { label: status, color: 'default' }
        return <Tag color={meta.color}>{meta.label}</Tag>
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: PayrollRun) => (
        <Button type="text" icon={<FileTextOutlined />} onClick={() => handleViewDetail(record.id, 'mine')}>
          查看薪資單
        </Button>
      ),
    },
  ]

  const precheckIssueColumns = [
    {
      title: '日期',
      dataIndex: 'workDate',
      key: 'workDate',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    {
      title: '員工',
      key: 'employee',
      render: (_: unknown, issue: PayrollRunPrecheckIssue) => (
        <div>
          <div className="font-medium text-slate-800">
            {issue.employeeName} ({issue.employeeNo})
          </div>
          <div className="text-xs text-slate-400">{issue.departmentName || '未分配部門'}</div>
        </div>
      ),
    },
    {
      title: '異常類型',
      dataIndex: 'issueType',
      key: 'issueType',
      render: (value: PayrollRunPrecheckIssue['issueType']) => (
        <Tag color={value === 'INCOMPLETE_CLOCK' ? 'orange' : 'red'}>
          {value === 'INCOMPLETE_CLOCK' ? '缺少打卡' : '疑似漏請假／未出勤'}
        </Tag>
      ),
    },
    {
      title: '說明',
      dataIndex: 'detail',
      key: 'detail',
      render: (value: string, issue: PayrollRunPrecheckIssue) => (
        <div>
          <div>{value}</div>
          <div className="text-xs text-slate-400">
            班表來源：
            {issue.scheduleSource === 'employee'
              ? '員工個人班表'
              : issue.scheduleSource === 'department'
                ? '部門班表'
                : issue.scheduleSource === 'global'
                  ? '全公司班表'
                  : '預設週一至週五'}
            {issue.summaryStatus ? ` · 出勤狀態：${issue.summaryStatus}` : ''}
          </div>
        </div>
      ),
    },
  ]

  const itemColumns = [
    {
      title: detailScope === 'admin' ? '員工' : '項目',
      key: 'employee',
      render: (_: unknown, item: PayrollItem) =>
        detailScope === 'admin'
          ? item.employee
            ? `${item.employee.name} (${item.employee.employeeNo})`
            : item.employeeId
          : payrollItemLabelMap[item.type] || item.type,
    },
    detailScope === 'admin'
      ? {
          title: '項目',
          dataIndex: 'type',
          key: 'type',
          render: (value: string) => payrollItemLabelMap[value] || value,
        }
      : null,
    {
      title: '金額',
      dataIndex: 'amountBase',
      key: 'amountBase',
      render: (amount: number) => `$${(amount || 0).toLocaleString()}`,
    },
    {
      title: '備註',
      dataIndex: 'remark',
      key: 'remark',
      render: (remark?: string | null) => remark || '—',
    },
  ].filter(Boolean) as any[]

  const selectedStatusMeta = selectedRun
    ? statusMetaMap[selectedRun.status] ?? { label: selectedRun.status, color: 'default' }
    : null

  const adminPanel = (
    <div className="space-y-8">
      <Row gutter={16}>
        <Col span={8}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="本月預估薪資支出"
              value={adminMonthTotal}
              prefix={<DollarOutlined />}
              precision={0}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="待處理人數"
              value={pendingEmployees}
              prefix={<TeamOutlined />}
              suffix="人"
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="下次發薪日"
              value={nextPayDate}
              prefix={<CalendarOutlined />}
              valueStyle={{ fontSize: '20px' }}
            />
          </Card>
        </Col>
      </Row>

      <Card className="glass-card" bordered={false}>
        <Table
          rowKey="id"
          loading={loadingAdmin}
          columns={adminColumns}
          dataSource={adminRuns}
          pagination={{ pageSize: 8 }}
        />
      </Card>
    </div>
  )

  const myPanel = (
    <div className="space-y-8">
      {myRunsError ? <Alert type="info" showIcon message="個人薪資單尚未啟用" description={myRunsError} /> : null}

      <Row gutter={16}>
        <Col span={8}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="最近一期實發薪資"
              value={myLatestNetPay}
              prefix={<DollarOutlined />}
              precision={0}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="已發佈薪資單"
              value={myApprovedCount}
              prefix={<FileTextOutlined />}
              suffix="期"
              valueStyle={{ color: '#16a34a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="最近發薪日"
              value={latestMyRun ? dayjs(latestMyRun.payDate).format('YYYY-MM-DD') : '尚無資料'}
              prefix={<CalendarOutlined />}
              valueStyle={{ fontSize: '20px' }}
            />
          </Card>
        </Col>
      </Row>

      <Card className="glass-card" bordered={false}>
        {myRuns.length === 0 && !loadingMine ? (
          <Empty description="目前還沒有可查看的薪資單" />
        ) : (
          <Table
            rowKey="id"
            loading={loadingMine}
            columns={myColumns}
            dataSource={myRuns}
            pagination={{ pageSize: 8 }}
          />
        )}
      </Card>
    </div>
  )

  const tabItems = canReviewPayroll
    ? [
        { key: 'admin', label: '薪資批次', children: adminPanel },
        { key: 'mine', label: '我的薪資單', children: myPanel },
      ]
    : [{ key: 'mine', label: '我的薪資單', children: myPanel }]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <div className="flex justify-between items-end">
        <div>
          <Title level={2} className="!mb-1 !font-light">薪資管理</Title>
          <Text className="text-gray-500">
            {canReviewPayroll ? '薪資計算、送審、批准與個人薪資查詢' : '查看個人薪資單與每期薪資明細'}
          </Text>
        </div>
        {canManagePayroll ? (
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setDrawerOpen(true)}>
            執行薪資計算
          </Button>
        ) : null}
      </div>

      <Tabs defaultActiveKey={canReviewPayroll ? 'admin' : 'mine'} items={tabItems} />

      <GlassDrawer
        title="執行薪資計算"
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false)
          setPrecheckModalOpen(false)
          setPendingCreatePayload(null)
          setPrecheckResult(null)
        }}
        width={420}
      >
        <Form form={form} layout="vertical" className="h-full flex flex-col">
          <div className="flex-1 space-y-4">
            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">計算參數</div>
              <Form.Item name="period" label="計薪期間" rules={[{ required: true }]}>
                <DatePicker.RangePicker className="w-full" />
              </Form.Item>
              <Form.Item name="payDate" label="預計發薪日" rules={[{ required: true }]}>
                <DatePicker className="w-full" />
              </Form.Item>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">說明</div>
              <Text type="secondary" className="text-xs">
                系統會先檢查本期是否有漏請假、漏打卡或缺少出勤摘要的員工，再建立薪資草稿，避免直接影響薪資計算。
              </Text>
            </GlassDrawerSection>
          </div>

          <GlassDrawerSection>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  setDrawerOpen(false)
                  setPrecheckModalOpen(false)
                  setPendingCreatePayload(null)
                  setPrecheckResult(null)
                }}
                className="rounded-full"
              >
                取消
              </Button>
              <Button type="primary" loading={createLoading} onClick={handleCreate} className="rounded-full bg-blue-600 hover:bg-blue-500 border-none shadow-lg shadow-blue-200">
                開始計算
              </Button>
            </div>
          </GlassDrawerSection>
        </Form>
      </GlassDrawer>

      <GlassDrawer
        title={detailScope === 'admin' ? '薪資批次明細' : '我的薪資單'}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          setSelectedRun(null)
          setAuditLogs([])
        }}
        width={720}
      >
        {selectedRun ? (
          <div className="space-y-4">
            <GlassDrawerSection>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-800">
                    {dayjs(selectedRun.periodStart).format('YYYY-MM-DD')} ~ {dayjs(selectedRun.periodEnd).format('YYYY-MM-DD')}
                  </div>
                  <Text type="secondary">
                    發薪日 {dayjs(selectedRun.payDate).format('YYYY-MM-DD')}
                  </Text>
                </div>
                {selectedStatusMeta ? <Tag color={selectedStatusMeta.color}>{selectedStatusMeta.label}</Tag> : null}
              </div>

              <Row gutter={16} className="mt-4">
                <Col span={8}>
                  <Statistic title={detailScope === 'admin' ? '總金額' : '實發金額'} value={selectedRun.totalAmount ?? 0} prefix="$" precision={0} />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={detailScope === 'admin' ? '涉及員工' : '薪資項目'}
                    value={detailScope === 'admin' ? selectedRun.employeeCount ?? 0 : selectedRun.items?.length ?? 0}
                    suffix={detailScope === 'admin' ? '人' : '項'}
                  />
                </Col>
                <Col span={8}>
                  <Statistic title="建立日期" value={selectedRun.createdAt ? dayjs(selectedRun.createdAt).format('YYYY-MM-DD') : '—'} />
                </Col>
              </Row>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-500">
                <span>建立者：{selectedRun.creator?.name || '—'}</span>
                <span>批准者：{selectedRun.approver?.name || '—'}</span>
                <span>批准時間：{selectedRun.approvedAt ? dayjs(selectedRun.approvedAt).format('YYYY-MM-DD HH:mm') : '—'}</span>
                <span>發薪帳戶：{selectedRun.bankAccount ? `${selectedRun.bankAccount.bankName} ${selectedRun.bankAccount.accountNo.slice(-5)}` : '—'}</span>
                <span>發薪人：{selectedRun.payor?.name || '—'}</span>
                <span>發薪時間：{selectedRun.paidAt ? dayjs(selectedRun.paidAt).format('YYYY-MM-DD HH:mm') : '—'}</span>
              </div>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 flex items-center justify-between">
                <div className="font-semibold text-slate-800">
                  {detailScope === 'admin' ? '薪資項目' : '薪資單明細'}
                </div>
                {canManagePayroll && detailScope === 'admin' && selectedRun.status === 'draft' ? (
                  <Button
                    icon={<SendOutlined />}
                    loading={actionLoadingId === selectedRun.id}
                    onClick={() => handleSubmitRun(selectedRun.id)}
                  >
                    送審
                  </Button>
                ) : null}
                {canManagePayroll && detailScope === 'admin' && selectedRun.status === 'pending_approval' ? (
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    loading={actionLoadingId === selectedRun.id}
                    onClick={() => handleApproveRun(selectedRun.id)}
                  >
                    批准封存
                  </Button>
                ) : null}
                {canManagePayroll && detailScope === 'admin' && selectedRun.status === 'approved' ? (
                  <Button
                    type="primary"
                    loading={actionLoadingId === selectedRun.id}
                    onClick={() => handlePostRun(selectedRun.id)}
                  >
                    過帳到會計
                  </Button>
                ) : null}
                {canManagePayroll && detailScope === 'admin' && selectedRun.status === 'posted' ? (
                  <Button
                    type="primary"
                    loading={actionLoadingId === selectedRun.id}
                    onClick={() => openPayModal(selectedRun)}
                  >
                    標記已發薪
                  </Button>
                ) : null}
                {detailScope === 'mine' ? (
                  <Space>
                    <Button icon={<DownloadOutlined />} onClick={() => void handleDownloadPayslipPdf()}>
                      下載正式 PDF
                    </Button>
                    <Button icon={<PrinterOutlined />} onClick={handlePrintPayslip}>
                      列印預覽
                    </Button>
                  </Space>
                ) : null}
              </div>

              <Table
                rowKey="id"
                loading={detailLoading}
                columns={itemColumns}
                dataSource={selectedRun.items ?? []}
                pagination={{ pageSize: 8 }}
              />
            </GlassDrawerSection>

            {detailScope === 'admin' ? (
              <GlassDrawerSection>
                <div className="mb-4 font-semibold text-slate-800">流程紀錄</div>
                {auditLogs.length === 0 ? (
                  <div className="text-sm text-slate-400">目前尚無可顯示的操作紀錄。</div>
                ) : (
                  <Timeline
                    items={auditLogs.map((log) => ({
                      color:
                        log.action === 'APPROVE'
                          ? 'green'
                          : log.action === 'PAY'
                            ? 'gold'
                            : log.action === 'POST'
                              ? 'purple'
                              : 'blue',
                      children: (
                        <div className="space-y-1">
                          <div className="font-medium text-slate-800">{log.action}</div>
                          <div className="text-xs text-slate-500">
                            {log.user?.name || '系統'} · {dayjs(log.createdAt).format('YYYY-MM-DD HH:mm')}
                          </div>
                          <div className="text-xs text-slate-400">
                            {log.newData?.status ? `狀態：${String(log.newData.status)}` : '已更新紀錄'}
                          </div>
                        </div>
                      ),
                    }))}
                  />
                )}
              </GlassDrawerSection>
            ) : null}
          </div>
        ) : (
          <div className="py-12 text-center text-slate-400">{detailLoading ? '載入中...' : '尚未選取薪資資料'}</div>
        )}
      </GlassDrawer>

      <Modal
        title={
          <div className="flex items-center gap-2">
            <ExclamationCircleOutlined className="text-amber-500" />
            <span>薪資結算前提醒</span>
          </div>
        }
        open={precheckModalOpen}
        onCancel={() => {
          setPrecheckModalOpen(false)
          setPendingCreatePayload(null)
          setPrecheckResult(null)
        }}
        onOk={() => {
          if (pendingCreatePayload) {
            void finalizeCreate(pendingCreatePayload)
          }
        }}
        okText="仍要建立薪資批次"
        cancelText="先回去確認"
        confirmLoading={createLoading}
        width={980}
      >
        {precheckResult ? (
          <div className="space-y-4">
            <Alert
              type="warning"
              showIcon
              message={`本期預估工作天數 ${precheckResult.periodWorkdayCount} 天，找到 ${precheckResult.issueCount} 筆待確認異常`}
              description={`已檢查 ${precheckResult.employeesChecked} 位員工。系統已自動排除週末、特殊統一放假宣告，以及已送出／已核准的請假紀錄。建議先確認是否漏請假或漏打卡，再決定是否繼續結算。`}
            />
            <Table
              rowKey={(issue) => `${issue.employeeId}-${issue.workDate}-${issue.issueType}`}
              columns={precheckIssueColumns}
              dataSource={precheckResult.issues}
              pagination={{ pageSize: 8 }}
              size="small"
              scroll={{ x: 840 }}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        title="完成薪資發放"
        open={payModalOpen}
        onCancel={() => {
          setPayModalOpen(false)
          payForm.resetFields()
        }}
        onOk={handlePayRun}
        okText="確認發薪"
        confirmLoading={Boolean(selectedRun && actionLoadingId === selectedRun.id)}
      >
        <Form form={payForm} layout="vertical">
          <Form.Item
            name="bankAccountId"
            label="出款帳戶"
            rules={[{ required: true, message: '請選擇出款帳戶' }]}
          >
            <Select
              placeholder="選擇銀行帳戶"
              options={bankAccounts.map((account) => ({
                value: account.id,
                label: `${account.bankName} ${account.accountNo}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="paidAt"
            label="實際發薪時間"
            rules={[{ required: true, message: '請選擇發薪時間' }]}
          >
            <DatePicker showTime className="w-full" />
          </Form.Item>
          <Text type="secondary" className="text-xs">
            系統會同步建立薪資付款分錄，借記應付薪資、貸記銀行存款。
          </Text>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default PayrollPage
