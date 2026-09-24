import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, DatePicker, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import type { Dayjs } from 'dayjs'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { hasPermission } from '../utils/access'
import { GlassCard } from '../components/ui/GlassCard'
import { GlassDrawer } from '../components/ui/GlassDrawer'
import { listEntities, type Entity } from '../services/entities.service'
import {
  performanceService,
  type PerformanceCycle,
  type PerformanceEmployee,
  type PerformanceReview,
} from '../services/performance.service'

const { Title, Text } = Typography

function errorMessage(error: unknown): string {
  const response = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
  if (Array.isArray(response)) return response.join('；')
  return response || (error instanceof Error ? error.message : '操作失敗，請稍後重試')
}

const dateLabel = (value: string) => value?.slice(0, 10) || '—'
const employeeLabel = (employee: PerformanceEmployee) =>
  `${employee.name}（${employee.employeeNo}）${employee.department?.name ? ` · ${employee.department.name}` : ''}`

type CycleForm = { entityId: string; title: string; period: [Dayjs, Dayjs] }
type AssignmentForm = { subjectEmployeeId: string; reviewerEmployeeId?: string }
type ReviewForm = { score?: number | null; goals?: string; comment?: string }

const PerformanceReviewsPage: React.FC = () => {
  const { user } = useAuth()
  const canManage = hasPermission(user, 'performance_reviews:manage')
  const canWrite = hasPermission(user, 'performance_reviews:write')
  const [entities, setEntities] = useState<Entity[]>([])
  const [cycles, setCycles] = useState<PerformanceCycle[]>([])
  const [reviews, setReviews] = useState<PerformanceReview[]>([])
  const [roster, setRoster] = useState<PerformanceEmployee[]>([])
  const [cycleId, setCycleId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cycleOpen, setCycleOpen] = useState(false)
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [selectedReview, setSelectedReview] = useState<PerformanceReview | null>(null)
  const [cycleForm] = Form.useForm<CycleForm>()
  const [assignmentForm] = Form.useForm<AssignmentForm>()
  const [reviewForm] = Form.useForm<ReviewForm>()
  const selectedCycle = cycles.find((cycle) => cycle.id === cycleId)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [cycleRows, reviewRows] = await Promise.all([
        performanceService.cycles(),
        performanceService.reviews(cycleId),
      ])
      setCycles(cycleRows)
      setReviews(reviewRows)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [cycleId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!canManage) return
    listEntities({ isActive: true }).then(setEntities).catch((error) => message.error(errorMessage(error)))
  }, [canManage])

  const loadRoster = useCallback(async (entityId: string) => {
    try { setRoster(await performanceService.roster(entityId)) }
    catch (error) { message.error(errorMessage(error)); setRoster([]) }
  }, [])

  const openAssignment = () => {
    if (!selectedCycle) return
    assignmentForm.resetFields()
    setAssignmentOpen(true)
    void loadRoster(selectedCycle.entityId)
  }

  const createCycle = async () => {
    try {
      const values = await cycleForm.validateFields()
      setSaving(true)
      const cycle = await performanceService.createCycle({
        entityId: values.entityId,
        title: values.title.trim(),
        periodStart: values.period[0].format('YYYY-MM-DD'),
        periodEnd: values.period[1].format('YYYY-MM-DD'),
      })
      setCycleOpen(false)
      cycleForm.resetFields()
      setCycleId(cycle.id)
      message.success('考核週期已建立')
    } catch (error) {
      if (!(error instanceof Error && 'errorFields' in error)) message.error(errorMessage(error))
    } finally { setSaving(false) }
  }

  const assignReview = async () => {
    if (!selectedCycle) return
    try {
      const values = await assignmentForm.validateFields()
      setSaving(true)
      await performanceService.assignReview(selectedCycle.id, values.subjectEmployeeId, values.reviewerEmployeeId)
      setAssignmentOpen(false)
      message.success('評核人已指派')
      await refresh()
    } catch (error) {
      if (!(error instanceof Error && 'errorFields' in error)) message.error(errorMessage(error))
    } finally { setSaving(false) }
  }

  const openReview = (review: PerformanceReview) => {
    setSelectedReview(review)
    reviewForm.setFieldsValue({ score: review.score, goals: review.goals || '', comment: review.comment || '' })
  }

  const canEditSelected = Boolean(selectedReview && selectedReview.status === 'DRAFT' && canWrite &&
    user?.departmentAccess?.employeeId === selectedReview.reviewerEmployeeId)

  const saveReview = async (submit = false) => {
    if (!selectedReview || !canEditSelected) return
    try {
      const values = await reviewForm.validateFields()
      if (submit && (!values.score || !values.comment?.trim())) {
        message.error('送出前請填寫評分與評語')
        return
      }
      setSaving(true)
      const updated = await performanceService.updateReview(selectedReview.id, {
        score: values.score ?? null,
        goals: values.goals?.trim() || null,
        comment: values.comment?.trim() || null,
      })
      if (submit) {
        await performanceService.submitReview(updated.id)
        message.success('考核已送出，內容已鎖定')
        setSelectedReview(null)
      } else {
        message.success('草稿已儲存')
        setSelectedReview(updated)
      }
      await refresh()
    } catch (error) {
      if (!(error instanceof Error && 'errorFields' in error)) message.error(errorMessage(error))
    } finally { setSaving(false) }
  }

  const filteredReviews = useMemo(
    () => cycleId ? reviews.filter((review) => review.cycleId === cycleId) : reviews,
    [cycleId, reviews],
  )

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><Title level={2} className="!mb-1 !font-light">考績與考核</Title>
        <Text type="secondary">主管僅能處理已指派的員工考核；此頁不包含薪資資料。</Text></div>
      {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCycleOpen(true)}>建立考核週期</Button>}
    </div>
    {canManage && <Alert type="info" showIcon message="先建立週期，再指派每位員工的評核人。評核人須有「考核主管」職務，且已連結在職員工資料。" />}
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Space wrap>
          <Select allowClear placeholder="所有考核週期" value={cycleId} onChange={setCycleId}
            className="min-w-64" options={cycles.map((cycle) => ({ value: cycle.id, label: `${cycle.title} · ${dateLabel(cycle.periodStart)}–${dateLabel(cycle.periodEnd)}` }))} />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>重新整理</Button>
        </Space>
        {canManage && selectedCycle && <Button onClick={openAssignment}>指派評核人</Button>}
      </div>
      <Table rowKey="id" loading={loading} dataSource={filteredReviews} scroll={{ x: 680 }}
        locale={{ emptyText: canManage ? '尚無考核；可選擇週期後指派評核人' : '目前沒有指派給你的考核' }}
        columns={[
          { title: '週期', key: 'cycle', render: (_: unknown, row: PerformanceReview) => row.cycle.title },
          { title: '受評員工', key: 'subject', render: (_: unknown, row: PerformanceReview) => employeeLabel(row.subject) },
          { title: '評核人', key: 'reviewer', render: (_: unknown, row: PerformanceReview) => row.reviewer.name },
          { title: '狀態', key: 'status', render: (_: unknown, row: PerformanceReview) =>
            <Tag color={row.status === 'SUBMITTED' ? 'green' : 'gold'}>{row.status === 'SUBMITTED' ? '已送出' : '草稿'}</Tag> },
          { title: '操作', key: 'action', render: (_: unknown, row: PerformanceReview) =>
            <Button type="link" onClick={() => openReview(row)}>查看{row.status === 'DRAFT' && canWrite && user?.departmentAccess?.employeeId === row.reviewerEmployeeId ? '／填寫' : ''}</Button> },
        ]} />
    </GlassCard>

    <Modal title="建立考核週期" open={cycleOpen} onCancel={() => setCycleOpen(false)} onOk={createCycle} confirmLoading={saving} okText="建立">
      <Form form={cycleForm} layout="vertical" className="pt-4">
        <Form.Item name="entityId" label="公司" rules={[{ required: true, message: '請選擇公司' }]}>
          <Select placeholder="選擇公司" options={entities.map((entity) => ({ value: entity.id, label: entity.name }))} />
        </Form.Item>
        <Form.Item name="title" label="週期名稱" rules={[{ required: true, message: '請輸入名稱' }, { max: 120 }]}>
          <Input placeholder="例如 2026 下半年考核" />
        </Form.Item>
        <Form.Item name="period" label="考核期間" rules={[{ required: true, message: '請選擇期間' }]}>
          <DatePicker.RangePicker className="w-full" />
        </Form.Item>
      </Form>
    </Modal>

    <Modal title={`指派評核人 · ${selectedCycle?.title || ''}`} open={assignmentOpen} onCancel={() => setAssignmentOpen(false)}
      onOk={assignReview} confirmLoading={saving} okText="指派">
      <Alert type="info" showIcon className="mt-3 mb-4" message="預設由員工的直屬主管評核；如需改派，可指定同公司且已有考核權限的在職員工。" />
      <Form form={assignmentForm} layout="vertical">
        <Form.Item name="subjectEmployeeId" label="受評員工" rules={[{ required: true, message: '請選擇員工' }]}>
          <Select showSearch optionFilterProp="label" placeholder="選擇員工"
            options={roster.map((employee) => ({ value: employee.id, label: employeeLabel(employee) }))} />
        </Form.Item>
        <Form.Item name="reviewerEmployeeId" label="評核人（留空使用直屬主管）">
          <Select allowClear showSearch optionFilterProp="label" placeholder="直屬主管"
            options={roster.map((employee) => ({ value: employee.id, label: employeeLabel(employee) }))} />
        </Form.Item>
      </Form>
    </Modal>

    <GlassDrawer title={selectedReview ? `${selectedReview.subject.name} · ${selectedReview.cycle.title}` : '考核'}
      open={Boolean(selectedReview)} onClose={() => setSelectedReview(null)} width={620}
      footer={selectedReview && canEditSelected ? <div className="flex justify-end gap-2">
        <Button loading={saving} onClick={() => void saveReview()}>儲存草稿</Button>
        <Button type="primary" loading={saving} onClick={() => Modal.confirm({
          title: '送出考核？', content: '送出後無法再修改評分與評語。', okText: '確認送出', cancelText: '取消',
          onOk: () => saveReview(true),
        })}>送出考核</Button>
      </div> : undefined}>
      {selectedReview && <>
        <Space wrap className="mb-4"><Tag>{selectedReview.subject.department?.name || '未設定部門'}</Tag>
          <Tag color={selectedReview.status === 'SUBMITTED' ? 'green' : 'gold'}>{selectedReview.status === 'SUBMITTED' ? '已送出' : '草稿'}</Tag></Space>
        <Form form={reviewForm} layout="vertical" disabled={!canEditSelected}>
          <Form.Item name="score" label="考核評分（1–5）"><Select allowClear placeholder="選擇評分"
            options={[1, 2, 3, 4, 5].map((score) => ({ value: score, label: `${score} 分` }))} /></Form.Item>
          <Form.Item name="goals" label="工作目標與成果"><Input.TextArea rows={5} maxLength={5000} showCount /></Form.Item>
          <Form.Item name="comment" label="評語（送出必填）"><Input.TextArea rows={6} maxLength={5000} showCount /></Form.Item>
        </Form>
        {selectedReview.status === 'SUBMITTED' && <Text type="secondary">送出時間：{selectedReview.submittedAt ? new Date(selectedReview.submittedAt).toLocaleString('zh-TW') : '—'}</Text>}
      </>}
    </GlassDrawer>
  </div>
}

export default PerformanceReviewsPage
