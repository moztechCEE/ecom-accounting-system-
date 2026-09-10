import React, { useState } from 'react'
import { Descriptions, Steps, Button, Tag, Divider, List, Avatar, Typography, message, Modal, Form, Input, InputNumber, DatePicker } from 'antd'
import { isAxiosError } from 'axios'
import { GlassDrawer, GlassDrawerSection } from './ui/GlassDrawer'
import { 
  UserOutlined,
  CreditCardOutlined,
  CarOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  SendOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { salesService } from '../services/sales.service'
import type { SalesOrder, SalesOrderItem } from '../services/sales.service'
import FulfillOrderModal from './FulfillOrderModal'
import WarehouseDispatch from './WarehouseDispatch'
import {useEntityContext} from '../hooks/useEntityContext'
import {useAuth} from '../contexts/AuthContext'
import {hasPermission} from '../utils/access'

const { Title, Text } = Typography

interface OrderDetailsDrawerProps {
  open: boolean
  onClose: () => void
  order: SalesOrder | null
  onUpdate?: () => void
}

const isFormValidationError = (
  error: unknown,
): error is { errorFields: unknown[] } =>
  typeof error === 'object' && error !== null && 'errorFields' in error

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || fallback
  }
  return fallback
}

const OrderDetailsDrawer: React.FC<OrderDetailsDrawerProps> = ({ open, onClose, order, onUpdate }) => {
  const [syncingInvoice, setSyncingInvoice] = useState(false)
  const [refundModalOpen, setRefundModalOpen] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [fulfillOpen, setFulfillOpen] = useState(false)
  const [refundForm] = Form.useForm()
  const entityId=useEntityContext(),{user}=useAuth()

  if (!order) return null

  const orderItems: SalesOrderItem[] =
    order.items?.length
      ? order.items
      : [
          {
            productName: '訂單項目尚未同步',
            quantity: 1,
            unitPrice: Number(order.totalAmount || 0),
            discount: 0,
            taxAmount: 0,
            lineTotal: Number(order.totalAmount || 0),
            currency: order.currency || 'TWD',
          },
        ]
  const orderTaxAmount = orderItems.reduce(
    (sum, item) => sum + Number(item.taxAmount || 0),
    0,
  )

  const resolveItemBrand = (productName?: string) => {
    const normalizedName = (productName || '').trim()
    if (!normalizedName) return null
    const [prefix] = normalizedName.split(/[|｜]/)
    const candidate = prefix?.trim()
    if (!candidate || candidate === normalizedName || candidate.length > 40) {
      return null
    }
    return candidate
  }

  const resolveItemDisplayName = (productName?: string) => {
    const normalizedName = (productName || '').trim()
    if (!normalizedName) return '訂單項目'
    const brand = resolveItemBrand(normalizedName)
    if (!brand) return normalizedName
    const parts = normalizedName.split(/[|｜]/)
    const remaining = parts.slice(1).join(' | ').trim()
    return remaining || normalizedName
  }

  const handleSyncInvoiceStatus = async () => {
    setSyncingInvoice(true)
    try {
      const result = await salesService.syncInvoiceStatus(order.id)
      if (result?.success) {
        message.success(`已同步發票狀態：${result.invoiceStatus || 'issued'}`)
      } else {
        message.warning(result?.message || '目前找不到可查詢的發票資料')
      }
      onUpdate?.()
    } catch {
      message.error('同步綠界發票狀態失敗')
    } finally {
      setSyncingInvoice(false)
    }
  }

  const handleRefund = async () => {
    try {
      const values = await refundForm.validateFields()
      setRefunding(true)
      const result = await salesService.refundOrder(order.id, {
        refundAmount: Number(values.refundAmount || 0),
        reason: values.reason || '售後退款',
        refundDate: values.refundDate?.toISOString(),
      })
      message.success(
        `退款已建立：${result.fullRefund ? '全額退款' : '部分退款'}，分錄 ${result.journalEntryId}`,
      )
      setRefundModalOpen(false)
      refundForm.resetFields()
      onUpdate?.()
    } catch (error: unknown) {
      if (isFormValidationError(error)) return
      message.error(getApiErrorMessage(error, '建立退款失敗'))
    } finally {
      setRefunding(false)
    }
  }

  return (
    <>
      <GlassDrawer
        title={
          <div className="flex w-full min-w-0 flex-col gap-3 pr-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-lg font-semibold leading-none">訂單詳情</span>
              <Tag color="blue" className="max-w-full truncate">{order.id}</Tag>
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <Button
                size="small"
                icon={<SyncOutlined spin={syncingInvoice} />}
                className="rounded-full whitespace-nowrap"
                loading={syncingInvoice}
                onClick={handleSyncInvoiceStatus}
              >
                同步發票狀態
              </Button>
              {!['shipped', 'completed', 'cancelled', 'refunded'].includes(order.status) && (
                <Button
                  size="small"
                  type="primary"
                  icon={<SendOutlined />}
                  className="rounded-full whitespace-nowrap"
                  onClick={() => setFulfillOpen(true)}
                >
                  出貨
                </Button>
              )}
              <Button
                size="small"
                type="primary"
                className="rounded-full bg-blue-600 hover:bg-blue-500 border-none shadow-lg shadow-blue-200 whitespace-nowrap"
                onClick={() => {
                  refundForm.setFieldsValue({
                    refundAmount: Number(order.totalAmount || 0),
                    reason: '售後退款',
                  })
                  setRefundModalOpen(true)
                }}
              >
                退款/售後
              </Button>
            </div>
          </div>
        }
        placement="right"
        width="min(960px, calc(100vw - 24px))"
        onClose={onClose}
        open={open}
      >
        <div className="space-y-4">
          {hasPermission(user,'wms_tasks:read')&&hasPermission(user,'wms_orders:create')&&order.status==='pending'&&<WarehouseDispatch key={`${entityId}:${order.id}`} entityId={entityId} orderId={order.id} onDispatched={()=>onUpdate?.()}/>}
          {/* Status Timeline */}
          <GlassDrawerSection>
            <Steps
              current={order.status === 'completed' ? 3 : 1}
              items={[
                { title: '訂單建立', description: new Date(order.createdAt).toLocaleString('zh-TW'), icon: <FileTextOutlined /> },
                { title: '付款確認', description: order.paymentStatus || '待確認', icon: <CreditCardOutlined /> },
                { title: '出貨配送', description: order.fulfillmentStatus || '待處理', icon: <CarOutlined /> },
                { title: '訂單完成', icon: <CheckCircleOutlined /> },
              ]}
            />
          </GlassDrawerSection>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Customer Info */}
            <GlassDrawerSection>
              <div className="flex justify-between items-center mb-4">
                <div className="font-semibold text-slate-800">客戶資訊</div>
              </div>
              <div className="flex items-center gap-4 mb-6">
                <Avatar size={64} icon={<UserOutlined />} className="bg-blue-100 text-blue-600" />
                <div>
                  <Title level={4} className="!mb-0">{order.customerName || 'Guest'}</Title>
                  <Text type="secondary">{order.customerType === 'company' ? '企業客戶' : '一般客戶'}</Text>
                </div>
              </div>
              <Descriptions column={1} size="small" labelStyle={{ background: 'transparent' }} contentStyle={{ background: 'transparent' }}>
                <Descriptions.Item label="Email">{order.customerEmail || '未填寫'}</Descriptions.Item>
                <Descriptions.Item label="電話">{order.customerPhone || '未填寫'}</Descriptions.Item>
                <Descriptions.Item label="品牌">{order.sourceBrand || '未分類品牌'}</Descriptions.Item>
                <Descriptions.Item label="平台">{order.sourcePlatform || order.sourceLabel || order.channelName || '未歸戶平台'}</Descriptions.Item>
                <Descriptions.Item label="通路">{order.channelName || order.channelCode || '未設定'}</Descriptions.Item>
                <Descriptions.Item label="發票號碼">{order.invoiceNumber || '尚未開立'}</Descriptions.Item>
                <Descriptions.Item label="發票日期">{order.invoiceDate || '待確認'}</Descriptions.Item>
              </Descriptions>
            </GlassDrawerSection>

            {/* Payment Info */}
            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">付款詳情</div>
              <div className="flex flex-col h-full justify-center">
                <div className="flex justify-between items-center mb-4">
                  <Text type="secondary">訂單付款狀態</Text>
                  <div className="flex items-center gap-2">
                    <CreditCardOutlined className="text-xl" />
                    <Text strong>{order.paymentStatus || 'pending'}</Text>
                  </div>
                </div>
                <div className="flex justify-between items-center mb-4">
                  <Text type="secondary">會計入帳狀態</Text>
                  <Tag color={order.accountingPosted ? 'success' : 'processing'} className="rounded-full px-2 border-none">
                    {order.accountingPosted ? '已入帳' : '待入帳'}
                  </Tag>
                </div>
                <div className="flex justify-between items-center mb-3">
                  <Text type="secondary">已收 / 應收</Text>
                  <Text strong>
                    NT$ {Number(order.paidAmountOriginal || 0).toLocaleString()} / NT$ {Number(order.outstandingAmountOriginal || 0).toLocaleString()}
                  </Text>
                </div>
                <div className="flex justify-between items-center mb-3">
                  <Text type="secondary">金流 / 平台手續費</Text>
                  <Text>
                    NT$ {Number(order.feeGatewayOriginal || 0).toLocaleString()} / NT$ {Number(order.feePlatformOriginal || 0).toLocaleString()}
                  </Text>
                </div>
                <div className="flex justify-between items-center mb-3">
                  <Text type="secondary">實收淨額</Text>
                  <Text strong className="text-emerald-600">
                    NT$ {Number(order.amountNetOriginal || 0).toLocaleString()}
                  </Text>
                </div>
                <Divider className="my-4" />
                <div className="flex justify-between items-center">
                  <Text type="secondary">總金額</Text>
                  <Title level={3} className="!mb-0 !text-blue-600">NT$ {Number(order.totalAmount || 0).toLocaleString()}</Title>
                </div>
              </div>
            </GlassDrawerSection>
          </div>

          {/* Order Items */}
          <GlassDrawerSection>
            <div className="mb-4 font-semibold text-slate-800">訂購項目</div>
            <List
              itemLayout="horizontal"
              dataSource={[
                ...orderItems,
              ]}
              renderItem={(item) => (
                <List.Item className="border-b border-slate-100 last:border-0">
                  <List.Item.Meta
                    avatar={<div className="w-12 h-12 bg-white/60 rounded-lg flex items-center justify-center text-xl">📦</div>}
                    title={
                      <div className="flex flex-wrap items-center gap-2">
                        {resolveItemBrand(item.productName) ? <Tag color="blue" className="m-0">{resolveItemBrand(item.productName)}</Tag> : null}
                        <span>{resolveItemDisplayName(item.productName)}</span>
                        {item.sku ? <Tag className="m-0">{item.sku}</Tag> : null}
                      </div>
                    }
                    description={
                      <div className="mt-1 text-xs text-slate-500">
                        數量 {Number(item.quantity || 0).toLocaleString()} · 單價 NT$ {Number(item.unitPrice || 0).toLocaleString()}
                        {Number(item.discount || 0) > 0 ? ` · 折扣 NT$ ${Number(item.discount || 0).toLocaleString()}` : ''}
                        {Number(item.taxAmount || 0) > 0 ? ` · 稅額 NT$ ${Number(item.taxAmount || 0).toLocaleString()}` : ''}
                      </div>
                    }
                  />
                  <div className="font-medium">NT$ {Number(item.lineTotal || 0).toLocaleString()}</div>
                </List.Item>
              )}
            />
            <div className="flex justify-end mt-6 space-y-2">
              <div className="w-64">
                <div className="flex justify-between mb-2">
                  <Text>小計</Text>
                  <Text>NT$ {Number(order.totalAmount || 0).toLocaleString()}</Text>
                </div>
                <div className="flex justify-between mb-2">
                  <Text>品項稅額（來源資料）</Text>
                  <Text>
                    {orderTaxAmount > 0
                      ? `NT$ ${orderTaxAmount.toLocaleString()}`
                      : '—'}
                  </Text>
                </div>
                <div className="flex justify-between mb-2">
                  <Text>發票 / 會計</Text>
                  <Text>
                    {order.invoiceNumber || '待開票'} · {order.accountingPosted ? '已入帳' : '待入帳'}
                  </Text>
                </div>
                <Divider className="my-2" />
                <div className="flex justify-between">
                  <Text strong>總計</Text>
                  <Text strong className="text-lg">NT$ {Number(order.totalAmount || 0).toLocaleString()}</Text>
                </div>
              </div>
            </div>
          </GlassDrawerSection>
        </div>
      </GlassDrawer>
      <Modal
        open={refundModalOpen}
        title="建立退款 / 售後沖銷"
        onCancel={() => {
          setRefundModalOpen(false)
          refundForm.resetFields()
        }}
        onOk={handleRefund}
        okText="建立退款"
        cancelText="取消"
        confirmLoading={refunding}
      >
        <Form form={refundForm} layout="vertical">
          <Form.Item
            name="refundAmount"
            label="退款金額"
            rules={[
              { required: true, message: '請輸入退款金額' },
              {
                validator: (_, value) => {
                  const amount = Number(value || 0)
                  if (amount <= 0) return Promise.reject(new Error('退款金額必須大於 0'))
                  if (amount - Number(order.totalAmount || 0) > 0.01) {
                    return Promise.reject(new Error('退款金額不可大於訂單總額'))
                  }
                  return Promise.resolve()
                },
              },
            ]}
          >
            <InputNumber min={0} precision={0} addonBefore="NT$" className="!w-full" />
          </Form.Item>
          <Form.Item name="refundDate" label="退款日期">
            <DatePicker className="!w-full" showTime />
          </Form.Item>
          <Form.Item
            name="reason"
            label="退款原因"
            rules={[{ required: true, message: '請輸入退款原因' }]}
          >
            <Input.TextArea rows={3} placeholder="例如：客訴退款、LINE Pay 退刷、團購取消" />
          </Form.Item>
        </Form>
      </Modal>
      <FulfillOrderModal
        open={fulfillOpen}
        onClose={() => setFulfillOpen(false)}
        onSuccess={() => onUpdate?.()}
        order={order}
      />
    </>
  )
}

export default OrderDetailsDrawer
