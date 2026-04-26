import React, { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AuditOutlined,
  BankOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  ExceptionOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs, { Dayjs } from 'dayjs'
import * as XLSX from 'xlsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  dashboardService,
  DataCompletenessAudit,
  DataCompletenessAuditBlocker,
  DataCompletenessChannelBreakdown,
  DashboardExecutiveAnomaly,
  DashboardExecutiveOverview,
  DashboardReconciliationBatch,
  DashboardReconciliationFeed,
  DashboardReconciliationItem,
  OrderReconciliationAudit,
  OrderReconciliationAuditItem,
} from '../services/dashboard.service'
import {
  arService,
  B2BStatementCustomer,
  B2BStatementResponse,
  ReceivableClassificationGroup,
  ReceivableMonitorResponse,
  ReceivableMonitorItem,
} from '../services/ar.service'
import { salesService } from '../services/sales.service'
import { apService } from '../services/ap.service'
import { reconciliationService } from '../services/reconciliation.service'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

type WorkbenchRange = [Dayjs, Dayjs] | null

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

const ECPAY_MERCHANT_OPTIONS = [
  { label: '3290494 · MOZTECH 官方網站 / Shopify', value: '3290494' },
  { label: '3150241 · 萬魔未來工學院 / 團購 / 1Shop', value: '3150241' },
]

const money = (value?: number | null) =>
  `NT$ ${Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`

const pct = (value?: number | null) => `${Number(value || 0).toFixed(1)}%`

const statusTone = (tone?: string) => {
  if (tone === 'critical') return 'red'
  if (tone === 'warning') return 'gold'
  if (tone === 'attention') return 'blue'
  return 'green'
}

const settlementMeta = (item: DashboardReconciliationItem) => {
  if (item.settlementStatus === 'reconciled') return { color: 'green' as const, label: '已對帳' }
  if (item.settlementStatus === 'pending_payout') return { color: 'gold' as const, label: '待撥款' }
  if (item.settlementStatus === 'failed') return { color: 'red' as const, label: '失敗 / 退款' }
  return { color: 'blue' as const, label: '待付款' }
}

const feeMeta = (status?: string) => {
  if (status === 'actual') return { color: 'green' as const, label: '實際費用' }
  if (status === 'estimated') return { color: 'gold' as const, label: '預估費用' }
  if (status === 'unavailable') return { color: 'red' as const, label: '來源不可得' }
  return { color: 'default' as const, label: '待補費用' }
}

const auditMeta = (severity: OrderReconciliationAuditItem['severity']) => {
  if (severity === 'critical') return { color: 'red' as const, label: '高風險' }
  if (severity === 'warning') return { color: 'gold' as const, label: '需追蹤' }
  return { color: 'green' as const, label: '正常' }
}

const riskMeta = (risk?: string) => {
  if (risk === 'critical') return { color: 'red' as const, label: '高風險' }
  if (risk === 'warning') return { color: 'gold' as const, label: '逾期追蹤' }
  if (risk === 'attention') return { color: 'blue' as const, label: '待出帳' }
  return { color: 'green' as const, label: '正常' }
}

const AccountingWorkbenchPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [feeImportForm] = Form.useForm()
  const [issuedInvoiceImportForm] = Form.useForm()
  // 預設 90 天，確保能看到歷史資料；null = 全部（不過濾日期）
  const [dateRange, setDateRange] = useState<WorkbenchRange>([
    dayjs().subtract(89, 'day').startOf('day'),
    dayjs().endOf('day'),
  ])
  const [loading, setLoading] = useState(false)
  const [syncingAr, setSyncingAr] = useState(false)
  const [syncingInvoiceStatus, setSyncingInvoiceStatus] = useState(false)
  const [feeImportOpen, setFeeImportOpen] = useState(false)
  const [importingFeeInvoices, setImportingFeeInvoices] = useState(false)
  const [importingLinePayCapture, setImportingLinePayCapture] = useState(false)
  const [importingEcpayPayout, setImportingEcpayPayout] = useState(false)
  const [importingEcpayIssuedInvoices, setImportingEcpayIssuedInvoices] = useState(false)
  const [issuedInvoiceImportOpen, setIssuedInvoiceImportOpen] = useState(false)
  const [issuedInvoiceImportFile, setIssuedInvoiceImportFile] = useState<File | null>(null)
  const [backfillingOneShopClosure, setBackfillingOneShopClosure] = useState(false)
  const [refreshingLinePayStatuses, setRefreshingLinePayStatuses] = useState(false)
  const [processingLinePayRefunds, setProcessingLinePayRefunds] = useState(false)
  const [runningLinePayClosurePass, setRunningLinePayClosurePass] = useState(false)
  const [executive, setExecutive] = useState<DashboardExecutiveOverview | null>(null)
  const [feed, setFeed] = useState<DashboardReconciliationFeed | null>(null)
  const [audit, setAudit] = useState<OrderReconciliationAudit | null>(null)
  const [receivables, setReceivables] = useState<ReceivableMonitorResponse | null>(null)
  const [b2bStatements, setB2BStatements] = useState<B2BStatementResponse | null>(null)
  const [dataCompleteness, setDataCompleteness] = useState<DataCompletenessAudit | null>(null)
  const [loadIssues, setLoadIssues] = useState<string[]>([])

  const entityId = localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
  // null = 不傳日期給 API → 後端回傳所有資料
  const startDate = dateRange?.[0]?.startOf('day')?.toISOString()
  const endDate = dateRange?.[1]?.endOf('day')?.toISOString()

  const fetchWorkbench = async () => {
    setLoading(true)
    try {
      const sections = await Promise.allSettled([
        dashboardService.getExecutiveOverview({ entityId, startDate, endDate }),
        dashboardService.getReconciliationFeed({ entityId, startDate, endDate, limit: 24 }),
        dashboardService.getOrderReconciliationAudit({ entityId, startDate, endDate, limit: 80 }),
        arService.getReceivableMonitor({ entityId, startDate, endDate }),
        arService.getB2BStatements({ entityId, startDate, asOfDate: endDate }),
        dashboardService.getDataCompletenessAudit({ entityId, startDate, endDate }),
      ])

      const failedSections: string[] = []

      const [
        executiveResult,
        feedResult,
        auditResult,
        receivableResult,
        b2bResult,
        completenessResult,
      ] = sections

      if (executiveResult.status === 'fulfilled') {
        setExecutive(executiveResult.value)
      } else {
        failedSections.push('閉環總覽')
      }

      if (feedResult.status === 'fulfilled') {
        setFeed(feedResult.value)
      } else {
        failedSections.push('對帳動態')
      }

      if (auditResult.status === 'fulfilled') {
        setAudit(auditResult.value)
      } else {
        failedSections.push('逐筆稽核')
      }

      if (receivableResult.status === 'fulfilled') {
        setReceivables(receivableResult.value)
      } else {
        failedSections.push('應收追蹤')
      }

      if (b2bResult.status === 'fulfilled') {
        setB2BStatements(b2bResult.value)
      } else {
        failedSections.push('B2B 月結')
      }

      if (completenessResult.status === 'fulfilled') {
        setDataCompleteness(completenessResult.value)
      } else {
        failedSections.push('資料完整度')
      }

      setLoadIssues(failedSections)
      if (failedSections.length) {
        message.warning(`部分區塊讀取失敗：${failedSections.join('、')}`)
      }
    } catch (error: any) {
      setLoadIssues(['整體讀取'])
      message.error(error?.response?.data?.message || '讀取會計工作台失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkbench()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange?.[0]?.valueOf(), dateRange?.[1]?.valueOf()])

  const handleSyncAr = async () => {
    setSyncingAr(true)
    try {
      const result = await arService.syncSalesOrders(entityId)
      message.success(`應收同步完成：新增 ${result.created || 0} 筆，更新 ${result.updated || 0} 筆`)
      await fetchWorkbench()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '同步應收失敗')
    } finally {
      setSyncingAr(false)
    }
  }

  const handleSyncInvoiceStatuses = async () => {
    setSyncingInvoiceStatus(true)
    try {
      const result = await salesService.syncInvoiceStatusBatch({
        entityId,
        startDate,
        endDate,
        limit: 120,
      })
      message.success(
        `發票狀態同步完成：成功 ${result.synced || 0} 筆，略過 ${result.skipped || 0} 筆，失敗 ${result.failed || 0} 筆`,
      )
      await fetchWorkbench()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '同步發票狀態失敗')
    } finally {
      setSyncingInvoiceStatus(false)
    }
  }

  const openFeeImportModal = () => {
    feeImportForm.setFieldsValue({
      merchantId: '3290494',
      verifyIssuedStatus: true,
      autoOffsetByMatchedFees: true,
      records: [
        {
          invoiceStatus: 'issued',
          serviceType: 'gateway_fee',
          amountCurrency: 'TWD',
        },
      ],
    })
    setFeeImportOpen(true)
  }

  const handleImportFeeInvoices = async () => {
    try {
      const values = await feeImportForm.validateFields()
      setImportingFeeInvoices(true)
      const records = (values.records || []).map((record: any) => ({
        invoiceNo: record.invoiceNo,
        invoiceDate: record.invoiceDate?.format('YYYY-MM-DD'),
        amountOriginal: Number(record.amountOriginal || 0),
        amountCurrency: record.amountCurrency || 'TWD',
        serviceType: record.serviceType || 'gateway_fee',
        invoiceStatus: record.invoiceStatus || 'issued',
        taxAmount: record.taxAmount !== undefined ? Number(record.taxAmount) : undefined,
        relateNumber: record.relateNumber || undefined,
        note: record.note || undefined,
      }))

      const result = await apService.importEcpayServiceFeeInvoices({
        entityId,
        merchantId: values.merchantId,
        vendorName: values.vendorName || '綠界科技',
        verifyIssuedStatus: values.verifyIssuedStatus,
        autoOffsetByMatchedFees: values.autoOffsetByMatchedFees,
        records,
      })

      message.success(
        `綠界服務費發票匯入完成：新增 ${result.created || 0} 筆，更新 ${result.updated || 0} 筆，驗證 ${result.verifiedCount || 0} 筆`,
      )
      setFeeImportOpen(false)
      await fetchWorkbench()
    } catch (error: any) {
      if (error?.errorFields) return
      message.error(error?.response?.data?.message || '匯入綠界服務費發票失敗')
    } finally {
      setImportingFeeInvoices(false)
    }
  }

  const parseSpreadsheetRows = async (file: File) =>
    new Promise<Record<string, string | number | boolean | null>[]>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const workbook = XLSX.read(reader.result, { type: 'array', cellDates: false })
          const sheetName =
            workbook.SheetNames.find((name) => /invoice|發票|settlement|capture|撥款|請款/i.test(name)) ||
            workbook.SheetNames[0]
          const worksheet = workbook.Sheets[sheetName]
          if (!worksheet) {
            resolve([])
            return
          }
          const rows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean | null>>(worksheet, {
            defval: '',
          })
          resolve(rows)
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(file)
    })

  const openIssuedInvoiceImportModal = () => {
    issuedInvoiceImportForm.setFieldsValue({
      merchantId: '3150241',
      markIssued: true,
    })
    setIssuedInvoiceImportFile(null)
    setIssuedInvoiceImportOpen(true)
  }

  const handleImportLinePayCapture = async (file: File) => {
    setImportingLinePayCapture(true)
    try {
      const rows = await parseSpreadsheetRows(file)
      if (!rows.length) {
        message.warning('這份 LINE Pay CAPTURE 檔沒有可匯入的資料列')
        return
      }

      const result = await reconciliationService.importProviderPayouts({
        entityId,
        provider: 'linepay',
        sourceType: 'statement',
        fileName: file.name,
        rows,
        notes: 'LINE Pay CAPTURE 請款/預計撥款報表',
      })

      message.success(
        `LINE Pay CAPTURE 匯入完成：${result.recordCount} 筆，已匹配 ${result.matchedCount} 筆，待確認 ${result.unmatchedCount} 筆，無效 ${result.invalidCount} 筆`,
      )
      await handleRunLinePayClosurePass()
      await fetchWorkbench()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '匯入 LINE Pay CAPTURE 失敗')
    } finally {
      setImportingLinePayCapture(false)
    }
  }

  const runOneShopClosureAfterImport = async () => {
    const beginDate = dateRange?.[0]
      ? dateRange[0].format('YYYY-MM-DD')
      : dayjs().subtract(365, 'day').format('YYYY-MM-DD')
    const endDate = dateRange?.[1]
      ? dateRange[1].format('YYYY-MM-DD')
      : dayjs().format('YYYY-MM-DD')

    const result = await reconciliationService.backfillOneShopGroupbuyClosure({
      entityId,
      beginDate,
      endDate,
      orderWindowDays: 14,
      payoutWindowDays: 31,
      maxWindows: 18,
      invoiceBatchLimit: 200,
      autoClear: true,
    })

    const groupbuyChannel = result.postAudit?.groupbuyChannel
    if (result.failedSteps.length) {
      message.warning(
        `閉環補跑部分完成，失敗步驟：${result.failedSteps.join('、')}`,
        6,
      )
      return
    }

    if (groupbuyChannel) {
      message.success(
        `閉環已更新：缺 Payment ${groupbuyChannel.missingPayments || 0}、缺發票 ${groupbuyChannel.missingInvoices || 0}、缺手續費 ${groupbuyChannel.feeMissingPayments || 0}`,
        6,
      )
    }
  }

  const handleImportEcpayPayout = async (file: File) => {
    setImportingEcpayPayout(true)
    try {
      const rows = await parseSpreadsheetRows(file)
      if (!rows.length) {
        message.warning('這份綠界撥款報表沒有可匯入的資料列')
        return
      }

      const result = await reconciliationService.importProviderPayouts({
        entityId,
        provider: 'ecpay',
        sourceType: 'statement',
        fileName: file.name,
        rows,
        notes: '綠界撥款 / 對帳報表手動匯入',
      })

      message.success(
        `綠界撥款匯入完成：${result.recordCount} 筆，已匹配 ${result.matchedCount} 筆，待確認 ${result.unmatchedCount} 筆，無效 ${result.invalidCount} 筆`,
      )
      await runOneShopClosureAfterImport()
      await fetchWorkbench()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '匯入綠界撥款報表失敗')
    } finally {
      setImportingEcpayPayout(false)
    }
  }

  const handleImportEcpayIssuedInvoices = async (
    file: File,
    merchantId: string,
    markIssued = true,
  ) => {
    setImportingEcpayIssuedInvoices(true)
    try {
      const rows = await parseSpreadsheetRows(file)
      if (!rows.length) {
        message.warning('這份綠界銷項發票檔沒有可匯入的資料列')
        return
      }

      const normalizedMerchantId = merchantId.trim()
      const merchantKey = normalizedMerchantId === '3290494' ? 'shopify-main' : 'groupbuy-main'
      const result = await salesService.importEcpayIssuedInvoices({
        entityId,
        merchantKey,
        merchantId: normalizedMerchantId,
        markIssued,
        rows,
      })

      message.success(
        `綠界銷項發票匯入完成：已配對 ${result.matched || 0} 筆，新增 ${result.created || 0} 筆，更新 ${result.updated || 0} 筆，未配對 ${result.unmatched || 0} 筆`,
        6,
      )
      if (normalizedMerchantId === '3150241') {
        await runOneShopClosureAfterImport()
      }
      await fetchWorkbench()
      setIssuedInvoiceImportOpen(false)
      setIssuedInvoiceImportFile(null)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '匯入綠界銷項發票失敗')
    } finally {
      setImportingEcpayIssuedInvoices(false)
    }
  }

  const handleConfirmIssuedInvoiceImport = async () => {
    const values = await issuedInvoiceImportForm.validateFields()
    if (!issuedInvoiceImportFile) {
      message.warning('請先選擇綠界銷項發票檔案')
      return
    }

    await handleImportEcpayIssuedInvoices(
      issuedInvoiceImportFile,
      values.merchantId,
      values.markIssued !== false,
    )
  }

  const handleBackfillOneShopClosure = async () => {
    const beginDate = dateRange?.[0]
      ? dateRange[0].format('YYYY-MM-DD')
      : dayjs().subtract(365, 'day').format('YYYY-MM-DD')
    const endDate = dateRange?.[1]
      ? dateRange[1].format('YYYY-MM-DD')
      : dayjs().format('YYYY-MM-DD')

    setBackfillingOneShopClosure(true)
    try {
      const result = await reconciliationService.backfillOneShopGroupbuyClosure({
        entityId,
        beginDate,
        endDate,
        orderWindowDays: 14,
        payoutWindowDays: 31,
        maxWindows: 18,
        invoiceBatchLimit: 200,
        autoClear: true,
      })

      const groupbuyChannel = result.postAudit?.groupbuyChannel
      if (result.failedSteps.length) {
        message.warning(
          `1Shop 團購閉環補跑部分完成，失敗步驟：${result.failedSteps.join('、')}`,
          6,
        )
      } else if (groupbuyChannel) {
        message.success(
          `1Shop 團購閉環補跑完成：缺 Payment ${groupbuyChannel.missingPayments || 0}、缺發票 ${groupbuyChannel.missingInvoices || 0}、缺手續費 ${groupbuyChannel.feeMissingPayments || 0}`,
          6,
        )
      } else {
        message.success('1Shop 團購閉環補跑完成')
      }

      await fetchWorkbench()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '補跑 1Shop 團購閉環失敗')
    } finally {
      setBackfillingOneShopClosure(false)
    }
  }

  const handleRefreshLinePayStatuses = async () => {
    setRefreshingLinePayStatuses(true)
    try {
      const result = await reconciliationService.refreshLinePayStatuses({
        entityId,
        startDate,
        endDate,
        limit: 300,
      })

      if (result.failedCount > 0) {
        message.warning(
          `LINE Pay 狀態刷新完成：成功 ${result.successCount} 筆，失敗 ${result.failedCount} 筆，退款候選 ${result.refundCandidateCount} 筆`,
          6,
        )
      } else {
        message.success(
          `LINE Pay 狀態刷新完成：檢查 ${result.checkedCount} 筆，退款候選 ${result.refundCandidateCount} 筆`,
          6,
        )
      }

      await fetchWorkbench()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '刷新 LINE Pay 狀態失敗')
    } finally {
      setRefreshingLinePayStatuses(false)
    }
  }

  const handleProcessLinePayRefundReversals = async () => {
    setProcessingLinePayRefunds(true)
    try {
      const result = await reconciliationService.processLinePayRefundReversals({
        entityId,
        startDate,
        endDate,
        limit: 300,
      })

      if (result.unmatched > 0) {
        message.warning(
          `LINE Pay 退款沖銷完成：已沖銷 ${result.reversed} 筆，未匹配 ${result.unmatched} 筆，略過 ${result.skipped} 筆`,
          6,
        )
      } else {
        message.success(
          `LINE Pay 退款沖銷完成：已沖銷 ${result.reversed} 筆，略過 ${result.skipped} 筆`,
          6,
        )
      }

      await fetchWorkbench()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '處理 LINE Pay 退款沖銷失敗')
    } finally {
      setProcessingLinePayRefunds(false)
    }
  }

  const handleRunLinePayClosurePass = async () => {
    setRunningLinePayClosurePass(true)
    try {
      const result = await reconciliationService.runLinePayClosurePass({
        entityId,
        startDate,
        endDate,
        limit: 300,
        syncInvoices: true,
        autoClear: true,
      })

      if (result.failedCount > 0) {
        message.warning(
          `LINE Pay 閉環補跑部分完成：退款候選 ${result.linePay.refundCandidateCount} 筆、已沖銷 ${result.linePay.reversedCount} 筆、未匹配 ${result.linePay.unmatchedRefundCount} 筆，失敗步驟 ${result.failedCount} 個`,
          6,
        )
      } else {
        message.success(
          `LINE Pay 閉環補跑完成：檢查 ${result.linePay.checkedCount} 筆、退款候選 ${result.linePay.refundCandidateCount} 筆、已沖銷 ${result.linePay.reversedCount} 筆`,
          6,
        )
      }

      await fetchWorkbench()
      return result
    } catch (error: any) {
      message.error(error?.response?.data?.message || '補跑 LINE Pay 閉環失敗')
      throw error
    } finally {
      setRunningLinePayClosurePass(false)
    }
  }

  const anomalies = executive?.anomalies || []
  const recentItems = feed?.recentItems || []
  const recentBatches = feed?.recentBatches || []
  const auditItems = audit?.items || []
  const arItems = receivables?.items || []
  const arGroups = receivables?.classificationGroups || []
  const arSummary = receivables?.summary
  const b2bSummary = b2bStatements?.summary
  const b2bCustomers = b2bStatements?.customers || []
  const auditSummary = audit?.summary
  const completenessBlockers = dataCompleteness?.blockers || []
  const channelCompleteness = dataCompleteness?.channelBreakdown || []
  const completenessCoverage = dataCompleteness?.coverage
  const auditedOrderCount =
    Number(auditSummary?.auditedOrderCount || 0) ||
    Number(dataCompleteness?.totals.orders || 0)
  const reconciledOrderCount =
    Number(auditSummary?.reconciledOrderCount || 0) ||
    Number(dataCompleteness?.gaps.reconciledPayments || 0)
  const feeIssueCount =
    Number(auditSummary?.feeIssueCount || 0) ||
    Number(dataCompleteness?.gaps.feeMissingPayments || 0)
  const invoiceIssueCount =
    Number(auditSummary?.invoiceIssueCount || 0) ||
    Number(dataCompleteness?.gaps.missingInvoiceOrders || 0)
  const automationCompletion = auditedOrderCount
    ? Math.round((reconciledOrderCount / auditedOrderCount) * 100)
    : 0
  const openAnomalyCount =
    Number(executive?.operations.openAnomalyCount || 0) ||
    Number(auditSummary?.anomalousOrderCount || 0)
  const feeBackfillCount =
    Number(executive?.operations.feeBackfillCount || 0) ||
    Number(dataCompleteness?.gaps.feeMissingPayments || 0)
  const missingPayoutJournalCount =
    Number(executive?.operations.missingPayoutJournalCount || 0) ||
    Number(arSummary?.missingJournalCount || 0)
  const overdueReceivableCount =
    Number(arSummary?.overdueReceivableCount || 0) ||
    Number(b2bSummary?.overdueCustomerCount || 0)
  const salesDataExists =
    Number(dataCompleteness?.totals.orders || 0) > 0 ||
    Number(auditSummary?.auditedOrderCount || 0) > 0 ||
    Number(feed?.recentItems?.length || 0) > 0
  const arNotReady =
    salesDataExists &&
    (!receivables ||
      ((receivables.items?.length || 0) === 0 &&
        Number(receivables.summary?.grossAmount || 0) === 0))
  const invoiceFocusActive = searchParams.get('focus') === 'missing-invoices'
  const initialWorkbenchLoading =
    loading &&
    !executive &&
    !feed &&
    !audit &&
    !receivables &&
    !b2bStatements &&
    !dataCompleteness
  const missingInvoiceOrderCount = Number(dataCompleteness?.gaps.missingInvoiceOrders || 0)
  const invoiceLinkedRate = Number(dataCompleteness?.coverage.invoiceLinkedRate || 0)
  const oneShopMissingInvoices =
    channelCompleteness.find((item) => /1shop|oneshop/i.test(`${item.channelCode} ${item.channelName}`))?.missingInvoices || 0
  const shopifyMissingInvoices =
    channelCompleteness.find((item) => /shopify/i.test(`${item.channelCode} ${item.channelName}`))?.missingInvoices || 0

  const anomalyColumns: ColumnsType<DashboardExecutiveAnomaly> = [
    {
      title: '待辦',
      dataIndex: 'title',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{record.helper}</div>
          {record.accountCode ? (
            <div className="mt-1 text-[11px] text-slate-400">
              科目 {record.accountCode} · {record.accountName}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '狀態',
      width: 120,
      render: (_, record) => <Tag color={statusTone(record.tone)}>{record.statusLabel}</Tag>,
    },
    {
      title: '影響',
      width: 140,
      align: 'right',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.count} 筆</div>
          <div className="text-xs text-slate-400">{record.amount !== null ? money(record.amount) : '待處理'}</div>
        </div>
      ),
    },
  ]

  const paymentColumns: ColumnsType<DashboardReconciliationItem> = [
    {
      title: '訂單 / 通路',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-blue-600">{record.externalOrderId || record.salesOrderId || '未綁定訂單'}</div>
          <div className="text-xs text-slate-400">{record.bucketLabel} · {record.gateway || '未知付款方式'}</div>
        </div>
      ),
    },
    {
      title: '狀態',
      width: 170,
      render: (_, record) => {
        const settlement = settlementMeta(record)
        const fee = feeMeta(record.feeStatus)
        return (
          <Space size={[4, 4]} wrap>
            <Tag color={settlement.color}>{settlement.label}</Tag>
            <Tag color={fee.color}>{fee.label}</Tag>
          </Space>
        )
      },
    },
    {
      title: '金額',
      width: 220,
      align: 'right',
      render: (_, record) => (
        <div className="text-sm">
          <div>總額 {money(record.gross)}</div>
          <div className="text-rose-500">手續費 {money(record.feeTotal)}</div>
          <div className="font-semibold text-emerald-600">淨額 {money(record.net)}</div>
        </div>
      ),
    },
    {
      title: '金流單號',
      width: 170,
      render: (_, record) => (
        <div className="text-xs text-slate-500">
          {record.providerTradeNo || record.providerPaymentId || '待回填'}
        </div>
      ),
    },
  ]

  const batchColumns: ColumnsType<DashboardReconciliationBatch> = [
    {
      title: '批次',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.provider.toUpperCase()} 對帳批次</div>
          <div className="text-xs text-slate-400">
            {dayjs(record.importedAt).format('YYYY/MM/DD HH:mm')} · {record.fileName || '系統同步'}
          </div>
        </div>
      ),
    },
    { title: '匯入', dataIndex: 'recordCount', width: 90, align: 'right' },
    { title: '已匹配', dataIndex: 'matchedCount', width: 90, align: 'right' },
    {
      title: '待處理',
      width: 100,
      align: 'right',
      render: (_, record) => (
        <span className={record.unmatchedCount + record.invalidCount > 0 ? 'font-semibold text-amber-600' : 'text-emerald-600'}>
          {record.unmatchedCount + record.invalidCount}
        </span>
      ),
    },
  ]

  const auditColumns: ColumnsType<OrderReconciliationAuditItem> = [
    {
      title: '訂單',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-blue-600">{record.externalOrderId || record.orderId}</div>
          <div className="text-xs text-slate-400">{record.channelName} · {dayjs(record.orderDate).format('YYYY/MM/DD')}</div>
        </div>
      ),
    },
    {
      title: 'AI 判斷',
      render: (_, record) => {
        const meta = auditMeta(record.severity)
        return (
          <div>
            <Tag color={meta.color}>{meta.label}</Tag>
            <div className="mt-2 flex flex-wrap gap-1">
              {record.anomalyMessages.slice(0, 3).map((item, index) => (
                <Tag key={`${record.orderId}-${index}`} color="red">{item}</Tag>
              ))}
            </div>
          </div>
        )
      },
    },
    {
      title: '核對金額',
      width: 220,
      align: 'right',
      render: (_, record) => (
        <div className="text-sm">
          <div>訂單 / 收款 {money(record.grossAmount)} / {money(record.paymentGrossAmount)}</div>
          <div>手續費 {money(record.feeTotalAmount)} · {record.feeRatePct.toFixed(2)}%</div>
          <div>稅額 {money(record.orderTaxAmount)} / {money(record.invoiceTaxAmount)}</div>
        </div>
      ),
    },
  ]

  const arColumns: ColumnsType<ReceivableMonitorItem> = [
    {
      title: '訂單 / 客戶 / 分類',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-blue-600">{record.orderNumber}</div>
          <div className="text-xs text-slate-400">{record.customerName} · {record.sourceLabel}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Tag color="blue">{record.receivableGroupLabel || '未分類應收'}</Tag>
            <Tag>{record.collectionOwnerLabel || '待確認'}</Tag>
          </div>
        </div>
      ),
    },
    {
      title: '追帳階段',
      width: 180,
      render: (_, record) => (
        <div>
          <Tag color={record.settlementPhase === 'overdue' ? 'red' : record.settlementPhase === 'settled' ? 'green' : 'gold'}>
            {record.settlementPhaseLabel || record.arStatus}
          </Tag>
          <div className="mt-2 text-xs leading-5 text-slate-500">
            {record.settlementDiagnostic || record.feeDiagnostic}
          </div>
        </div>
      ),
    },
    {
      title: '缺口',
      width: 210,
      render: (_, record) => (
        <Space size={[4, 4]} wrap>
          {!record.reconciledFlag ? <Tag color="gold">待對帳</Tag> : <Tag color="green">已對帳</Tag>}
          {record.feeStatus !== 'actual' ? <Tag color="red">手續費待補</Tag> : null}
          {!record.invoiceNumber ? <Tag color="blue">待補發票</Tag> : null}
          {!record.accountingPosted ? <Tag>待入帳</Tag> : null}
        </Space>
      ),
    },
    {
      title: '應收',
      width: 180,
      align: 'right',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{money(record.outstandingAmount)}</div>
          <div className="text-xs text-slate-400">淨額 {money(record.netAmount)}</div>
        </div>
      ),
    },
  ]

  const arGroupColumns: ColumnsType<ReceivableClassificationGroup> = [
    {
      title: '應收分類',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.label}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Tag color="blue">{record.collectionTypeLabel}</Tag>
            <Tag>{record.paymentMethodLabel}</Tag>
            <Tag>{record.collectionOwnerLabel}</Tag>
          </div>
        </div>
      ),
    },
    {
      title: '階段',
      width: 150,
      render: (_, record) => (
        <Tag color={record.settlementPhase === 'overdue' ? 'red' : record.settlementPhase === 'settled' ? 'green' : 'gold'}>
          {record.settlementPhaseLabel}
        </Tag>
      ),
    },
    {
      title: '筆數',
      dataIndex: 'orderCount',
      width: 90,
      align: 'right',
    },
    {
      title: '應收未收',
      width: 150,
      align: 'right',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-rose-600">{money(record.outstandingAmount)}</div>
          {record.overdueAmount > 0 ? (
            <div className="text-xs text-rose-400">逾期 {money(record.overdueAmount)}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: '已收 / 淨額',
      width: 170,
      align: 'right',
      render: (_, record) => (
        <div className="text-sm">
          <div>{money(record.paidAmount)}</div>
          <div className="font-semibold text-emerald-600">{money(record.netAmount)}</div>
        </div>
      ),
    },
    {
      title: '待補',
      width: 180,
      render: (_, record) => (
        <Space size={[4, 4]} wrap>
          {record.missingFeeCount ? <Tag color="red">費用 {record.missingFeeCount}</Tag> : null}
          {record.missingInvoiceCount ? <Tag color="blue">發票 {record.missingInvoiceCount}</Tag> : null}
          {record.missingJournalCount ? <Tag>分錄 {record.missingJournalCount}</Tag> : null}
          {!record.missingFeeCount && !record.missingInvoiceCount && !record.missingJournalCount ? (
            <Tag color="green">完整</Tag>
          ) : null}
        </Space>
      ),
    },
  ]

  const b2bColumns: ColumnsType<B2BStatementCustomer> = [
    {
      title: '客戶 / 對帳單',
      render: (_, record) => {
        const risk = riskMeta(record.riskLevel)
        return (
          <div>
            <div className="font-semibold text-slate-900">{record.customerName}</div>
            <div className="text-xs text-slate-400">
              {record.statementEmail || '未設定對帳單 Email'} · Net {record.paymentTermDays || 30}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Tag color={risk.color}>{risk.label}</Tag>
              <Tag>{record.billingCycle === 'monthly' ? '每月出帳' : record.billingCycle || '月結'}</Tag>
              {record.collectionOwner ? <Tag color="blue">{record.collectionOwner}</Tag> : null}
            </div>
          </div>
        )
      },
    },
    {
      title: '應收狀態',
      width: 210,
      render: (_, record) => (
        <div className="text-sm">
          <div className="font-semibold text-rose-600">未收 {money(record.outstandingAmount)}</div>
          <div className="text-amber-600">逾期 {money(record.overdueAmount)}</div>
          <div className="text-slate-400">開放 {record.openOrderCount} / 全部 {record.orderCount} 筆</div>
        </div>
      ),
    },
    {
      title: '帳齡',
      width: 260,
      render: (_, record) => (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>未到期 {money(record.currentAmount)}</span>
          <span>1-30 {money(record.due1To30Amount)}</span>
          <span>31-60 {money(record.due31To60Amount)}</span>
          <span>61-90 {money(record.due61To90Amount)}</span>
          <span className="text-rose-500">90+ {money(record.dueOver90Amount)}</span>
          <span>額度 {money(record.creditLimit)}</span>
        </div>
      ),
    },
    {
      title: '待補',
      width: 180,
      render: (_, record) => (
        <Space size={[4, 4]} wrap>
          {record.missingInvoiceCount ? <Tag color="blue">發票 {record.missingInvoiceCount}</Tag> : null}
          {record.missingJournalCount ? <Tag>分錄 {record.missingJournalCount}</Tag> : null}
          {record.missingFeeCount ? <Tag color="red">費用 {record.missingFeeCount}</Tag> : null}
          {!record.missingInvoiceCount && !record.missingJournalCount && !record.missingFeeCount ? (
            <Tag color="green">完整</Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '建議動作',
      render: (_, record) => (
        <div>
          <div className="text-sm text-slate-700">{record.recommendedAction}</div>
          <div className="mt-1 text-xs text-slate-400">
            下次出帳 {dayjs(record.nextStatementDate).format('YYYY/MM/DD')}
          </div>
        </div>
      ),
    },
  ]

  const blockerColumns: ColumnsType<DataCompletenessAuditBlocker> = [
    {
      title: '缺口',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.label}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{record.nextAction}</div>
        </div>
      ),
    },
    {
      title: '狀態',
      width: 110,
      render: (_, record) => <Tag color={statusTone(record.severity)}>{record.severity === 'healthy' ? '正常' : '需處理'}</Tag>,
    },
    {
      title: '筆數',
      dataIndex: 'count',
      width: 100,
      align: 'right',
      render: (value: number) => (
        <span className={value > 0 ? 'font-semibold text-rose-600' : 'text-emerald-600'}>{value}</span>
      ),
    },
  ]

  const channelCompletenessColumns: ColumnsType<DataCompletenessChannelBreakdown> = [
    {
      title: '通路',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.channelName}</div>
          <div className="text-xs text-slate-400">{record.channelCode}</div>
          <div className="mt-1 text-[11px] text-slate-400">
            {record.firstOrder?.orderDate ? dayjs(record.firstOrder.orderDate).format('YYYY/MM/DD') : '無資料'}
            {' - '}
            {record.lastOrder?.orderDate ? dayjs(record.lastOrder.orderDate).format('YYYY/MM/DD') : '無資料'}
          </div>
        </div>
      ),
    },
    {
      title: '訂單 / 營收',
      width: 160,
      align: 'right',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.orders.toLocaleString('zh-TW')} 筆</div>
          <div className="text-xs text-slate-400">{money(record.grossAmount)}</div>
        </div>
      ),
    },
    {
      title: '資料缺口',
      width: 260,
      render: (_, record) => (
        <div className="space-y-2">
          <Space size={[4, 4]} wrap>
            {record.missingCustomers ? <Tag color="gold">缺顧客 {record.missingCustomers}</Tag> : null}
            {record.missingPayments ? <Tag color="gold">缺 Payment {record.missingPayments}</Tag> : null}
            {record.missingInvoices ? <Tag color="blue">缺發票 {record.missingInvoices}</Tag> : null}
            {record.feeMissingPayments ? <Tag color="red">缺手續費 {record.feeMissingPayments}</Tag> : null}
            {!record.missingCustomers && !record.missingPayments && !record.missingInvoices && !record.feeMissingPayments ? (
              <Tag color="green">主資料完整</Tag>
            ) : null}
          </Space>
          {record.reasonBreakdown ? (
            <div className="space-y-1 text-[11px] leading-5 text-slate-400">
              {record.reasonBreakdown.missingPaymentPendingCandidates ? (
                <div>
                  待付款 / 待代收 {record.reasonBreakdown.missingPaymentPendingCandidates} 筆，會先補 Payment draft。
                </div>
              ) : null}
              {record.reasonBreakdown.missingInvoiceEmbeddedCandidates ? (
                <div>
                  訂單已帶發票號碼但尚未落正式 Invoice {record.reasonBreakdown.missingInvoiceEmbeddedCandidates} 筆。
                </div>
              ) : null}
              {record.reasonBreakdown.missingInvoiceEcpayBackfillCandidates ? (
                <div>
                  等綠界發票回填 {record.reasonBreakdown.missingInvoiceEcpayBackfillCandidates} 筆。
                </div>
              ) : null}
              {record.reasonBreakdown.feeMissingPayoutBackfillCandidates ? (
                <div>
                  等綠界撥款 / 手續費回填 {record.reasonBreakdown.feeMissingPayoutBackfillCandidates} 筆。
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '核銷進度',
      width: 190,
      render: (_, record) => {
        const percent = record.payments ? Math.round((record.reconciledPayments / record.payments) * 100) : 0
        return (
          <div>
            <Progress percent={percent} size="small" strokeColor="#0f766e" />
            <div className="text-xs text-slate-400">
              已核銷 {record.reconciledPayments} / 未核銷 {record.unreconciledPayments}
            </div>
          </div>
        )
      },
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="page-section-stack p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Title level={2} className="!mb-1 !font-light">會計工作台</Title>
          <Text type="secondary">這裡只處理會計補件、入帳、核銷與月結追蹤；原始訂單與核對狀態不在這頁處理。</Text>
        </div>
        <Space wrap>
          <RangePicker
            value={dateRange}
            onChange={(value) => {
              if (value?.[0] && value?.[1]) setDateRange([value[0], value[1]])
            }}
            allowClear={false}
            presets={[
              { label: '近 7 天', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] },
              { label: '近 30 天', value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] },
              { label: '近 90 天', value: [dayjs().subtract(89, 'day').startOf('day'), dayjs().endOf('day')] },
              { label: '本月', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
              { label: '上月', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
              { label: '今年', value: [dayjs().startOf('year'), dayjs().endOf('year')] },
            ]}
          />
          <Button
            onClick={() => setDateRange(null)}
            type={dateRange === null ? 'primary' : 'default'}
          >
            全部
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchWorkbench}>
            重新整理
          </Button>
        </Space>
      </div>

      <Alert
        showIcon
        type="info"
        className="rounded-3xl !px-6 !py-4 shadow-sm"
        message="頁面分工"
        description="會計工作台只負責補發票、補手續費、建立應收、落分錄與月結追蹤；待撥款、可核銷、已核銷與異常狀態請到對帳中心查看。"
        action={
          <Button type="link" onClick={() => navigate('/reconciliation')}>
            前往對帳中心
          </Button>
        }
      />

      {invoiceFocusActive ? (
        <Alert
          showIcon
          type="warning"
          className="rounded-3xl !px-6 !py-4 shadow-sm"
          message="你現在在缺發票訂單處理區"
          description="先同步發票狀態；若綠界後台已有銷項發票，匯入綠界銷項發票檔；若是 1Shop 團購資料，補跑 1Shop 團購閉環後再回對帳中心確認可核銷狀態。"
          action={
            <Space wrap>
              <Button loading={syncingInvoiceStatus} onClick={handleSyncInvoiceStatuses}>
                同步發票狀態
              </Button>
              <Button type="primary" onClick={() => navigate('/reconciliation')}>
                回對帳中心
              </Button>
            </Space>
          }
        />
      ) : null}

      {initialWorkbenchLoading ? (
        <Alert
          showIcon
          type="info"
          className="rounded-3xl !px-6 !py-4 shadow-sm"
          message="會計工作台資料讀取中"
          description="正式資料量較大，初次載入可能需要十幾秒；讀取完成前先顯示骨架狀態，避免把尚未讀完誤判為 0 筆。"
        />
      ) : null}

      <Card
        className="rounded-3xl border-0 bg-white/75 shadow-sm"
        bodyStyle={{ padding: 28 }}
        loading={initialWorkbenchLoading}
      >
        <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Invoice Handling
            </div>
            <div className="mt-2 text-xl font-semibold text-slate-900">缺發票訂單在這裡處理</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">
              這裡不是報表頁，也不是只看訂單的銷售頁。發票處理順序是：同步既有發票狀態、匯入綠界銷項發票、補跑團購閉環，最後回到對帳中心看是否可核銷。
            </div>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-3 xl:max-w-2xl">
            <Card size="small" className="rounded-2xl bg-amber-50">
              <Statistic title="缺發票訂單" value={missingInvoiceOrderCount} />
              <div className="mt-2 text-xs text-slate-500">目前資料完整度稽核</div>
            </Card>
            <Card size="small" className="rounded-2xl bg-slate-50">
              <Statistic title="發票覆蓋率" value={invoiceLinkedRate} suffix="%" precision={1} />
              <Progress percent={invoiceLinkedRate} size="small" showInfo={false} strokeColor="#f59e0b" />
            </Card>
            <Card size="small" className="rounded-2xl bg-slate-50">
              <Statistic title="1Shop / Shopify 缺口" value={oneShopMissingInvoices + shopifyMissingInvoices} />
              <div className="mt-2 text-xs text-slate-500">
                1Shop {oneShopMissingInvoices} · Shopify {shopifyMissingInvoices}
              </div>
            </Card>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            icon={<SafetyCertificateOutlined />}
            loading={syncingInvoiceStatus}
            onClick={handleSyncInvoiceStatuses}
          >
            同步發票狀態
          </Button>
          <Button
            icon={<UploadOutlined />}
            loading={importingEcpayIssuedInvoices}
            onClick={openIssuedInvoiceImportModal}
          >
            匯入綠界銷項發票
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={backfillingOneShopClosure}
            onClick={handleBackfillOneShopClosure}
          >
            補跑 1Shop 團購閉環
          </Button>
          <Button onClick={() => navigate('/sales/orders')}>
            查看原始訂單
          </Button>
          <Button onClick={() => navigate('/reconciliation')}>
            查看核銷狀態
          </Button>
        </div>
      </Card>

      <Card
        className="overflow-hidden rounded-3xl border-0 shadow-sm"
        bodyStyle={{ padding: 0 }}
        loading={initialWorkbenchLoading}
      >
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="bg-[linear-gradient(135deg,#0f172a,#1e293b,#0f766e)] px-7 py-7 text-white">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-white/55">
              Accounting Control Room
            </div>
            <div className="mt-3 text-4xl font-semibold">自動對帳閉環</div>
            <div className="mt-3 max-w-3xl text-sm leading-6 text-white/72">
              系統先自動比對；只有缺綠界撥款、缺手續費、未開票、金額不一致或尚未產生分錄時，才會留在這裡讓會計處理。
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <div className="text-xs text-white/50">開放異常</div>
                <div className="mt-2 text-2xl font-semibold">{openAnomalyCount}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <div className="text-xs text-white/50">待補費率</div>
                <div className="mt-2 text-2xl font-semibold">{feeBackfillCount}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <div className="text-xs text-white/50">已對帳未落帳</div>
                <div className="mt-2 text-2xl font-semibold">{missingPayoutJournalCount}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <div className="text-xs text-white/50">逾期應收</div>
                <div className="mt-2 text-2xl font-semibold">{overdueReceivableCount}</div>
              </div>
            </div>
          </div>
          <div className="bg-white/70 px-7 py-7">
            <div className="flex items-center gap-3">
              <SafetyCertificateOutlined className="text-2xl text-emerald-600" />
              <div>
                <div className="text-sm font-semibold text-slate-900">自動核銷完成度</div>
                <div className="text-xs text-slate-400">以目前稽核區間已對帳訂單計算</div>
              </div>
            </div>
            <Progress
              percent={automationCompletion}
              strokeColor={{ '0%': '#0f766e', '100%': '#22c55e' }}
              className="mt-6"
            />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Statistic title="已稽核" value={auditedOrderCount} />
              <Statistic title="已對帳" value={reconciledOrderCount} />
              <Statistic title="手續費異常" value={feeIssueCount} />
              <Statistic title="發票異常" value={invoiceIssueCount} />
            </div>
          </div>
        </div>
      </Card>

      <div className="pt-2">
        <Alert
          showIcon
          type="info"
          className="rounded-3xl !px-7 !py-5 shadow-sm"
          message={<span className="text-base font-semibold">自動判斷規則</span>}
          description="平台手續費優先吃平台 API；金流手續費以綠界撥款/對帳資料為最終依據。抓不到時不亂估，而是標記待補並進入會計工作台。"
        />
      </div>

      {loadIssues.length ? (
        <Alert
          showIcon
          type="warning"
          className="rounded-3xl !px-7 !py-5 shadow-sm"
          message={<span className="text-base font-semibold">部分區塊這次沒有讀取成功</span>}
          description={`目前失敗區塊：${loadIssues.join('、')}。頁面其餘區塊仍會先顯示已成功讀到的資料。`}
        />
      ) : null}

      {arNotReady ? (
        <Alert
          showIcon
          type="warning"
          className="rounded-3xl !px-7 !py-5 shadow-sm"
          message={<span className="text-base font-semibold">銷售資料已進來，但 AR 應收閉環還沒建立</span>}
          description="目前訂單、付款與撥款資料已存在，但應收帳款 / 入帳追蹤尚未同步成 AR；先執行「同步銷售到 AR」，這頁的應收、逾期、核銷與月結指標才會完整顯示。"
          action={
            <Button
              type="primary"
              icon={<ClockCircleOutlined />}
              loading={syncingAr}
              onClick={handleSyncAr}
              className="bg-slate-950 hover:!bg-slate-800"
            >
              同步銷售到 AR
            </Button>
          }
        />
      ) : null}

      <Card
        className="rounded-3xl border-0 bg-white/75 shadow-sm"
        bodyStyle={{ padding: 28 }}
        loading={initialWorkbenchLoading}
      >
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Data Completeness Radar
            </div>
            <div className="mt-2 text-xl font-semibold text-slate-900">資料完整度稽核</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">
              這裡回答「到底缺什麼才不能自動對帳」：顧客、Payment、發票、撥款列、銀行入帳與實際手續費會集中檢查。
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {dataCompleteness?.historicalData.needsShopifyReadAllOrdersCheck ? (
                <Tag color="gold">Shopify 舊單需確認 read_all_orders</Tag>
              ) : null}
              {dataCompleteness?.historicalData.needsOneShopPre2025Backfill ? (
                <Tag color="blue">1Shop 2024 以前需回補</Tag>
              ) : null}
              {dataCompleteness?.historicalData.needsShoplineArchivedOrdersFlow ? (
                <Tag color="purple">Shopline 兩年以上需 archived export</Tag>
              ) : null}
              {dataCompleteness?.gaps.linePayCandidatePayments ? (
                <Tag color="orange">LINE Pay 候選 {dataCompleteness.gaps.linePayCandidatePayments} 筆</Tag>
              ) : null}
            </div>
          </div>
          <div className="grid min-w-[min(100%,720px)] gap-4 md:grid-cols-4">
            <Card size="small" className="rounded-2xl bg-slate-50">
              <Statistic title="顧客連結率" value={completenessCoverage?.customerLinkedRate || 0} suffix="%" precision={1} />
              <Progress percent={completenessCoverage?.customerLinkedRate || 0} size="small" showInfo={false} strokeColor="#10b981" />
            </Card>
            <Card size="small" className="rounded-2xl bg-slate-50">
              <Statistic title="Payment 連結率" value={completenessCoverage?.paymentLinkedRate || 0} suffix="%" precision={1} />
              <Progress percent={completenessCoverage?.paymentLinkedRate || 0} size="small" showInfo={false} strokeColor="#2563eb" />
            </Card>
            <Card size="small" className="rounded-2xl bg-slate-50">
              <Statistic title="發票覆蓋率" value={completenessCoverage?.invoiceLinkedRate || 0} suffix="%" precision={1} />
              <Progress percent={completenessCoverage?.invoiceLinkedRate || 0} size="small" showInfo={false} strokeColor="#f59e0b" />
            </Card>
            <Card size="small" className="rounded-2xl bg-slate-50">
              <Statistic title="實際手續費率" value={completenessCoverage?.feeActualRate || 0} suffix="%" precision={1} />
              <Progress percent={completenessCoverage?.feeActualRate || 0} size="small" showInfo={false} strokeColor="#e11d48" />
            </Card>
          </div>
        </div>
      </Card>

      <Card className="rounded-3xl border-0 bg-white/65 shadow-sm" bodyStyle={{ padding: 28 }}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Action Rail
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              把警示往核銷推進
            </div>
            <div className="mt-1 text-sm text-slate-500">
              這裡只處理會計補件與入帳推進；待撥款、可核銷與異常判斷請回對帳中心查看。
            </div>
          </div>
          <Space wrap>
            <Button
              type="primary"
              icon={<ClockCircleOutlined />}
              loading={syncingAr}
              onClick={handleSyncAr}
              className="bg-slate-950 hover:!bg-slate-800"
            >
              同步銷售到 AR
            </Button>
            <Button
              icon={<SafetyCertificateOutlined />}
              loading={syncingInvoiceStatus}
              onClick={handleSyncInvoiceStatuses}
            >
              同步發票狀態
            </Button>
            <Button
              icon={<BankOutlined />}
              onClick={openFeeImportModal}
            >
              匯入綠界服務費發票
            </Button>
            <Upload
              accept=".xlsx,.xls,.csv"
              showUploadList={false}
              beforeUpload={(file) => {
                void handleImportEcpayPayout(file)
                return false
              }}
            >
              <Button
                icon={<UploadOutlined />}
                loading={importingEcpayPayout}
              >
                匯入綠界撥款報表
              </Button>
            </Upload>
            <Button
              icon={<UploadOutlined />}
              loading={importingEcpayIssuedInvoices}
              onClick={openIssuedInvoiceImportModal}
            >
              匯入綠界銷項發票
            </Button>
            <Upload
              accept=".xlsx,.xls,.csv"
              showUploadList={false}
              beforeUpload={(file) => {
                void handleImportLinePayCapture(file)
                return false
              }}
            >
              <Button
                icon={<UploadOutlined />}
                loading={importingLinePayCapture}
              >
                匯入 LINE Pay CAPTURE
              </Button>
            </Upload>
            <Button
              icon={<ReloadOutlined />}
              loading={refreshingLinePayStatuses}
              onClick={handleRefreshLinePayStatuses}
            >
              刷新 LINE Pay 狀態
            </Button>
            <Button
              icon={<CheckCircleOutlined />}
              loading={runningLinePayClosurePass}
              onClick={handleRunLinePayClosurePass}
            >
              補跑 LINE Pay 閉環
            </Button>
            <Button
              icon={<CheckCircleOutlined />}
              loading={processingLinePayRefunds}
              onClick={handleProcessLinePayRefundReversals}
            >
              處理 LINE Pay 退款沖銷
            </Button>
            <Button
              icon={<CheckCircleOutlined />}
              onClick={() => navigate('/ap/payable?tab=ecpay-fees')}
            >
              處理綠界服務費 AP
            </Button>
            <Button
              icon={<ReloadOutlined />}
              loading={backfillingOneShopClosure}
              onClick={handleBackfillOneShopClosure}
            >
              補跑 1Shop 團購閉環
            </Button>
            <Button
              icon={<AuditOutlined />}
              onClick={() => navigate('/reports')}
            >
              查看報表稽核
            </Button>
          </Space>
        </div>
      </Card>

      <Tabs
        items={[
          {
            key: 'data-completeness',
            label: (
              <span><SafetyCertificateOutlined /> 資料完整度</span>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col span={24}>
                  <div className="grid gap-3 md:grid-cols-4">
                    <Card><Statistic title="全區間訂單" value={dataCompleteness?.totals.orders || 0} /></Card>
                    <Card><Statistic title="缺發票訂單" value={dataCompleteness?.gaps.missingInvoiceOrders || 0} /></Card>
                    <Card><Statistic title="未核銷 Payment" value={dataCompleteness?.gaps.pendingPayments || 0} /></Card>
                    <Card><Statistic title="撥款列匹配率" value={pct(dataCompleteness?.coverage.payoutLineMatchedRate)} /></Card>
                  </div>
                </Col>
                <Col span={24}>
                  <Alert
                    showIcon
                    type={dataCompleteness?.blockers.some((item) => item.severity === 'critical' && item.count > 0) ? 'warning' : 'success'}
                    message="目前核對結論"
                    description={
                      dataCompleteness
                        ? `顧客連結 ${pct(dataCompleteness.coverage.customerLinkedRate)}，Payment 連結 ${pct(dataCompleteness.coverage.paymentLinkedRate)}，發票覆蓋 ${pct(dataCompleteness.coverage.invoiceLinkedRate)}，實際手續費覆蓋 ${pct(dataCompleteness.coverage.feeActualRate)}。`
                        : '尚未取得資料完整度稽核。'
                    }
                  />
                </Col>
                <Col xs={24} xl={10}>
                  <Card
                    title="阻塞自動對帳的缺口"
                    className="h-full rounded-3xl border-0 bg-white/70 shadow-sm"
                  >
                    <Table
                      rowKey="key"
                      loading={loading}
                      columns={blockerColumns}
                      dataSource={completenessBlockers}
                      pagination={false}
                      size="small"
                    />
                  </Card>
                </Col>
                <Col xs={24} xl={14}>
                  <Card
                    title="各通路資料覆蓋"
                    className="h-full rounded-3xl border-0 bg-white/70 shadow-sm"
                    extra={<Text type="secondary">缺口越少，越能自動核銷與產生分錄</Text>}
                  >
                    <Table
                      rowKey="channelCode"
                      loading={loading}
                      columns={channelCompletenessColumns}
                      dataSource={channelCompleteness}
                      pagination={{ pageSize: 6 }}
                      size="small"
                    />
                  </Card>
                </Col>
                <Col span={24}>
                  <Card
                    title="下一步順序"
                    className="rounded-3xl border-0 bg-white/70 shadow-sm"
                  >
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {(dataCompleteness?.recommendedNextSteps || []).map((step, index) => (
                        <div key={step} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="text-xs font-semibold text-slate-400">Step {index + 1}</div>
                          <div className="mt-1 text-sm leading-6 text-slate-700">{step}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'exceptions',
            label: (
              <span><ExceptionOutlined /> 異常待辦</span>
            ),
            children: (
              <Table
                rowKey="key"
                loading={loading}
                columns={anomalyColumns}
                dataSource={anomalies}
                pagination={false}
                className="rounded-3xl bg-white/60"
              />
            ),
          },
          {
            key: 'payments',
            label: (
              <span><BankOutlined /> 收款與撥款</span>
            ),
            children: (
              <Table
                rowKey="paymentId"
                loading={loading}
                columns={paymentColumns}
                dataSource={recentItems}
                pagination={{ pageSize: 10 }}
                className="rounded-3xl bg-white/60"
              />
            ),
          },
          {
            key: 'batches',
            label: (
              <span><CheckCircleOutlined /> 對帳批次</span>
            ),
            children: (
              <Table
                rowKey="id"
                loading={loading}
                columns={batchColumns}
                dataSource={recentBatches}
                pagination={{ pageSize: 10 }}
                className="rounded-3xl bg-white/60"
              />
            ),
          },
          {
            key: 'audit',
            label: (
              <span><AuditOutlined /> 逐筆稽核</span>
            ),
            children: (
              <Table
                rowKey="orderId"
                loading={loading}
                columns={auditColumns}
                dataSource={auditItems}
                pagination={{ pageSize: 10 }}
                className="rounded-3xl bg-white/60"
              />
            ),
          },
          {
            key: 'ar',
            label: (
              <span><ClockCircleOutlined /> 應收缺口</span>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col span={24}>
                  <div className="grid gap-3 md:grid-cols-4">
                    <Card><Statistic title="應收未收" value={arSummary?.outstandingAmount || 0} prefix="NT$" precision={0} /></Card>
                    <Card><Statistic title="手續費待補" value={arSummary?.missingFeeCount || 0} /></Card>
                    <Card><Statistic title="待補發票" value={arSummary?.missingInvoiceCount || 0} /></Card>
                    <Card><Statistic title="尚未分錄" value={arSummary?.missingJournalCount || 0} /></Card>
                  </div>
                </Col>
                <Col span={24}>
                  <Card
                    title="應收分類總覽"
                    className="rounded-3xl border-0 bg-white/70 shadow-sm"
                    extra={<Text type="secondary">按平台、付款方式、B2B 月結與團購拆分追帳</Text>}
                  >
                    <Table
                      rowKey="key"
                      loading={loading}
                      columns={arGroupColumns}
                      dataSource={arGroups}
                      pagination={false}
                      className="rounded-2xl bg-white/60"
                    />
                  </Card>
                </Col>
                <Col span={24}>
                  <Table
                    rowKey="orderId"
                    loading={loading}
                    columns={arColumns}
                    dataSource={arItems}
                    pagination={{ pageSize: 10 }}
                    className="rounded-3xl bg-white/60"
                  />
                </Col>
              </Row>
            ),
          },
          {
            key: 'b2b-statements',
            label: (
              <span><BankOutlined /> B2B 月結</span>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col span={24}>
                  <div className="grid gap-3 md:grid-cols-4">
                    <Card><Statistic title="月結客戶" value={b2bSummary?.customerCount || 0} /></Card>
                    <Card><Statistic title="開放應收" value={b2bSummary?.outstandingAmount || 0} prefix="NT$" precision={0} /></Card>
                    <Card><Statistic title="逾期金額" value={b2bSummary?.overdueAmount || 0} prefix="NT$" precision={0} /></Card>
                    <Card><Statistic title="超額 / 缺 Email" value={`${b2bSummary?.overCreditCount || 0} / ${b2bSummary?.missingStatementEmailCount || 0}`} /></Card>
                  </div>
                </Col>
                <Col span={24}>
                  <Alert
                    showIcon
                    type="info"
                    message="B2B 月結追帳邏輯"
                    description="公司客戶或已設定月結條件的客戶會集中在這裡。系統會按帳期與到期日自動拆帳齡，月底可用這份資料產生對帳單，收款後再回寫核銷 AR。"
                  />
                </Col>
                <Col span={24}>
                  <Table
                    rowKey={(record) => record.customerId || record.customerName}
                    loading={loading}
                    columns={b2bColumns}
                    dataSource={b2bCustomers}
                    pagination={{ pageSize: 10 }}
                    className="rounded-3xl bg-white/60"
                  />
                </Col>
              </Row>
            ),
          },
        ]}
      />

      <Modal
        title="匯入綠界銷項發票"
        open={issuedInvoiceImportOpen}
        onCancel={() => {
          setIssuedInvoiceImportOpen(false)
          setIssuedInvoiceImportFile(null)
        }}
        onOk={handleConfirmIssuedInvoiceImport}
        confirmLoading={importingEcpayIssuedInvoices}
        okText="匯入並回填訂單"
        cancelText="取消"
        width={720}
      >
        <Alert
          showIcon
          type="warning"
          className="mb-4"
          message="這是客戶訂單銷項發票，不是綠界服務費發票"
          description="匯入前先選正確綠界商店代號：3290494 對應 MOZTECH Shopify 官方站；3150241 對應 1Shop / 團購 / 未來 Shopline。選錯會讓訂單對帳鏈混用。"
        />
        <Form
          form={issuedInvoiceImportForm}
          layout="vertical"
          initialValues={{ merchantId: '3150241', markIssued: true }}
        >
          <Form.Item
            name="merchantId"
            label="綠界商店代號"
            rules={[{ required: true, message: '請選擇商店代號' }]}
          >
            <Select options={ECPAY_MERCHANT_OPTIONS} />
          </Form.Item>
          <Form.Item name="markIssued" label="匯入後標記為已開立" valuePropName="checked">
            <Switch checkedChildren="已開立" unCheckedChildren="僅草稿" />
          </Form.Item>
          <Upload.Dragger
            accept=".xlsx,.xls,.csv"
            maxCount={1}
            beforeUpload={(file) => {
              setIssuedInvoiceImportFile(file)
              return false
            }}
            onRemove={() => {
              setIssuedInvoiceImportFile(null)
            }}
          >
            <p className="ant-upload-drag-icon"><UploadOutlined /></p>
            <p className="ant-upload-text">選擇或拖曳綠界銷項發票匯出檔</p>
            <p className="ant-upload-hint">
              支援 .xlsx / .xls / .csv；系統會用發票號碼、日期與 RelateNumber 嘗試回填 SalesOrder / Invoice。
            </p>
          </Upload.Dragger>
        </Form>
      </Modal>

      <Modal
        title="匯入綠界服務費發票"
        open={feeImportOpen}
        onCancel={() => setFeeImportOpen(false)}
        onOk={handleImportFeeInvoices}
        confirmLoading={importingFeeInvoices}
        okText="匯入並核對"
        cancelText="取消"
        width={860}
      >
        <Alert
          showIcon
          type="warning"
          className="mb-4"
          message="這是綠界開給我們的服務費發票，不是客戶訂單發票"
          description="匯入後會建立 AP 發票，並按月份與 merchant 去核對已回填的綠界金流手續費。若金額對得上，系統可自動標記為已沖抵。"
        />
        <Form
          form={feeImportForm}
          layout="vertical"
          initialValues={{
            merchantId: '3290494',
            vendorName: '綠界科技',
            verifyIssuedStatus: true,
            autoOffsetByMatchedFees: true,
            records: [{ invoiceStatus: 'issued', serviceType: 'gateway_fee', amountCurrency: 'TWD' }],
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item
              name="merchantId"
              label="綠界商店代號"
              rules={[{ required: true, message: '請選擇商店代號' }]}
            >
              <Select options={ECPAY_MERCHANT_OPTIONS} />
            </Form.Item>
            <Form.Item name="vendorName" label="供應商名稱">
              <Input placeholder="綠界科技" />
            </Form.Item>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="verifyIssuedStatus" label="向綠界確認已開立" valuePropName="checked">
              <Switch checkedChildren="驗證" unCheckedChildren="略過" />
            </Form.Item>
            <Form.Item name="autoOffsetByMatchedFees" label="若與手續費金額相符，自動沖抵" valuePropName="checked">
              <Switch checkedChildren="自動" unCheckedChildren="手動" />
            </Form.Item>
          </div>

          <Form.List name="records">
            {(fields, { add, remove }) => (
              <div className="space-y-4">
                {fields.map((field, index) => (
                  <Card
                    key={field.key}
                    size="small"
                    className="rounded-2xl bg-slate-50/80"
                    title={`服務費發票 ${index + 1}`}
                    extra={
                      fields.length > 1 ? (
                        <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                      ) : null
                    }
                  >
                    <div className="grid gap-3 md:grid-cols-4">
                      <Form.Item
                        {...field}
                        name={[field.name, 'invoiceNo']}
                        label="發票號碼"
                        rules={[{ required: true, message: '請輸入發票號碼' }]}
                      >
                        <Input placeholder="例如 YM04187700" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'invoiceDate']}
                        label="發票日期"
                        rules={[{ required: true, message: '請選擇發票日期' }]}
                      >
                        <DatePicker className="w-full" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'amountOriginal']}
                        label="發票金額"
                        rules={[{ required: true, message: '請輸入金額' }]}
                      >
                        <InputNumber min={0} precision={0} className="w-full" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'taxAmount']} label="稅額">
                        <InputNumber min={0} precision={0} className="w-full" placeholder="留白自動估算" />
                      </Form.Item>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <Form.Item {...field} name={[field.name, 'serviceType']} label="費用類型">
                        <Select
                          options={[
                            { label: '金流手續費', value: 'gateway_fee' },
                            { label: '電子發票服務費', value: 'einvoice_fee' },
                            { label: '物流服務費', value: 'logistics_fee' },
                            { label: '其他服務費', value: 'service_fee' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'invoiceStatus']} label="發票狀態">
                        <Select
                          options={[
                            { label: '已開立', value: 'issued' },
                            { label: '待確認', value: 'unknown' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'relateNumber']} label="關聯編號">
                        <Input placeholder="選填" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'amountCurrency']} label="幣別">
                        <Select options={[{ label: 'TWD', value: 'TWD' }]} />
                      </Form.Item>
                    </div>
                    <Form.Item {...field} name={[field.name, 'note']} label="備註">
                      <Input.TextArea rows={2} placeholder="例如：2026/03 金物流手續費" />
                    </Form.Item>
                  </Card>
                ))}
                <Button
                  block
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ invoiceStatus: 'issued', serviceType: 'gateway_fee', amountCurrency: 'TWD' })}
                >
                  新增一筆服務費發票
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default AccountingWorkbenchPage
