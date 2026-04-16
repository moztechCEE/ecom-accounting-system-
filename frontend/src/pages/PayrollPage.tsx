import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Form,
  Table,
  Tag,
  Typography,
  message,
  Statistic,
  Row,
  Col,
  Space,
} from 'antd'
import {
  CheckCircleOutlined,
  CalendarOutlined,
  DollarOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  SendOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { GlassDrawer, GlassDrawerSection } from '../components/ui/GlassDrawer'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import { payrollService } from '../services/payroll.service'
import { PayrollItem, PayrollRun } from '../types'
import { useAuth } from '../contexts/AuthContext'

const { Title, Text } = Typography

const statusMetaMap: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'orange' },
  pending_approval: { label: '待批准', color: 'blue' },
  approved: { label: '已批准', color: 'green' },
  posted: { label: '已封存', color: 'purple' },
}

const PayrollPage: React.FC = () => {
  const { user } = useAuth()
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [form] = Form.useForm()

  const canManagePayroll = useMemo(
    () => (user?.roles ?? []).some((role) => role === 'SUPER_ADMIN' || role === 'ADMIN'),
    [user],
  )

  const fetchRuns = async () => {
    setLoading(true)
    try {
      const result = await payrollService.getPayrollRuns()
      setRuns(Array.isArray(result?.items) ? result.items : [])
    } catch (error) {
      message.error('載入薪資批次失敗')
      setRuns([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRuns()
  }, [])

  const currentMonthTotal = useMemo(() => {
    const currentMonth = dayjs().format('YYYY-MM')
    return runs
      .filter((run) => dayjs(run.payDate).format('YYYY-MM') === currentMonth)
      .reduce((sum, run) => sum + (run.totalAmount ?? 0), 0)
  }, [runs])

  const pendingEmployees = useMemo(
    () =>
      runs
        .filter((run) => run.status === 'draft' || run.status === 'pending_approval')
        .reduce((sum, run) => sum + (run.employeeCount ?? 0), 0),
    [runs],
  )

  const nextPayDate = useMemo(() => {
    const upcoming = runs
      .map((run) => dayjs(run.payDate))
      .filter((date) => date.isSame(dayjs(), 'day') || date.isAfter(dayjs(), 'day'))
      .sort((a, b) => a.valueOf() - b.valueOf())

    return upcoming[0]?.format('YYYY-MM-DD') ?? '尚未排程'
  }, [runs])

  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      await payrollService.createPayrollRun({
        periodStart: values.period[0].toISOString(),
        periodEnd: values.period[1].toISOString(),
        payDate: values.payDate.toISOString(),
      })
      message.success('薪資批次已建立')
      setDrawerOpen(false)
      form.resetFields()
      fetchRuns()
    } catch (error) {
      // handled by form/api
    }
  }

  const handleViewDetail = async (runId: string) => {
    setDetailLoading(true)
    setDetailOpen(true)
    try {
      const detail = await payrollService.getPayrollRun(runId)
      setSelectedRun(detail)
    } catch (error) {
      message.error('載入薪資批次明細失敗')
      setDetailOpen(false)
      setSelectedRun(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleSubmitRun = async (runId: string) => {
    setActionLoadingId(runId)
    try {
      const updated = await payrollService.submitPayrollRun(runId)
      message.success('薪資批次已送審')
      setRuns((prev) => prev.map((run) => (run.id === updated.id ? updated : run)))
      if (selectedRun?.id === updated.id) {
        setSelectedRun(updated)
      }
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
      setRuns((prev) => prev.map((run) => (run.id === updated.id ? updated : run)))
      if (selectedRun?.id === updated.id) {
        setSelectedRun(updated)
      }
    } catch (error: any) {
      message.error(error?.response?.data?.message || '批准失敗')
    } finally {
      setActionLoadingId(null)
    }
  }

  const runColumns = [
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
          <Button type="text" icon={<FileTextOutlined />} onClick={() => handleViewDetail(record.id)}>
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
        </Space>
      ),
    },
  ]

  const itemColumns = [
    {
      title: '員工',
      key: 'employee',
      render: (_: unknown, item: PayrollItem) =>
        item.employee ? `${item.employee.name} (${item.employee.employeeNo})` : item.employeeId,
    },
    {
      title: '項目',
      dataIndex: 'type',
      key: 'type',
    },
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
  ]

  const selectedStatusMeta = selectedRun
    ? statusMetaMap[selectedRun.status] ?? { label: selectedRun.status, color: 'default' }
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div className="flex justify-between items-end">
        <div>
          <Title level={2} className="!mb-1 !font-light">薪資管理</Title>
          <Text className="text-gray-500">薪資計算、送審與批准封存</Text>
        </div>
        {canManagePayroll ? (
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setDrawerOpen(true)}>
            執行薪資計算
          </Button>
        ) : null}
      </div>

      <Row gutter={16}>
        <Col span={8}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="本月預估薪資支出"
              value={currentMonthTotal}
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
          loading={loading}
          columns={runColumns}
          dataSource={runs}
          pagination={{ pageSize: 8 }}
        />
      </Card>

      <GlassDrawer
        title="執行薪資計算"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
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
                系統會自動帶入本期已核准請假、加班與勞健保扣項，建立草稿批次後再由主管或人資送審與批准。
              </Text>
            </GlassDrawerSection>
          </div>

          <GlassDrawerSection>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDrawerOpen(false)} className="rounded-full">取消</Button>
              <Button type="primary" onClick={handleCreate} className="rounded-full bg-blue-600 hover:bg-blue-500 border-none shadow-lg shadow-blue-200">
                開始計算
              </Button>
            </div>
          </GlassDrawerSection>
        </Form>
      </GlassDrawer>

      <GlassDrawer
        title="薪資批次明細"
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          setSelectedRun(null)
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
                  <Statistic title="總金額" value={selectedRun.totalAmount ?? 0} prefix="$" precision={0} />
                </Col>
                <Col span={8}>
                  <Statistic title="涉及員工" value={selectedRun.employeeCount ?? 0} suffix="人" />
                </Col>
                <Col span={8}>
                  <Statistic title="建立日期" value={selectedRun.createdAt ? dayjs(selectedRun.createdAt).format('YYYY-MM-DD') : '—'} />
                </Col>
              </Row>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-500">
                <span>建立者：{selectedRun.creator?.name || '—'}</span>
                <span>批准者：{selectedRun.approver?.name || '—'}</span>
                <span>批准時間：{selectedRun.approvedAt ? dayjs(selectedRun.approvedAt).format('YYYY-MM-DD HH:mm') : '—'}</span>
              </div>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 flex items-center justify-between">
                <div className="font-semibold text-slate-800">薪資項目</div>
                {canManagePayroll && selectedRun.status === 'draft' ? (
                  <Button
                    icon={<SendOutlined />}
                    loading={actionLoadingId === selectedRun.id}
                    onClick={() => handleSubmitRun(selectedRun.id)}
                  >
                    送審
                  </Button>
                ) : null}
                {canManagePayroll && selectedRun.status === 'pending_approval' ? (
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    loading={actionLoadingId === selectedRun.id}
                    onClick={() => handleApproveRun(selectedRun.id)}
                  >
                    批准封存
                  </Button>
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
          </div>
        ) : (
          <div className="py-12 text-center text-slate-400">{detailLoading ? '載入中...' : '尚未選取薪資批次'}</div>
        )}
      </GlassDrawer>
    </motion.div>
  )
}

export default PayrollPage
