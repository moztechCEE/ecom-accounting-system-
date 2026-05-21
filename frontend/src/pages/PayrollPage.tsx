import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  TimePicker,
  Timeline,
  Typography,
  message,
} from 'antd'
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  DownloadOutlined,
  DollarOutlined,
  FileTextOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
  RollbackOutlined,
  SendOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import { GlassDrawer, GlassDrawerSection } from '../components/ui/GlassDrawer'
import { payrollService } from '../services/payroll.service'
import { attendanceService } from '../services/attendance.service'
import {
  AuditLogEntry,
  BankAccount,
  PayrollEmployeeSalaryRow,
  PayrollItem,
  PayrollRun,
  PayrollRunPrecheckIssue,
  PayrollRunPrecheckResult,
} from '../types'
import { LeaveStatus, LeaveType } from '../types/attendance'
import { useAuth } from '../contexts/AuthContext'
import { hasPermission } from '../utils/access'

const { Title, Text } = Typography

const statusMetaMap: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'orange' },
  pending_approval: { label: '待確認', color: 'blue' },
  approved: { label: '已確定', color: 'green' },
  posted: { label: '已產生憑證', color: 'purple' },
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
  LABOR_INSURANCE_DEDUCTION: '勞保扣除額',
  HEALTH_INSURANCE_DEDUCTION: '健保扣除額',
  PENSION_SELF_CONTRIBUTION: '個人自提 6%',
  DEPENDENT_INSURANCE: '家人加保',
  SALARY_ADVANCE: '薪資預支',
  DISASTER_CLOSURE_DEDUCTION: '統一放假扣款',
  ANNUAL_LEAVE_OVERUSE_DEDUCTION: '特休超用扣款',
  ANNUAL_LEAVE_UNUSED_PAYOUT: '剩餘特休變現',
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
  const [employeeSalaryRows, setEmployeeSalaryRows] = useState<PayrollEmployeeSalaryRow[]>([])
  const [myRuns, setMyRuns] = useState<PayrollRun[]>([])
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [loadingEmployeeSalaries, setLoadingEmployeeSalaries] = useState(false)
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
  const [selectedPrecheckIssue, setSelectedPrecheckIssue] = useState<PayrollRunPrecheckIssue | null>(null)
  const [attendanceAdjustOpen, setAttendanceAdjustOpen] = useState(false)
  const [leaveBackfillOpen, setLeaveBackfillOpen] = useState(false)
  const [attendanceAdjustLoading, setAttendanceAdjustLoading] = useState(false)
  const [leaveBackfillLoading, setLeaveBackfillLoading] = useState(false)
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [form] = Form.useForm()
  const [payForm] = Form.useForm()
  const [attendanceAdjustForm] = Form.useForm()
  const [leaveBackfillForm] = Form.useForm()

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

  const fetchEmployeeSalaryRows = async () => {
    if (!canReviewPayroll) {
      setEmployeeSalaryRows([])
      return
    }

    setLoadingEmployeeSalaries(true)
    try {
      const rows = await payrollService.getEmployeeSalaryRows()
      setEmployeeSalaryRows(Array.isArray(rows) ? rows : [])
    } catch (error) {
      message.error('載入職員薪資失敗')
      setEmployeeSalaryRows([])
    } finally {
      setLoadingEmployeeSalaries(false)
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
    fetchEmployeeSalaryRows()
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

  const refreshPrecheck = async () => {
    if (!pendingCreatePayload) {
      return
    }

    const preview = await payrollService.previewPayrollRunWarnings(pendingCreatePayload)
    setPrecheckResult(preview)
    if (preview.issueCount === 0) {
      message.success('本期異常已確認完成，可以建立薪資批次')
    }
  }

  const openAttendanceAdjustModal = (issue: PayrollRunPrecheckIssue) => {
    setSelectedPrecheckIssue(issue)
    attendanceAdjustForm.setFieldsValue({
      clockInTime: issue.clockInTime ? dayjs(issue.clockInTime) : dayjs(`${issue.workDate} 09:00`),
      clockOutTime: issue.clockOutTime ? dayjs(issue.clockOutTime) : dayjs(`${issue.workDate} 18:00`),
      breakMinutes: 60,
      note: '薪資結算前由管理員補登打卡',
    })
    setAttendanceAdjustOpen(true)
  }

  const openLeaveBackfillModal = async (issue: PayrollRunPrecheckIssue) => {
    setSelectedPrecheckIssue(issue)
    leaveBackfillForm.setFieldsValue({
      startTime: dayjs(`${issue.workDate} 09:00`),
      endTime: dayjs(`${issue.workDate} 18:00`),
      hours: 8,
      reason: '薪資結算前補登請假',
    })
    setLeaveBackfillOpen(true)

    if (leaveTypes.length === 0) {
      try {
        const types = await attendanceService.getAdminLeaveTypes()
        setLeaveTypes(types.filter((type) => type.isActive !== false))
      } catch (error: any) {
        message.error(error?.response?.data?.message || '載入假別失敗')
      }
    }
  }

  const handleAttendanceAdjust = async () => {
    if (!selectedPrecheckIssue) {
      return
    }

    try {
      const values = await attendanceAdjustForm.validateFields()
      setAttendanceAdjustLoading(true)
      await attendanceService.adjustAdminAttendance({
        employeeId: selectedPrecheckIssue.employeeId,
        workDate: selectedPrecheckIssue.workDate,
        clockInAt: values.clockInTime
          ? dayjs(`${selectedPrecheckIssue.workDate} ${values.clockInTime.format('HH:mm')}`).toISOString()
          : undefined,
        clockOutAt: values.clockOutTime
          ? dayjs(`${selectedPrecheckIssue.workDate} ${values.clockOutTime.format('HH:mm')}`).toISOString()
          : undefined,
        breakMinutes: Number(values.breakMinutes ?? 0),
        note: values.note,
      })
      message.success('出勤時間已補登')
      setAttendanceAdjustOpen(false)
      attendanceAdjustForm.resetFields()
      await refreshPrecheck()
    } catch (error: any) {
      if (error?.errorFields) {
        return
      }
      message.error(error?.response?.data?.message || '補登出勤失敗')
    } finally {
      setAttendanceAdjustLoading(false)
    }
  }

  const handleLeaveBackfill = async () => {
    if (!selectedPrecheckIssue) {
      return
    }

    try {
      const values = await leaveBackfillForm.validateFields()
      setLeaveBackfillLoading(true)
      const startAt = dayjs(`${selectedPrecheckIssue.workDate} ${values.startTime.format('HH:mm')}`)
      const endAt = dayjs(`${selectedPrecheckIssue.workDate} ${values.endTime.format('HH:mm')}`)
      if (!endAt.isAfter(startAt)) {
        message.error('請假結束時間必須晚於開始時間')
        return
      }

      const request = await attendanceService.createLeaveRequest({
        employeeId: selectedPrecheckIssue.employeeId,
        leaveTypeId: values.leaveTypeId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        hours: Number(values.hours),
        reason: values.reason,
        adminBackfill: true,
      })
      await attendanceService.updateLeaveStatus(
        request.id,
        LeaveStatus.APPROVED,
        '薪資結算前由管理員補假並核准',
      )
      message.success('假單已補登並核准')
      setLeaveBackfillOpen(false)
      leaveBackfillForm.resetFields()
      await refreshPrecheck()
    } catch (error: any) {
      if (error?.errorFields) {
        return
      }
      message.error(error?.response?.data?.message || '補假失敗')
    } finally {
      setLeaveBackfillLoading(false)
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
      message.success('薪資批次已確定')
      syncRunIntoLists(updated)
      fetchEmployeeSalaryRows()
      fetchMyRuns()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '確定薪資失敗')
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleUnapproveRun = (runId: string) => {
    Modal.confirm({
      title: '取消確定並退回草稿？',
      icon: <ExclamationCircleOutlined />,
      content: '退回草稿後，薪資明細可以重新檢查與修正；若已產生會計憑證或已發薪，系統會阻擋直接退回。',
      okText: '退回草稿',
      cancelText: '保留確定',
      okButtonProps: { danger: true },
      onOk: async () => {
        setActionLoadingId(runId)
        try {
          const updated = await payrollService.unapprovePayrollRun(runId, {
            reason: '管理員取消確定，退回草稿修正',
          })
          message.success('薪資批次已退回草稿')
          syncRunIntoLists(updated)
          fetchEmployeeSalaryRows()
          fetchMyRuns()
        } catch (error: any) {
          message.error(error?.response?.data?.message || '取消確定失敗')
        } finally {
          setActionLoadingId(null)
        }
      },
    })
  }

  const handlePostRun = async (runId: string) => {
    setActionLoadingId(runId)
    try {
      const updated = await payrollService.postPayrollRun(runId)
      message.success('薪資批次已產生會計憑證')
      syncRunIntoLists(updated)
      fetchEmployeeSalaryRows()
      fetchMyRuns()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '產生會計憑證失敗')
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
      message.success('薪資付款憑證已建立並完成發薪')
      syncRunIntoLists(updated)
      fetchEmployeeSalaryRows()
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

  const handleDownloadEmployeePayslipPdf = async (row: PayrollEmployeeSalaryRow) => {
    try {
      await payrollService.downloadPayrollRunPdf(row.payrollRunId, row.employeeId)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '列印員工薪資單失敗')
    }
  }

  const adminColumns = [
    {
      title: '歸屬年月',
      key: 'payrollMonth',
      render: (_: unknown, record: PayrollRun) =>
        `${dayjs(record.periodEnd).format('YYYY/MM')} -1`,
    },
    {
      title: '支付類型',
      key: 'payType',
      render: () => '每月發薪',
    },
    {
      title: '薪資帳簿名稱',
      key: 'bookName',
      render: (_: unknown, record: PayrollRun) => `${dayjs(record.periodEnd).format('YYYYMM')}薪資`,
    },
    {
      title: '計薪期間',
      key: 'period',
      render: (_: unknown, record: PayrollRun) =>
        `${dayjs(record.periodStart).format('MM/DD')} ~ ${dayjs(record.periodEnd).format('MM/DD')}`,
    },
    {
      title: '發薪日',
      dataIndex: 'payDate',
      key: 'payDate',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
    },
    {
      title: '人員數',
      dataIndex: 'employeeCount',
      key: 'employeeCount',
      render: (value?: number) => `${value ?? 0} 人`,
    },
    {
      title: '實發總額',
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
              確定
            </Button>
          ) : null}
          {canManagePayroll && record.status === 'approved' ? (
            <>
              <Button
                type="text"
                icon={<RollbackOutlined />}
                loading={actionLoadingId === record.id}
                onClick={() => handleUnapproveRun(record.id)}
              >
                取消確定
              </Button>
              <Button
                type="text"
                icon={<CheckCircleOutlined />}
                loading={actionLoadingId === record.id}
                onClick={() => handlePostRun(record.id)}
              >
                會計憑證
              </Button>
            </>
          ) : null}
          {canManagePayroll && record.status === 'posted' ? (
            <Button
              type="text"
              icon={<DollarOutlined />}
              loading={actionLoadingId === record.id}
              onClick={() => openPayModal(record)}
            >
              付款憑證
            </Button>
          ) : null}
        </Space>
      ),
    },
  ]

  const employeeSalaryColumns = [
    {
      title: '歸屬年月',
      key: 'payrollMonth',
      render: (_: unknown, row: PayrollEmployeeSalaryRow) =>
        `${dayjs(row.periodEnd).format('YYYY/MM')} -1`,
    },
    {
      title: '薪資帳簿名稱',
      dataIndex: 'bookName',
      key: 'bookName',
    },
    {
      title: '對象期間',
      key: 'period',
      render: (_: unknown, row: PayrollEmployeeSalaryRow) =>
        `${dayjs(row.periodStart).format('YYYY/MM/DD')} ~ ${dayjs(row.periodEnd).format('YYYY/MM/DD')}`,
    },
    {
      title: '部門名稱',
      dataIndex: 'departmentName',
      key: 'departmentName',
      render: (value?: string | null) => value || '未分配',
    },
    {
      title: '職員編碼',
      dataIndex: 'employeeNo',
      key: 'employeeNo',
    },
    {
      title: '職員姓名',
      dataIndex: 'employeeName',
      key: 'employeeName',
    },
    {
      title: '支付總額',
      dataIndex: 'grossAmount',
      key: 'grossAmount',
      align: 'right' as const,
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: '扣除總額',
      dataIndex: 'deductionAmount',
      key: 'deductionAmount',
      align: 'right' as const,
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: '實支付額',
      dataIndex: 'netAmount',
      key: 'netAmount',
      align: 'right' as const,
      render: (value: number) => value.toLocaleString(),
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
      title: '列印',
      key: 'print',
      render: (_: unknown, row: PayrollEmployeeSalaryRow) => (
        <Button type="link" icon={<PrinterOutlined />} onClick={() => handleDownloadEmployeePayslipPdf(row)}>
          列印
        </Button>
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
    {
      title: '處理',
      key: 'actions',
      width: 180,
      render: (_: unknown, issue: PayrollRunPrecheckIssue) => (
        <Space wrap>
          <Button
            size="small"
            icon={<ClockCircleOutlined />}
            onClick={() => openAttendanceAdjustModal(issue)}
          >
            補打卡
          </Button>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => void openLeaveBackfillModal(issue)}
          >
            補假
          </Button>
        </Space>
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

  const selectedItemSummary = useMemo(() => {
    const summary = new Map<string, { label: string; amount: number; count: number }>()

    for (const item of selectedRun?.items ?? []) {
      const label = payrollItemLabelMap[item.type] || item.type
      const current = summary.get(item.type) ?? { label, amount: 0, count: 0 }
      current.amount += Number(item.amountBase ?? 0)
      current.count += 1
      summary.set(item.type, current)
    }

    return Array.from(summary.entries()).map(([type, value]) => ({
      type,
      ...value,
    }))
  }, [selectedRun])

  const selectedPositiveTotal = useMemo(
    () =>
      (selectedRun?.items ?? [])
        .filter((item) => Number(item.amountBase ?? 0) > 0)
        .reduce((sum, item) => sum + Number(item.amountBase ?? 0), 0),
    [selectedRun],
  )

  const selectedDeductionTotal = useMemo(
    () =>
      Math.abs(
        (selectedRun?.items ?? [])
          .filter((item) => Number(item.amountBase ?? 0) < 0)
          .reduce((sum, item) => sum + Number(item.amountBase ?? 0), 0),
      ),
    [selectedRun],
  )

  const selectedStatusMeta = selectedRun
    ? statusMetaMap[selectedRun.status] ?? { label: selectedRun.status, color: 'default' }
    : null

  const adminPanel = (
    <div className="space-y-8">
      <Row gutter={16}>
        <Col span={8}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="本月薪資實發總額"
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
              title="待確認薪資人數"
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
          scroll={{ x: 1100 }}
        />
      </Card>
    </div>
  )

  const employeeSalaryPanel = (
    <div className="space-y-8">
      <Alert
        type="info"
        showIcon
        message="管理員可以依資料權限查詢職員薪資"
        description="列表會依薪資批次拆成每位員工一列，方便核對支付總額、扣除總額與實支付額；列印會下載該員工該期薪資單。"
      />
      <Card className="glass-card" bordered={false}>
        <Table
          rowKey="id"
          loading={loadingEmployeeSalaries}
          columns={employeeSalaryColumns}
          dataSource={employeeSalaryRows}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1280 }}
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
        { key: 'admin', label: '月薪資台帳', children: adminPanel },
        { key: 'employee-salaries', label: '查詢職員薪資', children: employeeSalaryPanel },
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
            {canReviewPayroll ? '每月薪資結算、確定、會計憑證與個人薪資查詢' : '查看個人薪資單與每期薪資明細'}
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
        title={detailScope === 'admin' ? '本月薪資總覽' : '我的薪資單'}
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
                    {dayjs(selectedRun.periodEnd).format('YYYYMM')}薪資
                  </div>
                  <Text type="secondary">
                    計薪期間 {dayjs(selectedRun.periodStart).format('YYYY-MM-DD')} ~ {dayjs(selectedRun.periodEnd).format('YYYY-MM-DD')} · 發薪日 {dayjs(selectedRun.payDate).format('YYYY-MM-DD')}
                  </Text>
                </div>
                {selectedStatusMeta ? <Tag color={selectedStatusMeta.color}>{selectedStatusMeta.label}</Tag> : null}
              </div>

              <Row gutter={16} className="mt-4">
                <Col span={8}>
                  <Statistic title={detailScope === 'admin' ? '實發總額' : '實發金額'} value={selectedRun.totalAmount ?? 0} prefix="$" precision={0} />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={detailScope === 'admin' ? '涉及員工' : '薪資項目'}
                    value={detailScope === 'admin' ? selectedRun.employeeCount ?? 0 : selectedRun.items?.length ?? 0}
                    suffix={detailScope === 'admin' ? '人' : '項'}
                  />
                </Col>
                <Col span={8}>
                  <Statistic title="扣除總額" value={selectedDeductionTotal} prefix="$" precision={0} />
                </Col>
              </Row>
              {detailScope === 'admin' ? (
                <Row gutter={16} className="mt-4">
                  <Col span={8}>
                    <Statistic title="應發總額" value={selectedPositiveTotal} prefix="$" precision={0} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="建立日期" value={selectedRun.createdAt ? dayjs(selectedRun.createdAt).format('YYYY-MM-DD') : '—'} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="薪資項目數" value={selectedRun.items?.length ?? 0} suffix="項" />
                  </Col>
                </Row>
              ) : null}

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
                  {detailScope === 'admin' ? '員工薪資明細' : '薪資單明細'}
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
                    確定薪資
                  </Button>
                ) : null}
                {canManagePayroll && detailScope === 'admin' && selectedRun.status === 'approved' ? (
                  <Space>
                    <Button
                      danger
                      icon={<RollbackOutlined />}
                      loading={actionLoadingId === selectedRun.id}
                      onClick={() => handleUnapproveRun(selectedRun.id)}
                    >
                      取消確定
                    </Button>
                    <Button
                      type="primary"
                      loading={actionLoadingId === selectedRun.id}
                      onClick={() => handlePostRun(selectedRun.id)}
                    >
                      新增會計憑證
                    </Button>
                  </Space>
                ) : null}
                {canManagePayroll && detailScope === 'admin' && selectedRun.status === 'posted' ? (
                  <Button
                    type="primary"
                    loading={actionLoadingId === selectedRun.id}
                    onClick={() => openPayModal(selectedRun)}
                  >
                    建立付款憑證並發薪
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
                <div className="mb-4 font-semibold text-slate-800">項目彙總</div>
                {selectedItemSummary.length === 0 ? (
                  <div className="text-sm text-slate-400">目前尚無薪資項目。</div>
                ) : (
                  <Table
                    rowKey="type"
                    size="small"
                    pagination={false}
                    dataSource={selectedItemSummary}
                    columns={[
                      {
                        title: '薪資項目',
                        dataIndex: 'label',
                        key: 'label',
                      },
                      {
                        title: '筆數',
                        dataIndex: 'count',
                        key: 'count',
                        render: (count: number) => `${count} 筆`,
                      },
                      {
                        title: '金額',
                        dataIndex: 'amount',
                        key: 'amount',
                        align: 'right',
                        render: (amount: number) => `$${amount.toLocaleString()}`,
                      },
                    ]}
                  />
                )}
              </GlassDrawerSection>
            ) : null}

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
                          : log.action === 'UNAPPROVE'
                            ? 'red'
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
              description={`已檢查 ${precheckResult.employeesChecked} 位員工。系統已自動排除週末、特殊統一放假宣告，以及已送出／已核准的請假紀錄。確認後可直接在處理欄補打卡或補假，再決定是否繼續結算。`}
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
        title="補登／調整打卡時間"
        open={attendanceAdjustOpen}
        onCancel={() => {
          setAttendanceAdjustOpen(false)
          setSelectedPrecheckIssue(null)
          attendanceAdjustForm.resetFields()
        }}
        onOk={() => void handleAttendanceAdjust()}
        okText="儲存出勤時間"
        cancelText="取消"
        confirmLoading={attendanceAdjustLoading}
      >
        {selectedPrecheckIssue ? (
          <div className="space-y-4">
            <Alert
              type="info"
              showIcon
              message={`${selectedPrecheckIssue.employeeName} (${selectedPrecheckIssue.employeeNo}) · ${dayjs(selectedPrecheckIssue.workDate).format('YYYY-MM-DD')}`}
              description="可補上缺少的上班或下班時間；儲存後系統會重新計算當日工時，並更新薪資結算前檢查。"
            />
            <Form form={attendanceAdjustForm} layout="vertical">
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="clockInTime" label="上班時間">
                    <TimePicker className="w-full" format="HH:mm" minuteStep={5} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="clockOutTime" label="下班時間">
                    <TimePicker className="w-full" format="HH:mm" minuteStep={5} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="breakMinutes" label="休息分鐘" rules={[{ required: true, message: '請輸入休息分鐘' }]}>
                <InputNumber className="w-full" min={0} step={5} />
              </Form.Item>
              <Form.Item name="note" label="備註">
                <Input.TextArea rows={3} placeholder="例如：員工確認忘記打卡，由管理員補登" />
              </Form.Item>
            </Form>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="補登員工請假"
        open={leaveBackfillOpen}
        onCancel={() => {
          setLeaveBackfillOpen(false)
          setSelectedPrecheckIssue(null)
          leaveBackfillForm.resetFields()
        }}
        onOk={() => void handleLeaveBackfill()}
        okText="建立並核准假單"
        cancelText="取消"
        confirmLoading={leaveBackfillLoading}
      >
        {selectedPrecheckIssue ? (
          <div className="space-y-4">
            <Alert
              type="info"
              showIcon
              message={`${selectedPrecheckIssue.employeeName} (${selectedPrecheckIssue.employeeNo}) · ${dayjs(selectedPrecheckIssue.workDate).format('YYYY-MM-DD')}`}
              description="補假會建立正式假單並直接核准，薪資計算會依假別的支薪比例處理。"
            />
            <Form form={leaveBackfillForm} layout="vertical">
              <Form.Item name="leaveTypeId" label="假別" rules={[{ required: true, message: '請選擇假別' }]}>
                <Select
                  placeholder="選擇假別"
                  options={leaveTypes.map((type) => ({
                    value: type.id,
                    label: `${type.name}${typeof type.paidPercentage === 'number' ? ` · 支薪 ${type.paidPercentage}%` : ''}`,
                  }))}
                />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="startTime" label="開始時間" rules={[{ required: true, message: '請選擇開始時間' }]}>
                    <TimePicker className="w-full" format="HH:mm" minuteStep={5} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="endTime" label="結束時間" rules={[{ required: true, message: '請選擇結束時間' }]}>
                    <TimePicker className="w-full" format="HH:mm" minuteStep={5} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="hours" label="請假時數" rules={[{ required: true, message: '請輸入請假時數' }]}>
                <InputNumber className="w-full" min={0.5} step={0.5} />
              </Form.Item>
              <Form.Item name="reason" label="原因">
                <Input.TextArea rows={3} placeholder="例如：員工確認當日為請假，原先漏送假單" />
              </Form.Item>
            </Form>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="建立薪資付款憑證"
        open={payModalOpen}
        onCancel={() => {
          setPayModalOpen(false)
          payForm.resetFields()
        }}
        onOk={handlePayRun}
        okText="建立付款憑證"
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
            系統會同步建立薪資付款會計憑證，借記應付薪資、貸記銀行存款。
          </Text>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default PayrollPage
