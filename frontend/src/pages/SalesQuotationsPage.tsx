import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Col,
  DatePicker,
  Divider,
  Drawer,
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
  Tag,
  Typography,
  message,
} from 'antd'
import {
  CheckCircleOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  PlusOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { customerService, Customer } from '../services/customer.service'
import { productService, Product } from '../services/product.service'
import {
  CreateSalesQuotationPayload,
  SalesQuotation,
  salesService,
} from '../services/sales.service'

const { Title, Text } = Typography

const statusMeta: Record<SalesQuotation['status'], { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  pending: { label: '待批准', color: 'gold' },
  approved: { label: '已批准', color: 'green' },
  sent: { label: '已送出', color: 'blue' },
  accepted: { label: '已接受', color: 'purple' },
  rejected: { label: '已拒絕', color: 'red' },
  expired: { label: '已失效', color: 'orange' },
}

type StatusFilter = 'all' | SalesQuotation['status']

const currencyFormatter = (value?: number | string | null) =>
  `NT$ ${Number(value || 0).toLocaleString()}`

const numberFormatter = (value?: number | string | null) =>
  Number(value || 0).toLocaleString('zh-TW', {
    maximumFractionDigits: 2,
  })

const toNumber = (value: unknown) => Number(value || 0)

const computeQuotationLine = (item: any = {}) => {
  const quantity = toNumber(item.quantity)
  const unitPrice = toNumber(item.unitPriceOriginal)
  const unitDiscount = toNumber(item.unitDiscountOriginal)
  const taxRate = toNumber(item.taxRate ?? 5)
  const netUnitPrice = Math.max(unitPrice - unitDiscount, 0)
  const unitPriceWithTax = netUnitPrice * (1 + taxRate / 100)
  const subtotal = netUnitPrice * quantity
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

  return {
    quantity,
    unitPrice,
    unitDiscount,
    netUnitPrice,
    unitPriceWithTax,
    subtotal,
    taxAmount,
    total,
  }
}

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

const buildQuotationPrintHtml = (quotation: SalesQuotation) => {
  const itemRows = quotation.items.map((item) => {
    const unitDiscount = item.quantity ? item.discountOriginal / item.quantity : 0
    const line = computeQuotationLine({
      quantity: item.quantity,
      unitPriceOriginal: item.unitPriceOriginal,
      unitDiscountOriginal: unitDiscount,
      taxRate: item.taxRate,
    })

    return `
      <tr>
        <td>${escapeHtml(item.product?.sku || '—')}</td>
        <td>${escapeHtml(`${item.itemName}${item.itemSpec ? ` [${item.itemSpec}]` : ''}`)}</td>
        <td class="num">${numberFormatter(item.quantity)}</td>
        <td class="num">${numberFormatter(item.unitPriceOriginal)}</td>
        <td class="num">${numberFormatter(unitDiscount)}</td>
        <td class="num">${numberFormatter(line.unitPriceWithTax)}</td>
        <td class="num">${numberFormatter(line.subtotal)}</td>
        <td class="num">${numberFormatter(item.taxAmountOriginal)}</td>
        <td class="num">${numberFormatter(item.lineTotalOriginal)}</td>
        <td class="num strong">${numberFormatter(item.lineTotalOriginal)}</td>
      </tr>
    `
  }).join('')

  const notes = quotation.notes
    ? `<div class="notes">${escapeHtml(quotation.notes).replace(/\n/g, '<br />')}</div>`
    : ''

  return `<!doctype html>
    <html lang="zh-Hant">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(quotation.quotationNo)} 報價單</title>
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #111827; font-family: Arial, "Noto Sans TC", "Microsoft JhengHei", sans-serif; }
          .sheet { width: 100%; padding: 8px; background: #fff; }
          h1 { margin: 0 0 14px; text-align: center; font-size: 28px; letter-spacing: 0.35em; }
          .top { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th, td { border: 1px solid #4b5563; padding: 7px 8px; font-size: 12px; line-height: 1.35; vertical-align: middle; word-break: break-word; }
          th { background: #f8fafc; font-weight: 700; text-align: center; }
          .label { width: 110px; text-align: right; }
          .amount { margin: 10px 0 14px; border: 2px solid #111827; padding: 8px 12px; font-size: 18px; font-weight: 700; }
          .amount span { float: right; }
          .num { text-align: right; font-variant-numeric: tabular-nums; }
          .strong { font-weight: 700; }
          .notes { margin-top: 14px; font-size: 13px; white-space: normal; }
          .actions { position: fixed; right: 16px; bottom: 16px; display: flex; gap: 8px; }
          .actions button { border: 1px solid #111827; border-radius: 8px; background: #111827; color: #fff; padding: 10px 14px; font-size: 14px; cursor: pointer; }
          @media print { .actions { display: none; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <h1>報價單</h1>
          <div class="top">
            <table>
              <tbody>
                <tr><th class="label">報價單號</th><td>${escapeHtml(quotation.quotationNo)}</td></tr>
                <tr><th class="label">客戶名</th><td>${escapeHtml(quotation.customer?.name || '—')}</td></tr>
                <tr><th class="label">參考</th><td>${escapeHtml(quotation.reference || '—')}</td></tr>
                <tr><th class="label">TEL/FAX</th><td>${escapeHtml(quotation.customer?.phone || '')} /</td></tr>
                <tr><th class="label">有效期間</th><td>${quotation.validUntil ? dayjs(quotation.validUntil).format('YYYY/MM/DD') : '—'}</td></tr>
              </tbody>
            </table>
            <table>
              <tbody>
                <tr><th class="label">公司名稱</th><td>萬博創意科技有限公司</td></tr>
                <tr><th class="label">地址</th><td>709臺南市安南區工業五路26號</td></tr>
                <tr><th class="label">承辦人</th><td>${escapeHtml(quotation.ownerName || '—')}</td></tr>
                <tr><th class="label">TEL</th><td>06-3843492</td></tr>
                <tr><th class="label">支付條件</th><td>${escapeHtml(quotation.paymentTerms || '—')}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="amount">
            報價單：${numberFormatter(quotation.totalAmountOriginal)}
            <span>( ${numberFormatter(quotation.totalAmountOriginal)} ) 包含VAT</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>品項編碼</th>
                <th>品項名稱(規格)</th>
                <th>數量</th>
                <th>單價</th>
                <th>折扣</th>
                <th>單價(含稅)</th>
                <th>稅前價格</th>
                <th>營業稅</th>
                <th>含稅價格</th>
                <th>總價</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
              <tr>
                <td class="strong" colspan="2">合計</td>
                <td></td>
                <td></td>
                <td class="num strong">${numberFormatter(quotation.discountAmountOriginal)}</td>
                <td></td>
                <td class="num strong">${numberFormatter(quotation.subtotalOriginal - quotation.discountAmountOriginal)}</td>
                <td class="num strong">${numberFormatter(quotation.taxAmountOriginal)}</td>
                <td class="num strong">${numberFormatter(quotation.totalAmountOriginal)}</td>
                <td class="num strong">${numberFormatter(quotation.totalAmountOriginal)}</td>
              </tr>
            </tbody>
          </table>
          ${notes}
        </div>
        <div class="actions">
          <button onclick="window.print()">列印 / 另存 PDF</button>
        </div>
      </body>
    </html>`
}

const writeQuotationPrintWindow = (
  printWindow: Window,
  quotation: SalesQuotation,
) => {
  printWindow.document.open()
  printWindow.document.write(buildQuotationPrintHtml(quotation))
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => {
    printWindow.print()
  }, 300)
}

