import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  EditOutlined,
  LinkOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SendOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import {
  reconciliationService,
  TimeoutReconciliationCase,
  TimeoutReconciliationStatus,
} from '../services/reconciliation.service'
import { hasPermission } from '../utils/access'

const { Title, Text } = Typography
const { TextArea } = Input

type StatusFilter = 'all' | TimeoutReconciliationStatus

const statusMeta: Record<
  TimeoutReconciliationStatus,
  { label: string; color: string; description: string }
> = {
  customer_service: {
    label: '客服處理',
    color: 'orange',
    description: '客服可更新備註、重送付款連結，確認後返回會計。',
  },
  accounting: {
    label: '返回會計',
    color: 'blue',
    description: '會計可重新對帳、開立發票後完成案件。',
  },
  completed: {
    label: '已完成',
    color: 'green',
    description: '已完成對帳或開票流程。',
  },
}

const currencyFormatter = (value?: number | string | null) =>
  `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`

const formatDate = (value?: string | null) =>
  value ? dayjs(value).format('YYYY/MM/DD') : '—'

const TimeoutReconciliationPage: React.FC = () => {
  const { user } = useAuth()
  const [status, setStatus] = useState<StatusFilter>('customer_service')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cases, setCases] = useState<TimeoutReconciliationCase[]>([])
  const [summary, setSummary] = useState({
    total: 0,
    customerService: 0,
    accounting: 0,
    completed: 0,
    outstandingAmount: 0,
  })
  const [editingCase, setEditingCase] = useState<TimeoutReconciliationCase | null>(null)
  const [returningCase, setReturningCase] = useState<TimeoutReconciliationCase | null>(null)
  const [editForm] = Form.useForm()
  const [returnForm] = Form.useForm()

  const canEdit = hasPermission(user, 'reconciliation_timeout:update')

  const loadCases = async (nextStatus = status) => {
    setLoading(true)
    try {
      const response = await reconciliationService.getTimeoutCases({
        status: nextStatus,
        limit: 300,
        overdueDays: 30,
      })
      setCases(response.items)
      setSummary(response.summary)
    } catch (error) {
      console.error(error)
      message.error('讀取超時對帳案件失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCases(status)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const openEditModal = (record: TimeoutReconciliationCase) => {
    setEditingCase(record)
    editForm.setFieldsValue({
      paymentLinkUrl: record.paymentLinkUrl || '',
      note: record.timeoutNote || '',
    })
  }

  const handleSaveEdit = async () => {
    if (!editingCase) return
    const values = await editForm.validateFields()
    setSaving(true)
    try {
      await reconciliationService.updateTimeoutCase(editingCase.orderId, {
        paymentLinkUrl: values.paymentLinkUrl,
        note: values.note,
      })
      message.success('超時對帳案件已更新')
      setEditingCase(null)
      await loadCases()
    } catch (error) {
      console.error(error)
      message.error('更新案件失敗')
    } finally {
      setSaving(false)
    }
  }

  const handleResendPaymentLink = async (record: TimeoutReconciliationCase) => {
    setSaving(true)
    try {
      const updated = await reconciliationService.resendTimeoutPaymentLink(record.orderId)
      if (updated.paymentLinkUrl && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(updated.paymentLinkUrl)
        message.success('付款連結已重新產生，並已複製到剪貼簿')
      } else {
        message.success('付款連結已重新產生')
      }
      await loadCases()
    } catch (error) {
      console.error(error)
      message.error('重新傳送付款連結失敗')
    } finally {
      setSaving(false)
    }
  }

  const openReturnModal = (record: TimeoutReconciliationCase) => {
    setReturningCase(record)
    returnForm.setFieldsValue({ note: '' })
  }

  const handleReturnAccounting = async () => {
    if (!returningCase) return
    const values = await returnForm.validateFields()
    setSaving(true)
    try {
      await reconciliationService.returnTimeoutCaseToAccounting(returningCase.orderId, {
        note: values.note,
      })
      message.success('案件已返回會計')
      setReturningCase(null)
      await loadCases()
    } catch (error) {
      console.error(error)
      message.error('返回會計失敗')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<ColumnsType<TimeoutReconciliationCase>>(
    () => [
      {
        title: '日期－單號',
        key: 'order',
        width: 190,
        render: (_, record) => (
          <Space direction="vertical" size={2}>
            <Text strong>{formatDate(record.orderDate)}</Text>
            <Text type="secondary">{record.orderNumber}</Text>
            <Tag color="red">逾時 {record.daysOverdue} 天</Tag>
          </Space>
        ),
      },
      {
        title: '客戶',
        key: 'customer',
        width: 230,
        render: (_, record) => (
          <Space direction="vertical" size={2}>
            <Text strong>{record.customerName}</Text>
            {record.customerPhone ? <Text type="secondary">{record.customerPhone}</Text> : null}
            {record.customerEmail ? <Text type="secondary">{record.customerEmail}</Text> : null}
          </Space>
        ),
      },
      {
        title: '來源',
        dataIndex: 'sourceLabel',
        width: 140,
      },
      {
        title: '未收金額',
        key: 'amount',
        width: 150,
        align: 'right',
        render: (_, record) => (
          <Space direction="vertical" size={2}>
            <Text strong>{currencyFormatter(record.outstandingAmount)}</Text>
            <Text type="secondary">總額 {currencyFormatter(record.grossAmount)}</Text>
          </Space>
        ),
      },
      {
        title: '狀態',
        key: 'status',
        width: 130,
        render: (_, record) => (
          <Tag color={statusMeta[record.timeoutStatus]?.color || 'default'}>
            {statusMeta[record.timeoutStatus]?.label || record.timeoutStatus}
          </Tag>
        ),
      },
      {
        title: '付款連結 / 備註',
        key: 'note',
        render: (_, record) => (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {record.paymentLinkUrl ? (
              <Text copyable={{ text: record.paymentLinkUrl }} ellipsis>
                <LinkOutlined /> {record.paymentLinkUrl}
              </Text>
            ) : (
              <Text type="secondary">尚未產生付款連結</Text>
            )}
            {record.paymentLinkLastSentAt ? (
              <Text type="secondary">
                上次重送 {formatDate(record.paymentLinkLastSentAt)}，共{' '}
                {record.paymentLinkResendCount} 次
              </Text>
            ) : null}
            <Text type={record.timeoutNote ? undefined : 'secondary'}>
              {record.timeoutNote || record.nextAction}
            </Text>
          </Space>
        ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 260,
        fixed: 'right',
        render: (_, record) => (
          <Space wrap>
            <Button
              icon={<EditOutlined />}
              disabled={!canEdit}
              onClick={() => openEditModal(record)}
            >
              編輯
            </Button>
            <Button
              icon={<SendOutlined />}
              disabled={!canEdit}
              loading={saving}
              onClick={() => handleResendPaymentLink(record)}
            >
              重送連結
            </Button>
            <Button
              type="primary"
              icon={<RollbackOutlined />}
              disabled={!canEdit}
              onClick={() => openReturnModal(record)}
            >
              返回會計
            </Button>
          </Space>
        ),
      },
    ],
    [canEdit, saving],
  )

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={1} style={{ marginBottom: 6 }}>
            超時對帳
          </Title>
          <Text type="secondary">
            超過 30 天未完成聯繫、收款或開票的對帳案件，由客服先追蹤後返回會計處理。
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => loadCases()} loading={loading}>
          重新整理
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <Card>
          <Statistic title="目前超時案件" value={summary.total} suffix="件" />
        </Card>
        <Card>
          <Statistic title="客服處理" value={summary.customerService} suffix="件" />
        </Card>
        <Card>
          <Statistic title="返回會計" value={summary.accounting} suffix="件" />
        </Card>
        <Card>
          <Statistic title="未收金額" value={summary.outstandingAmount} formatter={currencyFormatter} />
        </Card>
      </div>

      <Card
        title={
          <Space direction="vertical" size={4}>
            <span>對帳案件清單</span>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {statusMeta[status as TimeoutReconciliationStatus]?.description ||
                '檢視所有超時對帳案件。'}
            </Text>
          </Space>
        }
        extra={
          <Segmented
            value={status}
            onChange={(value) => setStatus(value as StatusFilter)}
            options={[
              { label: '客服處理', value: 'customer_service' },
              { label: '返回會計', value: 'accounting' },
              { label: '全部', value: 'all' },
            ]}
          />
        }
      >
        <Table
          rowKey="orderId"
          columns={columns}
          dataSource={cases}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1280 }}
        />
      </Card>

      <Modal
        title="編輯超時對帳案件"
        open={Boolean(editingCase)}
        onCancel={() => setEditingCase(null)}
        onOk={handleSaveEdit}
        confirmLoading={saving}
        okText="儲存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="付款連結" name="paymentLinkUrl">
            <Input placeholder="可貼上或調整付款連結" />
          </Form.Item>
          <Form.Item label="客服備註" name="note">
            <TextArea rows={5} placeholder="記錄聯繫狀況、客戶回覆或後續提醒" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="返回會計"
        open={Boolean(returningCase)}
        onCancel={() => setReturningCase(null)}
        onOk={handleReturnAccounting}
        confirmLoading={saving}
        okText="返回會計"
        cancelText="取消"
      >
        <Form form={returnForm} layout="vertical">
          <Text>
            確認後，案件會移到會計待處理狀態，會計完成對帳與開立發票後就會離開超時清單。
          </Text>
          <Form.Item label="返回原因或交接備註" name="note" style={{ marginTop: 16 }}>
            <TextArea rows={4} placeholder="例如：客戶已回覆可對帳，請會計重新核對並開立發票" />
          </Form.Item>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default TimeoutReconciliationPage
