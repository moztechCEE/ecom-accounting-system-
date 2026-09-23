import React, { useState, useEffect } from 'react'
import { Alert, Card, Typography, Table, Button, Tag, message, Modal, Form, Select, InputNumber, Space } from 'antd'
import { FileTextOutlined, ReloadOutlined, ScanOutlined, CalculatorOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { purchaseService, PurchaseOrder } from '../services/purchase.service'
import type { LandedCostInput, LandedCostPreview } from '../services/purchase.service'
import { inventoryService } from '../services/inventory.service'
import { resolveEntityId } from '../services/entities.service'
import { useAuth } from '../contexts/AuthContext'

const { Title, Text } = Typography
const decimal = (value: string | number) => Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })
const purchaseError = (error: unknown) => {
  const value = error as { response?: { data?: { message?: string } }; message?: string }
  return value?.response?.data?.message || value?.message || '操作失敗，請稍後重試。'
}

type LandedCostFormValues = {
  freightCurrency: string
  ratePerKgOriginal: number
  fxRateToBase: number
  weights: Array<{ chargeableWeightKg: number }>
}

function LandedCostModal({ order, canEdit, onClose, onSaved }: { order: PurchaseOrder; canEdit: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form] = Form.useForm<LandedCostFormValues>()
  const freightCurrency = Form.useWatch('freightCurrency', form)
  const [preview, setPreview] = useState<LandedCostPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const editable = canEdit && order.status === 'pending'
  const saved = order.landedCost
  const savedLines = new Map(saved?.lines.map((line) => [line.purchaseOrderItemId, line]) || [])

  const inputFromForm = async (): Promise<LandedCostInput> => {
    const values = await form.validateFields()
    return {
      freightCurrency: values.freightCurrency,
      ratePerKgOriginal: values.ratePerKgOriginal,
      fxRateToBase: values.freightCurrency === 'TWD' ? 1 : values.fxRateToBase,
      weights: order.items.map((item, index) => ({
        purchaseOrderItemId: item.id,
        chargeableWeightKg: values.weights[index].chargeableWeightKg,
      })),
    }
  }

  const handlePreview = async () => {
    try {
      const input = await inputFromForm()
      setBusy(true)
      setPreview(await purchaseService.previewLandedCost(order.id, input))
    } catch (error) {
      if (!(error && typeof error === 'object' && 'errorFields' in error)) message.error(purchaseError(error))
    } finally { setBusy(false) }
  }

  const handleSave = async () => {
    if (!preview) return
    try {
      const input = await inputFromForm()
      setBusy(true)
      await purchaseService.saveLandedCost(order.id, input)
      message.success('到岸成本估算已保存，可在收貨前再調整。')
      await onSaved()
    } catch (error) {
      if (!(error && typeof error === 'object' && 'errorFields' in error)) message.error(purchaseError(error))
    } finally { setBusy(false) }
  }

  const summary = preview || saved
  const totalBase = preview?.landedTotalBase || (saved ? (Number(saved.goodsBase) + Number(saved.freightBase)).toFixed(2) : null)

  return <Modal
    title={`運費與到岸成本 · 採購單 ${order.id.slice(0, 8)}`}
    open
    width={850}
    onCancel={onClose}
    footer={editable ? [
      <Button key="cancel" onClick={onClose}>關閉</Button>,
      <Button key="preview" icon={<CalculatorOutlined />} onClick={() => void handlePreview()} loading={busy}>試算成本</Button>,
      <Button key="save" type="primary" onClick={() => void handleSave()} loading={busy} disabled={!preview}>保存估算</Button>,
    ] : <Button onClick={onClose}>關閉</Button>}
  >
    <Alert type={editable ? 'info' : 'warning'} showIcon style={{ marginBottom: 20 }} message={editable ? '每品項填入本次運輸的總計費重量（公斤），再填每公斤運費與匯率。試算後才能保存。' : order.status === 'pending' ? '目前帳號只有檢視權限，請由採購操作員設定到岸成本。' : '此採購單已進入收貨流程，到岸成本只能檢視。'} />
    {editable ? <Form<LandedCostFormValues>
      form={form}
      layout="vertical"
      onValuesChange={() => setPreview(null)}
      initialValues={{
        freightCurrency: saved?.freightCurrency || 'TWD',
        ratePerKgOriginal: Number(saved?.ratePerKgOriginal || 0),
        fxRateToBase: saved?.freightCurrency === 'TWD' || !saved ? 1 : Number(saved.fxRateToBase),
        weights: order.items.map((item) => ({ chargeableWeightKg: Number(savedLines.get(item.id)?.chargeableWeightKg || 0) })),
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Form.Item name="freightCurrency" label="運費幣別" rules={[{ required: true, message: '請選擇運費幣別' }]}>
          <Select options={['TWD', 'CNY', 'USD', 'HKD', 'JPY', 'EUR'].map((value) => ({ value, label: value }))} onChange={(value) => form.setFieldValue('fxRateToBase', value === 'TWD' ? 1 : undefined)} />
        </Form.Item>
        <Form.Item name="ratePerKgOriginal" label="每公斤運費（原幣）" rules={[{ required: true, message: '請填每公斤運費' }]}>
          <InputNumber min={0} precision={6} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="fxRateToBase" label="運費匯率（原幣 → 本位幣）" rules={[{ required: true, message: '請填運費匯率' }]}>
          <InputNumber min={0.000001} precision={6} disabled={freightCurrency === 'TWD'} style={{ width: '100%' }} />
        </Form.Item>
      </div>
      <Typography.Title level={5}>各品項計費重量</Typography.Title>
      {order.items.map((item, index) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-2">
        <div><strong>{item.product.sku} · {item.product.name}</strong><div className="text-xs text-slate-500">採購 {decimal(item.qty)} 件 · 商品單位成本（本位幣）{decimal(item.unitCostBase)}</div></div>
        <Form.Item name={['weights', index, 'chargeableWeightKg']} label="本行總計費重量 kg" rules={[{ required: true, message: '請填計費重量，無運費可填 0' }]} style={{ marginBottom: 0, width: 190 }}>
          <InputNumber min={0} precision={3} style={{ width: '100%' }} />
        </Form.Item>
      </div>)}
      <Typography.Paragraph type="secondary" style={{ marginTop: 14, fontSize: 12 }}>非台幣運費請輸入實際採用匯率。系統以本次計費重量分攤運費；此處為成本估算，收貨時才寫入庫存成本紀錄。</Typography.Paragraph>
    </Form> : null}
    {summary ? <div style={{ marginTop: 22 }}>
      <Typography.Title level={5}>{preview ? '本次試算結果' : '已保存的成本估算'}</Typography.Title>
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-4">
        <div><Text type="secondary">總計費重量</Text><div><strong>{decimal(summary.totalChargeableWeightKg)} kg</strong></div></div>
        <div><Text type="secondary">運費原幣</Text><div><strong>{summary.freightCurrency} {decimal(summary.freightOriginal)}</strong></div></div>
        <div><Text type="secondary">分攤運費（本位幣）</Text><div><strong>{decimal(summary.freightBase)}</strong></div></div>
        <div><Text type="secondary">到岸總成本（本位幣）</Text><div><strong>{decimal(totalBase || 0)}</strong></div></div>
      </div>
      <Table pagination={false} size="small" rowKey="id" style={{ marginTop: 16 }} scroll={{ x: 610 }} dataSource={order.items.map((item) => {
        const line = preview?.lines.find((entry) => entry.purchaseOrderItemId === item.id) || savedLines.get(item.id)
        return { id: item.id, sku: item.product.sku, name: item.product.name, quantity: item.qty, weight: line?.chargeableWeightKg || '0', freight: line?.allocatedFreightBase || '0', unitCost: line?.landedUnitCostBase || '0' }
      })} columns={[
        { title: '商品', key: 'product', render: (_, line) => `${line.sku} · ${line.name}` },
        { title: '採購數量', dataIndex: 'quantity', key: 'quantity', align: 'right', render: decimal },
        { title: '計費重量 kg', dataIndex: 'weight', key: 'weight', align: 'right', render: decimal },
        { title: '分攤運費（本位幣）', dataIndex: 'freight', key: 'freight', align: 'right', render: decimal },
        { title: '到岸單位成本（本位幣）', dataIndex: 'unitCost', key: 'unitCost', align: 'right', render: decimal },
      ]} />
    </div> : <Alert type="info" message={editable ? '尚未試算；請先填寫重量與運費。' : '此採購單沒有已保存的到岸成本估算。'} />}
  </Modal>
}

const PurchaseOrdersPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canManagePurchase = Boolean(user?.roles?.some((role) => role === 'ADMIN' || role === 'OPERATOR'))
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null)
  const [warehouses, setWarehouses] = useState<Array<{ id: string; code: string; name: string }>>([])
  const [receiving, setReceiving] = useState(false)
  const [receiveForm] = Form.useForm()
  const [costOrder, setCostOrder] = useState<PurchaseOrder | null>(null)
  const [openingCostId, setOpeningCostId] = useState<string | null>(null)

  const openLandedCost = async (record: PurchaseOrder) => {
    try {
      setOpeningCostId(record.id)
      setCostOrder(await purchaseService.findOne(record.id))
    } catch (error) { message.error(purchaseError(error)) }
    finally { setOpeningCostId(null) }
  }

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const data = await purchaseService.findAll()
      setOrders(data)
    } catch {
      message.error('無法載入採購訂單')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrders()
  }, [])

  useEffect(() => {
    if (!receivingOrder) return
    receiveForm.resetFields()
    void (async () => {
      try {
        const entityId = await resolveEntityId()
        const rows = await inventoryService.getWarehouses(entityId)
        setWarehouses(rows)
        if (rows.length > 0) receiveForm.setFieldValue('warehouseId', rows[0].id)
      } catch {
        setWarehouses([])
        message.error('無法載入收貨倉庫')
      }
    })()
  }, [receiveForm, receivingOrder])

  const serialRequirements = (() => {
    const requirements = new Map<string, { productId: string; name: string; sku: string; quantity: number }>()
    for (const item of receivingOrder?.items || []) {
      if (!item.product.hasSerialNumbers) continue
      const current = requirements.get(item.productId) || {
        productId: item.productId,
        name: item.product.name,
        sku: item.product.sku,
        quantity: 0,
      }
      current.quantity += Number(item.qty)
      requirements.set(item.productId, current)
    }
    return [...requirements.values()]
  })()

  const handleReceive = async () => {
    if (!receivingOrder) return
    try {
      const values = await receiveForm.validateFields()
      setReceiving(true)
      await purchaseService.receive(
        receivingOrder.id,
        values.warehouseId,
        serialRequirements.map((item) => ({
          productId: item.productId,
          serialNumbers: values.serialNumbers?.[item.productId] || [],
        })),
      )
      message.success('採購單已完成收貨入庫')
      setReceivingOrder(null)
      await fetchOrders()
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) return
      message.error('收貨失敗，庫存未變更')
    } finally {
      setReceiving(false)
    }
  }

  const columns = [
    { title: '採購單號', dataIndex: 'id', key: 'id', render: (id: string) => id.slice(0, 8) },
    { 
      title: '供應商', 
      dataIndex: ['vendor', 'name'], 
      key: 'vendor' 
    },
    { 
      title: '日期', 
      dataIndex: 'orderDate', 
      key: 'orderDate',
      render: (date: string) => new Date(date).toLocaleDateString()
    },
    { 
      title: '狀態', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string) => {
        const colors: Record<string, string> = {
          'pending': 'blue',
          'receiving': 'gold',
          'received': 'green',
          'completed': 'green',
          'cancelled': 'red'
        }
        const labels: Record<string, string> = {
          pending: '待收貨', receiving: '收貨中', received: '已收貨', completed: '已完成', cancelled: '已取消',
        }
        return <Tag color={colors[status] || 'default'}>{labels[status] || status}</Tag>
      }
    },
    { 
      title: '總金額', 
      dataIndex: 'totalAmountOriginal', 
      key: 'totalAmountOriginal',
      render: (val: number, record: PurchaseOrder) =>
        new Intl.NumberFormat('zh-TW', { style: 'currency', currency: record.totalAmountCurrency || 'TWD' }).format(Number(val))
    },
    {
      title: '運費估算',
      key: 'landedCost',
      render: (_: unknown, record: PurchaseOrder) => record.landedCost
        ? `${record.landedCost.freightCurrency} ${decimal(record.landedCost.freightOriginal)}`
        : <Tag>未保存</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: PurchaseOrder) => <Space>
        <Button icon={<CalculatorOutlined />} loading={openingCostId === record.id} onClick={() => void openLandedCost(record)}>{record.status === 'pending' && canManagePurchase ? '運費與成本' : '檢視成本'}</Button>
        {record.status === 'pending' && canManagePurchase ? <Button type="primary" icon={<ScanOutlined />} onClick={() => setReceivingOrder(record)}>收貨入庫</Button> : null}
      </Space>
    }
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="px-2 py-4 sm:p-6"
    >
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Title level={2} className="!mb-0 !text-2xl sm:!text-3xl">採購訂單</Title>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:w-auto lg:flex lg:flex-wrap lg:justify-end">
          <Button className="w-full lg:w-auto" icon={<ReloadOutlined />} onClick={fetchOrders}>重新整理</Button>
          <Button className="w-full lg:w-auto" icon={<FileTextOutlined />} onClick={() => navigate('/sales/quotations')}>
            客戶報價單
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden shadow-sm rounded-xl border-0">
        <Table 
          columns={columns} 
          dataSource={orders} 
          rowKey="id"
          loading={loading}
          scroll={{ x: 900 }}
        />
      </Card>

      {costOrder ? <LandedCostModal key={costOrder.id} order={costOrder} canEdit={canManagePurchase} onClose={() => setCostOrder(null)} onSaved={async () => { setCostOrder(null); await fetchOrders() }} /> : null}

      <Modal
        title="收貨入庫"
        open={Boolean(receivingOrder)}
        onCancel={() => setReceivingOrder(null)}
        onOk={handleReceive}
        okText="確認入庫"
        cancelText="取消"
        confirmLoading={receiving}
        okButtonProps={{ disabled: warehouses.length === 0 }}
      >
        {!receivingOrder?.landedCost ? <Alert type="warning" showIcon message="這張採購單尚未保存運費與到岸成本估算；收貨後不能再修改。" style={{ marginBottom: 16 }} /> : <Alert type="info" showIcon message={`已保存運費估算：${receivingOrder.landedCost.freightCurrency} ${decimal(receivingOrder.landedCost.freightOriginal)}`} style={{ marginBottom: 16 }} />}
        <Form form={receiveForm} layout="vertical" className="pt-3">
          <Form.Item name="warehouseId" label="收貨倉庫" rules={[{ required: true, message: '請選擇收貨倉庫' }]}>
            <Select
              placeholder="選擇倉庫"
              options={warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.code} · ${warehouse.name}`,
              }))}
            />
          </Form.Item>
          {serialRequirements.map((item) => (
            <Form.Item
              key={item.productId}
              name={['serialNumbers', item.productId]}
              label={`${item.name}（${item.sku}）序號 · ${item.quantity} 組`}
              rules={[
                { required: true, message: '請掃描或輸入完整序號' },
                {
                  validator: (_, value?: string[]) =>
                    value?.length === item.quantity && new Set(value.map((serial) => serial.trim())).size === item.quantity
                      ? Promise.resolve()
                      : Promise.reject(new Error(`必須輸入 ${item.quantity} 組不重複序號`)),
                },
              ]}
            >
              <Select mode="tags" tokenSeparators={[',', ' ', '\n']} placeholder="掃描或輸入序號" />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </motion.div>
  )
}

export default PurchaseOrdersPage