const SalesQuotationsPage: React.FC = () => {
  const [quotations, setQuotations] = useState<SalesQuotation[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [selectedQuotation, setSelectedQuotation] = useState<SalesQuotation | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchText, setSearchText] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [customerSubmitting, setCustomerSubmitting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  const [customerForm] = Form.useForm()
  const watchedCustomerTaxId = Form.useWatch('taxId', customerForm)
  const watchedItems = Form.useWatch('items', form) || []

  const fetchData = async () => {
    setLoading(true)
    try {
      const entityId = localStorage.getItem('entityId')?.trim() || 'tw-entity-001'
      const [quotationRows, customerRows, productRows] = await Promise.all([
        salesService.findQuotations({
          entityId,
          status: statusFilter === 'all' ? undefined : statusFilter,
          search: searchText || undefined,
        }),
        customerService.findAll(),
        productService.findAll(),
      ])
      setQuotations(quotationRows)
      setCustomers(customerRows)
      setProducts(productRows)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '無法載入報價單資料')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
  }, [statusFilter])

  const stats = useMemo(() => {
    const active = quotations.filter((item) => !['rejected', 'expired'].includes(item.status))
    return {
      count: quotations.length,
      activeAmount: active.reduce((sum, item) => sum + Number(item.totalAmountOriginal || 0), 0),
      pending: quotations.filter((item) => item.status === 'pending').length,
    }
  }, [quotations])

  const customerOptions = customers.map((customer) => ({
    value: customer.id,
    label: [
      customer.code,
      customer.name,
      customer.taxId,
      customer.phone || customer.mobile,
    ]
      .filter(Boolean)
      .join(' · '),
  }))

  const productOptions = products.map((product) => ({
    value: product.id,
    label: `${product.sku} · ${product.name}`,
  }))

  const openCreateDrawer = () => {
    form.setFieldsValue({
      quotationDate: dayjs(),
      validUntil: dayjs().add(14, 'day'),
      currency: 'TWD',
      paymentTerms: '50% 訂金，尾款於出貨後七天內支付',
      deliveryTerms: '依雙方確認交期出貨',
      taxRate: 5,
      items: [
        {
          quantity: 1,
          unitPriceOriginal: 0,
          unitDiscountOriginal: 0,
          discountOriginal: 0,
          taxRate: 5,
        },
      ],
    })
    setDrawerOpen(true)
  }

  useEffect(() => {
    if (!customerModalOpen) {
      return
    }

    const normalizedTaxId = String(watchedCustomerTaxId || '').replace(/\D/g, '')
    const currentCode = customerForm.getFieldValue('code')
    if (normalizedTaxId) {
      if (currentCode !== normalizedTaxId) {
        customerForm.setFieldsValue({ code: normalizedTaxId, type: 'company' })
      }
      return
    }
    if (currentCode) {
      customerForm.setFieldsValue({ code: undefined })
    }
  }, [customerForm, customerModalOpen, watchedCustomerTaxId])

  const openCustomerModal = () => {
    customerForm.resetFields()
    customerForm.setFieldsValue({
      name: customerSearch.trim(),
      type: 'individual',
    })
    setCustomerModalOpen(true)
  }

  const handleInlineCustomerCreate = async () => {
    try {
      const values = await customerForm.validateFields()
      setCustomerSubmitting(true)
      const created = await customerService.create(values)
      setCustomers((current) => [created, ...current])
      form.setFieldValue('customerId', created.id)
      setCustomerModalOpen(false)
      customerForm.resetFields()
      setCustomerSearch('')
      message.success('客戶已建立並帶入報價單')
    } catch (error: any) {
      if (error?.errorFields) return
      message.error(error?.response?.data?.message || '建立客戶失敗')
    } finally {
      setCustomerSubmitting(false)
    }
  }

  const handleProductPicked = (fieldName: number, productId: string) => {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    form.setFieldValue(['items', fieldName, 'itemName'], product.name)
    form.setFieldValue(['items', fieldName, 'itemSpec'], product.modelNumber || product.sku)
    form.setFieldValue(['items', fieldName, 'unitPriceOriginal'], Number(product.salesPrice || 0))
    form.setFieldValue(['items', fieldName, 'unitDiscountOriginal'], 0)
  }

  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const payload: CreateSalesQuotationPayload = {
        customerId: values.customerId,
        quotationDate: values.quotationDate?.toISOString(),
        validUntil: values.validUntil?.toISOString(),
        ownerName: values.ownerName,
        currency: values.currency || 'TWD',
        paymentTerms: values.paymentTerms,
        deliveryTerms: values.deliveryTerms,
        reference: values.reference,
        notes: values.notes,
        internalNote: values.internalNote,
        items: (values.items || []).map((item: any) => ({
          productId: item.productId,
          itemName: item.itemName,
          itemSpec: item.itemSpec,
          quantity: Number(item.quantity || 0),
          unitPriceOriginal: Number(item.unitPriceOriginal || 0),
          discountOriginal:
            Number(item.unitDiscountOriginal || 0) * Number(item.quantity || 0),
          taxRate: Number(item.taxRate ?? 5),
        })),
      }
      const created = await salesService.createQuotation(payload)
      message.success('報價單已建立')
      setDrawerOpen(false)
      form.resetFields()
      setSelectedQuotation(created)
      setPreviewOpen(true)
      await fetchData()
    } catch (error: any) {
      if (error?.errorFields) return
      message.error(error?.response?.data?.message || '建立報價單失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const updateStatus = async (quotation: SalesQuotation, status: SalesQuotation['status']) => {
    try {
      const updated = await salesService.updateQuotationStatus(quotation.id, status)
      setQuotations((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setSelectedQuotation((current) => (current?.id === updated.id ? updated : current))
      message.success(`報價單狀態已更新為${statusMeta[status].label}`)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '更新狀態失敗')
    }
  }

  const openPreview = async (quotation: SalesQuotation) => {
    try {
      const detail = await salesService.findQuotation(quotation.id)
      setSelectedQuotation(detail)
      setPreviewOpen(true)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '載入報價單失敗')
    }
  }

  const handleExport = () => {
    const rows = quotations.map((quotation) => ({
      報價單號: quotation.quotationNo,
      日期: dayjs(quotation.quotationDate).format('YYYY-MM-DD'),
      客戶: quotation.customer?.name || '',
      承辦人: quotation.ownerName || '',
      有效期限: quotation.validUntil ? dayjs(quotation.validUntil).format('YYYY-MM-DD') : '',
      狀態: statusMeta[quotation.status]?.label || quotation.status,
      報價金額: quotation.totalAmountOriginal,
      稅額: quotation.taxAmountOriginal,
      參考: quotation.reference || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sales Quotations')
    XLSX.writeFile(wb, `sales_quotations_${dayjs().format('YYYYMMDD')}.xlsx`)
  }

  const handlePrintQuotation = async (
    quotation: SalesQuotation,
    intent: 'print' | 'pdf' = 'print',
  ) => {
    const printWindow = window.open('', '_blank', 'width=1180,height=900')
    if (!printWindow) {
      message.error('瀏覽器阻擋了列印視窗，請允許此網站開啟彈出式視窗')
      return
    }

    printWindow.document.write('<p style="font-family: sans-serif; padding: 24px;">正在準備報價單...</p>')

    try {
      const detail = quotation.items?.length
        ? quotation
        : await salesService.findQuotation(quotation.id)
      writeQuotationPrintWindow(printWindow, detail)
      if (intent === 'pdf') {
        message.info('請在列印視窗選擇「另存為 PDF」')
      }
    } catch (error: any) {
      printWindow.close()
      message.error(error?.response?.data?.message || '無法產生列印內容')
    }
  }

  const columns = [
    {
      title: '日期-號碼',
      key: 'number',
      width: 190,
      render: (_: unknown, quotation: SalesQuotation) => (
        <button
          className="text-left font-semibold text-blue-700 hover:text-blue-500"
          onClick={() => void openPreview(quotation)}
        >
          <div>{dayjs(quotation.quotationDate).format('YYYY/MM/DD')}</div>
          <div>{quotation.quotationNo}</div>
        </button>
      ),
    },
    {
      title: '客戶',
      key: 'customer',
      render: (_: unknown, quotation: SalesQuotation) => (
        <div>
          <div className="font-medium text-slate-900">{quotation.customer?.name || '未指定客戶'}</div>
          <div className="text-xs text-slate-400">{quotation.customer?.phone || quotation.customer?.email || '未填聯絡資訊'}</div>
        </div>
      ),
    },
    {
      title: '品項摘要',
      key: 'items',
      render: (_: unknown, quotation: SalesQuotation) => (
        <div className="max-w-[360px]">
          <div className="truncate font-medium text-slate-800">
            {quotation.items?.[0]?.itemName || '未填品項'}
          </div>
          <div className="text-xs text-slate-400">
            {quotation.items?.length || 0} 筆明細
            {quotation.reference ? ` · ${quotation.reference}` : ''}
          </div>
        </div>
      ),
    },
    {
      title: '有效期限',
      dataIndex: 'validUntil',
      key: 'validUntil',
      width: 120,
      render: (value?: string | null) => (value ? dayjs(value).format('YYYY/MM/DD') : '—'),
    },
    {
      title: '報價金額',
      dataIndex: 'totalAmountOriginal',
      key: 'totalAmountOriginal',
      width: 150,
      align: 'right' as const,
      render: (value: number) => <span className="font-mono">{currencyFormatter(value)}</span>,
    },
    {
      title: '狀態',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: SalesQuotation['status']) => (
        <Tag color={statusMeta[status]?.color || 'default'}>{statusMeta[status]?.label || status}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: unknown, quotation: SalesQuotation) => (
        <Space wrap>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => void openPreview(quotation)}>
            查詢
          </Button>
          <Button size="small" icon={<PrinterOutlined />} onClick={() => void handlePrintQuotation(quotation, 'print')}>
            列印
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => void handlePrintQuotation(quotation, 'pdf')}>
            PDF
          </Button>
          {quotation.status === 'draft' ? (
            <Button size="small" onClick={() => void updateStatus(quotation, 'pending')}>
              送審
            </Button>
          ) : null}
          {quotation.status === 'pending' ? (
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => void updateStatus(quotation, 'approved')}>
              批准
            </Button>
          ) : null}
        </Space>
      ),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Title level={2} className="!mb-1 !font-light">銷售報價單</Title>
          <Text className="text-slate-500">建立給客戶的正式報價，追蹤批准、有效期限與列印版內容。</Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchData()}>
            重新整理
          </Button>
          <Button icon={<FileExcelOutlined />} onClick={handleExport}>
            Excel
          </Button>
          <Button type="primary" icon={<PlusOutlined />} size="large" onClick={openCreateDrawer}>
            建立報價單
          </Button>
        </Space>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <Statistic title="本次查詢報價單" value={stats.count} suffix="張" />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <Statistic title="有效報價總額" value={stats.activeAmount} prefix="NT$" precision={0} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <Statistic title="待批准" value={stats.pending} suffix="張" />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <Space wrap>
            {(['all', 'draft', 'pending', 'approved', 'sent', 'accepted'] as StatusFilter[]).map((status) => (
              <Button
                key={status}
                type={statusFilter === status ? 'primary' : 'default'}
                onClick={() => setStatusFilter(status)}
              >
                {status === 'all' ? '全部' : statusMeta[status]?.label}
              </Button>
            ))}
          </Space>
          <Space.Compact>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="客戶、單號、品項"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onPressEnter={() => void fetchData()}
            />
            <Button type="primary" onClick={() => void fetchData()}>
              查詢
            </Button>
          </Space.Compact>
        </div>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={quotations}
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1080 }}
          locale={{ emptyText: <Empty description="目前沒有報價單" /> }}
        />
      </div>

      <Drawer
        title="建立報價單"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={1320}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => void handleCreate()}>
              儲存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="quotationDate" label="報價日期" rules={[{ required: true }]}>
                <DatePicker className="w-full" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="validUntil" label="有效期限">
                <DatePicker className="w-full" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="currency" label="貨幣">
                <Select options={[{ value: 'TWD', label: 'TWD' }, { value: 'USD', label: 'USD' }, { value: 'CNY', label: 'CNY' }]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="customerId" label="客戶" rules={[{ required: true, message: '請選擇客戶' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={customerOptions}
                  placeholder="選擇客戶"
                  onSearch={setCustomerSearch}
                  notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="找不到客戶" />}
                  dropdownRender={(menu) => (
                    <>
                      {menu}
                      <Divider className="!my-2" />
                      <Button
                        type="text"
                        block
                        icon={<PlusOutlined />}
                        className="!justify-start"
                        onClick={openCustomerModal}
                      >
                        新增客戶資訊
                      </Button>
                    </>
                  )}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="ownerName" label="承辦人">
                <Input placeholder="承辦人" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="reference" label="參考">
                <Input placeholder="專案或需求摘要" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="paymentTerms" label="支付條件">
                <Input placeholder="50% 訂金，尾款於出貨後七天內支付" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="deliveryTerms" label="交貨條件">
                <Input placeholder="依雙方確認交期出貨" />
              </Form.Item>
            </Col>
          </Row>

          <div className="mb-3 mt-4 flex items-center justify-between">
            <div className="font-semibold text-slate-900">報價明細</div>
            <Text type="secondary">折扣填單價折扣，系統會自動換算整列金額</Text>
          </div>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <div className="grid min-w-[1580px] grid-cols-[190px_220px_150px_90px_120px_120px_130px_130px_130px_130px_100px_84px] border-b border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
                  {['品項', '品項名稱', '規格', '數量', '單價', '折扣(單價)', '單價(含稅)', '稅前價格', '含稅價格', '總價', '營業稅%', ''].map((label) => (
                    <div key={label || 'actions'} className="px-3 py-2">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="min-w-[1580px] divide-y divide-slate-100">
                  {fields.map((field) => {
                    const line = computeQuotationLine(watchedItems?.[field.name])
                    return (
                      <div
                        key={field.key}
                        className="grid grid-cols-[190px_220px_150px_90px_120px_120px_130px_130px_130px_130px_100px_84px] items-start gap-0 px-3 py-3"
                      >
                        <Form.Item name={[field.name, 'productId']} className="!mb-0 pr-2">
                          <Select
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            options={productOptions}
                            placeholder="選擇商品或手填"
                            onChange={(value) => value && handleProductPicked(field.name, value)}
                          />
                        </Form.Item>
                        <Form.Item name={[field.name, 'itemName']} className="!mb-0 pr-2" rules={[{ required: true, message: '請輸入品項名稱' }]}>
                          <Input />
                        </Form.Item>
                        <Form.Item name={[field.name, 'itemSpec']} className="!mb-0 pr-2">
                          <Input />
                        </Form.Item>
                        <Form.Item name={[field.name, 'quantity']} className="!mb-0 pr-2" rules={[{ required: true }]}>
                          <InputNumber className="w-full" min={0.01} step={1} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'unitPriceOriginal']} className="!mb-0 pr-2" rules={[{ required: true }]}>
                          <InputNumber className="w-full" min={0} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'unitDiscountOriginal']} className="!mb-0 pr-2">
                          <InputNumber
                            className="w-full"
                            min={0}
                            max={line.unitPrice}
                            placeholder="0"
                          />
                        </Form.Item>
                        <div className="pr-2 pt-1 text-right font-mono text-slate-700">
                          {numberFormatter(line.unitPriceWithTax)}
                        </div>
                        <div className="pr-2 pt-1 text-right font-mono text-slate-700">
                          {numberFormatter(line.subtotal)}
                        </div>
                        <div className="pr-2 pt-1 text-right font-mono text-slate-700">
                          {numberFormatter(line.total)}
                        </div>
                        <div className="pr-2 pt-1 text-right font-mono font-semibold text-slate-900">
                          {numberFormatter(line.total)}
                        </div>
                        <Form.Item name={[field.name, 'taxRate']} className="!mb-0 pr-2">
                          <InputNumber className="w-full" min={0} step={1} />
                        </Form.Item>
                        <Button danger onClick={() => remove(field.name)} disabled={fields.length === 1}>
                          移除
                        </Button>
                      </div>
                    )
                  })}
                </div>
                <Button
                  block
                  className="!rounded-none border-x-0 border-b-0"
                  icon={<PlusOutlined />}
                  onClick={() => add({ quantity: 1, unitPriceOriginal: 0, unitDiscountOriginal: 0, discountOriginal: 0, taxRate: 5 })}
                >
                  新增明細
                </Button>
              </div>
            )}
          </Form.List>

          <Row gutter={16} className="mt-6">
            <Col span={12}>
              <Form.Item name="notes" label="列印備註">
                <Input.TextArea rows={4} placeholder="例如：請您檢查下面的報價單。" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="internalNote" label="內部備註">
                <Input.TextArea rows={4} placeholder="內部追蹤用，不顯示於客戶列印內容" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Drawer>

      <Modal
        title="新增客戶資訊"
        open={customerModalOpen}
        onCancel={() => setCustomerModalOpen(false)}
        onOk={() => void handleInlineCustomerCreate()}
        okText="建立並帶入"
        cancelText="取消"
        confirmLoading={customerSubmitting}
        width={720}
      >
        <Form form={customerForm} layout="vertical">
          <Form.Item name="name" label="客戶名稱" rules={[{ required: true, message: '請輸入客戶名稱' }]}>
            <Input placeholder="例如：王小明 或 某某公司" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="code"
                label="客戶/供應商編碼"
                extra="有統編時會自動同步；無統編時建立後由系統產生個人編號。"
              >
                <Input readOnly placeholder="系統自動帶入" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="taxId"
                label="統一編號"
                normalize={(value) => String(value || '').replace(/\D/g, '').slice(0, 8)}
              >
                <Input inputMode="numeric" maxLength={8} placeholder="例如 12345678" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="type" label="類型" initialValue="individual">
                <Select
                  options={[
                    { value: 'individual', label: '個人 / B2C' },
                    { value: 'company', label: '公司 / B2B' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contactPerson" label="聯絡人">
                <Input placeholder="公司客戶的對接窗口" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="email"
            label="Email"
            rules={[{ type: 'email', message: 'Email 格式不正確' }]}
          >
            <Input placeholder="invoice@example.com" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="phone" label="電話">
                <Input placeholder="市話，例如 02-12345678" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="phoneExtension" label="分機">
                <Input placeholder="例如 123" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="mobile" label="手機">
            <Input placeholder="手機，例如 0912-345-678" />
          </Form.Item>
          <Form.Item name="address" label="地址" rules={[{ required: true, message: '請填入地址' }]}>
            <Input.TextArea rows={2} placeholder="發票、報價單或出貨聯絡可使用的地址" />
          </Form.Item>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">摘要 / 員工備註</div>
            <Form.Item name="summary" className="!mb-0">
              <Input.TextArea
                rows={4}
                placeholder="記錄客戶背景、偏好、需求重點或內部交接注意事項"
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="報價單預覽"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        width={1120}
        footer={[
          <Button key="close" onClick={() => setPreviewOpen(false)}>關閉</Button>,
          <Button key="sent" onClick={() => selectedQuotation && void updateStatus(selectedQuotation, 'sent')}>標記已送出</Button>,
          <Button key="pdf" icon={<DownloadOutlined />} onClick={() => selectedQuotation && void handlePrintQuotation(selectedQuotation, 'pdf')}>存成 PDF</Button>,
          <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={() => selectedQuotation && void handlePrintQuotation(selectedQuotation, 'print')}>列印</Button>,
        ]}
      >
        {selectedQuotation ? (
          <QuotationPreview quotation={selectedQuotation} />
        ) : null}
      </Modal>
    </motion.div>
  )
}

const QuotationPreview: React.FC<{ quotation: SalesQuotation }> = ({ quotation }) => (
  <div className="print:bg-white">
    <div className="mx-auto max-w-[960px] bg-white p-6 text-slate-950 print:max-w-none print:p-0">
      <div className="mb-4 text-center text-3xl font-bold tracking-[0.35em]">報價單</div>
      <div className="grid grid-cols-2 gap-4">
        <table className="w-full border-collapse text-sm">
          <tbody>
            <PreviewRow label="報價單號" value={quotation.quotationNo} />
            <PreviewRow label="客戶名" value={quotation.customer?.name || '—'} />
            <PreviewRow label="參考" value={quotation.reference || '—'} />
            <PreviewRow label="TEL/FAX" value={`${quotation.customer?.phone || ''} /`} />
            <PreviewRow label="有效期間" value={quotation.validUntil ? dayjs(quotation.validUntil).format('YYYY/MM/DD') : '—'} />
          </tbody>
        </table>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <PreviewRow label="公司名稱" value="萬博創意科技有限公司" />
            <PreviewRow label="地址" value="709臺南市安南區工業五路26號" />
            <PreviewRow label="承辦人" value={quotation.ownerName || '—'} />
            <PreviewRow label="TEL" value="06-3843492" />
            <PreviewRow label="支付條件" value={quotation.paymentTerms || '—'} />
          </tbody>
        </table>
      </div>
      <div className="my-3 border-2 border-slate-950 px-4 py-2 text-lg font-bold">
        報價單：{Number(quotation.totalAmountOriginal).toLocaleString()}
        <span className="float-right">( {Number(quotation.totalAmountOriginal).toLocaleString()} ) 包含VAT</span>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-slate-400 bg-slate-50 p-2">品項編碼</th>
            <th className="border border-slate-400 bg-slate-50 p-2">品項名稱(規格)</th>
            <th className="border border-slate-400 bg-slate-50 p-2">數量</th>
            <th className="border border-slate-400 bg-slate-50 p-2">單價</th>
            <th className="border border-slate-400 bg-slate-50 p-2">折扣</th>
            <th className="border border-slate-400 bg-slate-50 p-2">單價(含稅)</th>
            <th className="border border-slate-400 bg-slate-50 p-2">稅前價格</th>
            <th className="border border-slate-400 bg-slate-50 p-2">營業稅</th>
            <th className="border border-slate-400 bg-slate-50 p-2">含稅價格</th>
            <th className="border border-slate-400 bg-slate-50 p-2">總價</th>
          </tr>
        </thead>
        <tbody>
          {quotation.items.map((item) => {
            const unitDiscount = item.quantity ? item.discountOriginal / item.quantity : 0
            const line = computeQuotationLine({
              quantity: item.quantity,
              unitPriceOriginal: item.unitPriceOriginal,
              unitDiscountOriginal: unitDiscount,
              taxRate: item.taxRate,
            })
            return (
              <tr key={item.id}>
                <td className="border border-slate-300 p-2">{item.product?.sku || '—'}</td>
                <td className="border border-slate-300 p-2">{item.itemName}{item.itemSpec ? ` [${item.itemSpec}]` : ''}</td>
                <td className="border border-slate-300 p-2 text-right">{Number(item.quantity).toLocaleString()}</td>
                <td className="border border-slate-300 p-2 text-right">{Number(item.unitPriceOriginal).toLocaleString()}</td>
                <td className="border border-slate-300 p-2 text-right">{Number(unitDiscount).toLocaleString()}</td>
                <td className="border border-slate-300 p-2 text-right">{numberFormatter(line.unitPriceWithTax)}</td>
                <td className="border border-slate-300 p-2 text-right">{numberFormatter(line.subtotal)}</td>
                <td className="border border-slate-300 p-2 text-right">{Number(item.taxAmountOriginal).toLocaleString()}</td>
                <td className="border border-slate-300 p-2 text-right">{numberFormatter(item.lineTotalOriginal)}</td>
                <td className="border border-slate-300 p-2 text-right font-semibold">{numberFormatter(item.lineTotalOriginal)}</td>
              </tr>
            )
          })}
          <tr>
            <td className="border border-slate-300 p-2 text-center font-bold" colSpan={2}>合計</td>
            <td className="border border-slate-300 p-2" />
            <td className="border border-slate-300 p-2" />
            <td className="border border-slate-300 p-2 text-right font-bold">{Number(quotation.discountAmountOriginal).toLocaleString()}</td>
            <td className="border border-slate-300 p-2" />
            <td className="border border-slate-300 p-2 text-right font-bold">{Number(quotation.subtotalOriginal - quotation.discountAmountOriginal).toLocaleString()}</td>
            <td className="border border-slate-300 p-2 text-right font-bold">{Number(quotation.taxAmountOriginal).toLocaleString()}</td>
            <td className="border border-slate-300 p-2 text-right font-bold">{Number(quotation.totalAmountOriginal).toLocaleString()}</td>
            <td className="border border-slate-300 p-2 text-right font-bold">{Number(quotation.totalAmountOriginal).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      {quotation.notes ? <div className="mt-4 whitespace-pre-wrap text-sm">{quotation.notes}</div> : null}
    </div>
  </div>
)

const PreviewRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <tr>
    <th className="w-28 border border-slate-400 bg-slate-50 p-2 text-right">{label}</th>
    <td className="border border-slate-400 p-2">{value}</td>
  </tr>
)

export default SalesQuotationsPage
