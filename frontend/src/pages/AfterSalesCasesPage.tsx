import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckCircleOutlined,
  CreditCardOutlined,
  InboxOutlined,
  PlusOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SendOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'
import { customerService, Customer } from '../services/customer.service'
import { productService, Product } from '../services/product.service'
import {
  AfterSalesCase,
  AfterSalesCaseItem,
  AfterSalesCaseStatus,
  salesService,
} from '../services/sales.service'

const { Title, Text } = Typography
const { TextArea } = Input

type StatusFilter = 'all' | AfterSalesCaseStatus

const reasonOptions = [
  { label: '維修', value: 'repair' },
  { label: '換貨', value: 'exchange' },
  { label: '退貨', value: 'return' },
  { label: '保固', value: 'warranty' },
  { label: '汰舊換新', value: 'trade_in_upgrade' },
  { label: '其他', value: 'other' },
]

const reasonLabel = Object.fromEntries(reasonOptions.map((item) => [item.value, item.label]))

const statusMeta: Record<AfterSalesCaseStatus, { label: string; color: string }> = {
  customer_service: { label: '客服建單', color: 'default' },
  awaiting_payment: { label: '待客戶付款', color: 'gold' },
  accounting_invoice: { label: '會計開票', color: 'blue' },
  warehouse_receiving: { label: '倉儲收件', color: 'purple' },
  customer_service_shipping: { label: '客服寄出', color: 'cyan' },
  completed: { label: '已完成', color: 'green' },
  cancelled: { label: '已取消', color: 'red' },
}

const currencyFormatter = (value?: number | string | null) =>
  `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`

const formatDate = (value?: string | null) =>
  value ? dayjs(value).format('YYYY/MM/DD HH:mm') : '—'

const AfterSalesCasesPage: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [cases, setCases] = useState<AfterSalesCase[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [shipCase, setShipCase] = useState<AfterSalesCase | null>(null)
  const [summary, setSummary] = useState({
    total: 0,
    awaitingPayment: 0,
    accounting: 0,
    warehouse: 0,
    shipping: 0,
    payableAmount: 0,
  })
  const [form] = Form.useForm()
  const [shipForm] = Form.useForm()

  const loadCases = async () => {
    setLoading(true)
    try {
      const response = await salesService.getAfterSalesCases({
        status,
        search,
        limit: 300,
      })
      setCases(response.items)
      setSummary(response.summary)
    } catch (error) {
      console.error(error)
      message.error('讀取來回件失敗')
    } finally {
      setLoading(false)
    }
  }

  const loadOptions = async () => {
    const [customerRows, productRows] = await Promise.allSettled([
      customerService.findAll(),
      productService.findAll(),
    ])
    if (customerRows.status === 'fulfilled') setCustomers(customerRows.value)
    if (productRows.status === 'fulfilled') setProducts(productRows.value)
  }

  useEffect(() => {
    loadOptions()
    loadCases()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadCases()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const createCase = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await salesService.createAfterSalesCase({
        customerId: values.customerId,
        caseDate: values.caseDate?.toISOString(),
        reasonCategory: values.reasonCategory,
        currency: 'TWD',
        notes: values.notes,
        items: (values.items || []).map((item: any) => ({
          productId: item.productId,
          sku: item.sku,
          itemName: item.itemName,
          quantity: Number(item.quantity || 1),
          unitPriceOriginal: Number(item.unitPriceOriginal || 0),
          paymentRequired: Boolean(item.paymentRequired),
          paymentAmountOriginal: Number(item.paymentAmountOriginal || 0),
          notes: item.notes,
        })),
      })
      message.success('來回件已建立')
      setCreateOpen(false)
      form.resetFields()
      await loadCases()
    } catch (error) {
      console.error(error)
      message.error('建立來回件失敗')
    } finally {
      setSaving(false)
    }
  }

  const refreshAfterAction = async (promise: Promise<AfterSalesCase>, successText: string) => {
    setSaving(true)
    try {
      const updated = await promise
      if (updated.paymentLinkUrl && successText.includes('付款')) {
        await navigator.clipboard?.writeText?.(updated.paymentLinkUrl)
      }
      message.success(successText)
      await loadCases()
    } catch (error) {
      console.error(error)
      message.error('操作失敗')
    } finally {
      setSaving(false)
    }
  }

  const setItemPaymentRequired = async (
    record: AfterSalesCase,
    item: AfterSalesCaseItem,
    required: boolean,
  ) => {
    await refreshAfterAction(
      salesService.setAfterSalesItemPaymentRequired(record.id, item.id, {
        paymentRequired: required,
        paymentAmountOriginal: required
          ? item.paymentAmountOriginal || item.unitPriceOriginal * item.quantity
          : 0,
      }),
      required ? '已標記需付款' : '已取消需付款',
    )
  }

  const shipSelectedCase = async () => {
    if (!shipCase) return
    const values = await shipForm.validateFields()
    await refreshAfterAction(
      salesService.shipAfterSalesCase(shipCase.id, { trackingNo: values.trackingNo }),
      '已完成打單寄出',
    )
    setShipCase(null)
    shipForm.resetFields()
  }

  const expandedRowRender = (record: AfterSalesCase) => {
    const itemColumns: ColumnsType<AfterSalesCaseItem> = [
      {
        title: '商品',
        render: (_, item) => (
          <Space direction="vertical" size={2}>
            <Text strong>{item.itemName}</Text>
            <Text type="secondary">{item.sku || item.product?.sku || '無 SKU'}</Text>
          </Space>
        ),
      },
      {
        title: '數量',
        dataIndex: 'quantity',
        width: 90,
        align: 'right',
      },
      {
        title: '單價',
        width: 130,
        align: 'right',
        render: (_, item) => currencyFormatter(item.unitPriceOriginal),
      },
      {
        title: '需付款',
        width: 160,
        align: 'right',
        render: (_, item) =>
          item.paymentRequired ? (
            <Text strong>{currencyFormatter(item.paymentAmountOriginal)}</Text>
          ) : (
            <Text type="secondary">不需付款</Text>
          ),
      },
      {
        title: '操作',
        width: 150,
        render: (_, item) => (
          <Button
            size="small"
            type={item.paymentRequired ? 'default' : 'primary'}
            icon={<CreditCardOutlined />}
            disabled={record.status === 'completed'}
            onClick={() => setItemPaymentRequired(record, item, !item.paymentRequired)}
          >
            {item.paymentRequired ? '取消付款' : '需付款'}
          </Button>
        ),
      },
    ]

    return (
      <Table
        rowKey="id"
        columns={itemColumns}
        dataSource={record.items}
        pagination={false}
        size="small"
      />
    )
  }

  const columns = useMemo<ColumnsType<AfterSalesCase>>(
    () => [
      {
        title: '單號 / 日期',
        width: 180,
        render: (_, record) => (
          <Space direction="vertical" size={2}>
            <Text strong>{record.caseNo}</Text>
            <Text type="secondary">{formatDate(record.caseDate)}</Text>
          </Space>
        ),
      },
      {
        title: '客戶',
        width: 180,
        render: (_, record) => record.customer?.name || '未指定',
      },
      {
        title: '原因分類',
        width: 130,
        render: (_, record) => (
          <Tag color={record.reasonCategory === 'trade_in_upgrade' ? 'blue' : 'default'}>
            {reasonLabel[record.reasonCategory] || record.reasonCategory}
          </Tag>
        ),
      },
      {
        title: '狀態',
        width: 140,
        render: (_, record) => (
          <Tag color={statusMeta[record.status]?.color || 'default'}>
            {statusMeta[record.status]?.label || record.status}
          </Tag>
        ),
      },
      {
        title: '付款',
        width: 170,
        align: 'right',
        render: (_, record) => (
          <Space direction="vertical" size={2}>
            <Text strong>{currencyFormatter(record.paymentAmountOriginal)}</Text>
            <Tag color={record.paymentStatus === 'paid' ? 'green' : record.paymentStatus === 'pending' ? 'gold' : 'default'}>
              {record.paymentStatus === 'paid'
                ? '已付款'
                : record.paymentStatus === 'pending'
                  ? '待付款'
                  : '不需付款'}
            </Tag>
            {record.paymentLinkUrl ? (
              <Text copyable={{ text: record.paymentLinkUrl }} type="secondary">
                付款連結
              </Text>
            ) : null}
          </Space>
        ),
      },
      {
        title: '流程時間',
        render: (_, record) => (
          <Space direction="vertical" size={2}>
            {record.invoiceIssuedAt ? (
              <Text>
                發票：{record.invoiceNumber || '已開立'} · {formatDate(record.invoiceIssuedAt)}
              </Text>
            ) : null}
            {record.warehouseReceivedAt ? <Text>收件：{formatDate(record.warehouseReceivedAt)}</Text> : null}
            {record.shippedAt ? <Text>寄出：{formatDate(record.shippedAt)}</Text> : null}
            {!record.invoiceIssuedAt && !record.warehouseReceivedAt && !record.shippedAt ? (
              <Text type="secondary">尚未進入後續流程</Text>
            ) : null}
          </Space>
        ),
      },
      {
        title: '操作',
        width: 310,
        fixed: 'right',
        render: (_, record) => (
          <Space wrap>
            {record.status === 'customer_service' && record.paymentAmountOriginal > 0 ? (
              <Button
                icon={<CreditCardOutlined />}
                loading={saving}
                onClick={() =>
                  refreshAfterAction(
                    salesService.issueAfterSalesPayment(record.id),
                    '付款已開立，連結已複製',
                  )
                }
              >
                開立付款
              </Button>
            ) : null}
            {record.status === 'awaiting_payment' ? (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={saving}
                onClick={() =>
                  refreshAfterAction(
                    salesService.markAfterSalesPaid(record.id),
                    '已確認付款，發票已自動開立並送會計',
                  )
                }
              >
                確認付款
              </Button>
            ) : null}
            {record.status === 'accounting_invoice' ? (
              <Button
                icon={<CheckCircleOutlined />}
                loading={saving}
                onClick={() =>
                  refreshAfterAction(
                    salesService.confirmAfterSalesAccounting(record.id),
                    '會計已確認，轉倉儲收件',
                  )
                }
              >
                會計確認
              </Button>
            ) : null}
            {record.status === 'warehouse_receiving' ? (
              <Button
                icon={<InboxOutlined />}
                loading={saving}
                onClick={() =>
                  refreshAfterAction(
                    salesService.confirmAfterSalesWarehouseReceived(record.id),
                    '倉儲已確認收件，轉客服寄出',
                  )
                }
              >
                倉儲收件
              </Button>
            ) : null}
            {record.status === 'customer_service_shipping' ? (
              <Button icon={<PrinterOutlined />} onClick={() => setShipCase(record)}>
                打單寄出
              </Button>
            ) : null}
          </Space>
        ),
      },
    ],
    [saving],
  )

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
        <div>
          <Title level={1} style={{ marginBottom: 6 }}>
            來回件
          </Title>
          <Text type="secondary">
            客服建單後可開立付款，付款後進會計開票、倉儲收件，再由客服打單寄出。
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadCases} loading={loading}>
            重新整理
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            建立來回件
          </Button>
        </Space>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <Card><Statistic title="全部來回件" value={summary.total} suffix="件" /></Card>
        <Card><Statistic title="待客戶付款" value={summary.awaitingPayment} suffix="件" /></Card>
        <Card><Statistic title="會計開票" value={summary.accounting} suffix="件" /></Card>
        <Card><Statistic title="倉儲收件" value={summary.warehouse} suffix="件" /></Card>
        <Card><Statistic title="需收款金額" value={summary.payableAmount} formatter={currencyFormatter} /></Card>
      </div>

      <Card
        title="來回件清單"
        extra={
          <Space wrap>
            <Select
              value={status}
              style={{ width: 170 }}
              onChange={(value) => setStatus(value)}
              options={[
                { label: '全部狀態', value: 'all' },
                ...Object.entries(statusMeta).map(([value, meta]) => ({
                  value,
                  label: meta.label,
                })),
              ]}
            />
            <Input.Search
              allowClear
              placeholder="搜尋單號、客戶、商品"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onSearch={loadCases}
              style={{ width: 260 }}
            />
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={cases}
          loading={loading}
          expandable={{ expandedRowRender }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1280 }}
        />
      </Card>

      <Drawer
        title="建立來回件"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        width={860}
        extra={
          <Space>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={createCase}>
              建立
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            caseDate: dayjs(),
            reasonCategory: 'trade_in_upgrade',
            items: [{ quantity: 1, unitPriceOriginal: 0, paymentRequired: false }],
          }}
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item name="caseDate" label="建單日期" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="reasonCategory" label="原因分類" rules={[{ required: true }]}>
                <Select options={reasonOptions} />
              </Form.Item>
            </div>
            <Form.Item name="customerId" label="客戶">
              <Select
                allowClear
                showSearch
                placeholder="選擇客戶"
                optionFilterProp="label"
                options={customers.map((customer) => ({
                  value: customer.id,
                  label: `${customer.code ? `${customer.code} ` : ''}${customer.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="notes" label="備註">
              <TextArea rows={3} placeholder="客服可記錄來回件狀況、客戶說明或出貨注意事項" />
            </Form.Item>

            <Form.List name="items">
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text strong>商品明細</Text>
                    <Button onClick={() => add({ quantity: 1, unitPriceOriginal: 0 })}>
                      新增商品
                    </Button>
                  </div>
                  {fields.map((field) => (
                    <Card key={field.key} size="small">
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 90px 130px 130px 110px', gap: 12, alignItems: 'end' }}>
                        <Form.Item {...field} name={[field.name, 'productId']} label="產品">
                          <Select
                            allowClear
                            showSearch
                            placeholder="選擇產品"
                            optionFilterProp="label"
                            options={products.map((product) => ({
                              value: product.id,
                              label: `${product.sku} ${product.name}`,
                            }))}
                            onChange={(productId) => {
                              const product = products.find((item) => item.id === productId)
                              if (!product) return
                              const items = form.getFieldValue('items') || []
                              items[field.name] = {
                                ...items[field.name],
                                productId,
                                sku: product.sku,
                                itemName: product.name,
                                unitPriceOriginal: Number(product.salesPrice || 0),
                                paymentAmountOriginal: Number(product.salesPrice || 0),
                              }
                              form.setFieldsValue({ items })
                            }}
                          />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'itemName']} label="商品名稱" rules={[{ required: true }]}>
                          <Input placeholder="商品名稱" />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'quantity']} label="數量" rules={[{ required: true }]}>
                          <InputNumber min={1} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'unitPriceOriginal']} label="單價">
                          <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item {...field} name={[field.name, 'paymentAmountOriginal']} label="需付款金額">
                          <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                        <Space>
                          <Button
                            icon={<CreditCardOutlined />}
                            onClick={() => {
                              const items = form.getFieldValue('items') || []
                              const current = items[field.name] || {}
                              items[field.name] = {
                                ...current,
                                paymentRequired: !current.paymentRequired,
                                paymentAmountOriginal:
                                  current.paymentAmountOriginal ||
                                  Number(current.unitPriceOriginal || 0) * Number(current.quantity || 1),
                              }
                              form.setFieldsValue({ items })
                            }}
                          >
                            需付款
                          </Button>
                          {fields.length > 1 ? <Button danger onClick={() => remove(field.name)}>刪除</Button> : null}
                        </Space>
                      </div>
                    </Card>
                  ))}
                </Space>
              )}
            </Form.List>
          </Space>
        </Form>
      </Drawer>

      <Modal
        title="客服打單寄出"
        open={Boolean(shipCase)}
        onCancel={() => setShipCase(null)}
        onOk={shipSelectedCase}
        confirmLoading={saving}
        okText="完成寄出"
        cancelText="取消"
      >
        <Form form={shipForm} layout="vertical">
          <Form.Item name="trackingNo" label="物流單號">
            <Input placeholder="輸入物流或託運單號" prefix={<SendOutlined />} />
          </Form.Item>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default AfterSalesCasesPage
