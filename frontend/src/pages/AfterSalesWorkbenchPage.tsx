import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { hasPermission } from '../utils/access'
import axios from 'axios'
import {
  Alert,
  Button,
  Collapse,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import zhTW from 'antd/locale/zh_TW'
import { Input } from 'antd'
import {
  afterSalesWorkbench,
  LEGACY_WORKBENCH_URL,
  legacyCaseUrl,
} from '../services/after-sales-workbench.service'
import type {
  WorkbenchCase,
  WorkbenchDetail,
  WorkbenchField,
  WorkbenchList,
  WorkbenchView,
} from '../services/after-sales-workbench.service'
import {
  afterSalesFieldValue,
  afterSalesStatuses,
  afterSalesTypes,
} from '../utils/after-sales-display'
import './AfterSalesWorkbenchPage.css'

const { Title, Text } = Typography
const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }))
const date = (value: string | null) =>
  value && dayjs(value).isValid()
    ? dayjs(value).format('YYYY/MM/DD HH:mm')
    : '—'

function failure(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 403)
      return '目前帳號或公司未開通售後資料權限'
    if (error.response?.status === 404) return '找不到案件或工作台 API 尚未上線'
    if (error.response?.status === 503) return '售後資料來源尚未就緒'
    if (error.response?.status === 502)
      return '售後資料來源連線失敗或版本不相容'
  }
  return '無法取得售後資料，請重試'
}

function displayField(field: WorkbenchField) {
  if (
    field.value &&
    typeof field.value === 'string' &&
    /At$|Date$/.test(field.key)
  )
    return date(field.value)
  return afterSalesFieldValue(field.key, field.value)
}

export default function AfterSalesWorkbenchPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [entityId, setEntityId] = useState(
    () => localStorage.getItem('entityId')?.trim() || '',
  )
  const view = (
    ['active', 'urgent', 'closed', 'all'].includes(params.get('view') || '')
      ? params.get('view')
      : 'active'
  ) as WorkbenchView
  const type =
    params.get('type') && afterSalesTypes[params.get('type')!]
      ? params.get('type')!
      : undefined
  const status =
    params.get('status') && afterSalesStatuses[params.get('status')!]
      ? params.get('status')!
      : undefined
  const search = (params.get('q') || '').slice(0, 120)
  const pageValue = Number(params.get('page') || 1)
  const page =
    Number.isInteger(pageValue) && pageValue >= 1 && pageValue <= 100000
      ? pageValue
      : 1
  const pageSize = [25, 50, 100].includes(Number(params.get('pageSize')))
    ? Number(params.get('pageSize'))
    : 25
  const [refresh, setRefresh] = useState(0)
  const [listResult, setListResult] = useState<{
    key: string
    data: WorkbenchList | null
    error: string
  }>()
  const [detailResult, setDetailResult] = useState<{
    key: string
    data: WorkbenchDetail | null
    error: string
  }>()
  const selectedId = params.get('case') || ''
  const listKey = JSON.stringify([
    entityId,
    page,
    pageSize,
    view,
    type,
    status,
    search,
    refresh,
  ])
  const detailKey = JSON.stringify([entityId, selectedId, refresh])
  const list = listResult?.key === listKey ? listResult.data : null
  const error = !entityId
    ? '請先選擇登入公司'
    : listResult?.key === listKey
      ? listResult.error
      : ''
  const loading = Boolean(entityId) && listResult?.key !== listKey
  const detail = detailResult?.key === detailKey ? detailResult.data : null
  const detailError = !entityId
    ? '請先選擇登入公司'
    : detailResult?.key === detailKey
      ? detailResult.error
      : ''
  const detailLoading =
    Boolean(entityId && selectedId) && detailResult?.key !== detailKey

  useEffect(() => {
    const syncEntity = () =>
      setEntityId(localStorage.getItem('entityId')?.trim() || '')
    window.addEventListener('storage', syncEntity)
    window.addEventListener('focus', syncEntity)
    return () => {
      window.removeEventListener('storage', syncEntity)
      window.removeEventListener('focus', syncEntity)
    }
  }, [])

  useEffect(() => {
    const abort = new AbortController()
    if (!entityId) return () => abort.abort()
    afterSalesWorkbench
      .list(
        entityId,
        { page, pageSize, view, type, status, search: search || undefined },
        abort.signal,
      )
      .then((data) => {
        if (!abort.signal.aborted)
          setListResult({ key: listKey, data, error: '' })
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted)
          setListResult({ key: listKey, data: null, error: failure(reason) })
      })
    return () => abort.abort()
  }, [entityId, page, pageSize, view, type, status, search, listKey])

  useEffect(() => {
    const abort = new AbortController()
    if (!selectedId || !entityId) return () => abort.abort()
    afterSalesWorkbench
      .detail(entityId, selectedId, abort.signal)
      .then((data) => {
        if (!abort.signal.aborted)
          setDetailResult({ key: detailKey, data, error: '' })
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted)
          setDetailResult({
            key: detailKey,
            data: null,
            error: failure(reason),
          })
      })
    return () => abort.abort()
  }, [selectedId, entityId, detailKey])

  const selectCase = (id?: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (id) next.set('case', id)
      else next.delete('case')
      return next
    })
  const searchCases = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value.trim()) next.set('q', value.trim())
        else next.delete('q')
        next.delete('page')
        return next
      },
      { replace: true },
    )
  const changeFilter = (key: string, value?: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        next.delete('page')
        return next
      },
      { replace: true },
    )

  const columns: ColumnsType<WorkbenchCase> = [
    {
      title: '案件編號',
      dataIndex: 'caseNumber',
      width: 185,
      render: (value, row) => (
        <Button
          type="link"
          className="after-sales-case-link"
          onClick={() => selectCase(row.id)}
        >
          {value}
        </Button>
      ),
    },
    {
      title: '類型',
      dataIndex: 'type',
      width: 115,
      render: (value) => afterSalesTypes[value] || value,
    },
    {
      title: '聯絡人',
      dataIndex: 'contactName',
      width: 120,
      render: (value) => value || '—',
    },
    {
      title: '來源',
      dataIndex: 'sourceChannel',
      width: 125,
      render: (value) => value || '—',
    },
    {
      title: '目前進度',
      width: 220,
      render: (_, row) => (
        <Space size={4} wrap>
          <span>
            {row.workflow.stageLabel ||
              afterSalesStatuses[row.status] ||
              row.status}
          </span>
          {row.isUrgent && <Tag color="red">急件</Tag>}
          {row.workflow.isOverdue && <Tag color="orange">逾期</Tag>}
        </Space>
      ),
    },
    {
      title: '待辦角色',
      width: 100,
      render: (_, row) => row.workflow.ownerRoleLabel || '—',
    },
    {
      title: '承辦人',
      width: 100,
      render: (_, row) => row.assigneeName || row.handlerName || '—',
    },
    { title: '更新時間', dataIndex: 'updatedAt', width: 160, render: date },
  ]
  const tabs = (
    [
      ['active', '待處理'],
      ['urgent', '急件'],
      ['closed', '已結束'],
      ['all', '全部'],
    ] as const
  ).map(([key, label]) => ({
    key,
    label: `${label}${list ? ` ${list.summary[key === 'all' ? 'total' : key]}` : ''}`,
  }))

  return (
    <ConfigProvider
      locale={zhTW}
      theme={{
        token: { controlHeight: 36, borderRadius: 6 },
        components: { Button: { paddingInline: 14 } },
      }}
    >
      <section className="after-sales-workbench">
        <header className="after-sales-heading">
          <Space>
            <Title level={2} style={{ margin: 0, fontSize: 26 }}>
              售後管理中心
            </Title>
            <Tag>唯讀</Tag>
          </Space>
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => {
                setEntityId(localStorage.getItem('entityId')?.trim() || '')
                setRefresh((v) => v + 1)
              }}
            >
              重新整理
            </Button>
            <Button
              href={LEGACY_WORKBENCH_URL}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExportOutlined />}
            >
              舊工作台
            </Button>
          </Space>
        </header>
        <div className="after-sales-surface">
          <Tabs
            activeKey={view}
            items={tabs}
            onChange={(value) => changeFilter('view', value)}
          />
          <div className="after-sales-filters">
            <Select
              aria-label="案件類型"
              placeholder="全部類型"
              allowClear
              value={type}
              options={options(afterSalesTypes)}
              onChange={(value) => changeFilter('type', value)}
            />
            <Select
              aria-label="案件狀態"
              placeholder="全部狀態"
              allowClear
              value={status}
              options={options(afterSalesStatuses)}
              onChange={(value) => changeFilter('status', value)}
            />
            <Input.Search
              key={search}
              aria-label="搜尋案件"
              placeholder="案件編號、原始單號、姓名、電話"
              maxLength={120}
              allowClear
              defaultValue={search}
              onSearch={searchCases}
            />
          </div>
          {error ? (
            <Alert type="error" showIcon message={error} />
          ) : (
            <Table<WorkbenchCase>
              rowKey="id"
              columns={columns}
              dataSource={list?.items || []}
              loading={loading}
              scroll={{ x: 1125 }}
              size="middle"
              locale={{
                emptyText: loading ? (
                  '讀取中'
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="沒有符合條件的案件"
                  />
                ),
              }}
              pagination={{
                current: page,
                pageSize,
                total: list?.page.totalCount || 0,
                showSizeChanger: true,
                pageSizeOptions: [25, 50, 100],
                showTotal: (total) => `共 ${total} 筆`,
                onChange: (next, size) =>
                  setParams(
                    (current) => {
                      const query = new URLSearchParams(current)
                      query.set('page', String(size !== pageSize ? 1 : next))
                      query.set('pageSize', String(size))
                      return query
                    },
                    { replace: true },
                  ),
              }}
            />
          )}
          <footer className="after-sales-footer">
            <Text type="secondary">
              {list ? `來源查詢時間 ${date(list.checkedAt)}` : '舊售後系統'}
            </Text>
          </footer>
        </div>
        <Drawer
          title={detail?.caseNumber || '案件詳情'}
          open={Boolean(selectedId)}
          onClose={() => selectCase()}
          width={960}
          destroyOnHidden
          extra={
            <Space>
            {detail?.type === 'REPAIR' && hasPermission(user, 'after_sales_cases:create') &&
              <Button type="primary" onClick={() => navigate('/sales/after-sales/quotes?new=1&sourceCase=' + encodeURIComponent(selectedId))}>建立報價草稿</Button>}
            <Button
              href={
                selectedId ? legacyCaseUrl(selectedId) : LEGACY_WORKBENCH_URL
              }
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExportOutlined />}
            >
              舊工作台操作
            </Button>
            </Space>
          }
        >
          <div className="after-sales-detail">
            {detailError && (
              <Alert type="error" message={detailError} showIcon />
            )}
            {detailLoading && (
              <div className="after-sales-loading">
                <Spin tip="讀取案件">
                  <div style={{ minHeight: 100 }} />
                </Spin>
              </div>
            )}
            {detail && (
              <>
                <Space wrap style={{ marginBottom: 20 }}>
                  <Tag>{afterSalesTypes[detail.type] || detail.type}</Tag>
                  <Tag>
                    {afterSalesStatuses[detail.status] || detail.status}
                  </Tag>
                  {detail.workflow.stageLabel !==
                    afterSalesStatuses[detail.status] && (
                    <Text>{detail.workflow.stageLabel}</Text>
                  )}
                  <Text type="secondary">{detail.workflow.ownerRoleLabel}</Text>
                </Space>
                <Collapse
                  defaultActiveKey={[
                    'contact',
                    ...detail.sections
                      .filter((s) => s.key.endsWith('Detail'))
                      .map((s) => s.key),
                    'items',
                  ]}
                  items={detail.sections.map((section) => ({
                    key: section.key,
                    label: `${section.title}${section.key === 'contact' || section.key.endsWith('Detail') ? '' : ` (${section.records.length})`}`,
                    children: section.records.length ? (
                      section.records.map((record) => (
                        <Descriptions
                          key={record.key}
                          size="small"
                          column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }}
                          className="after-sales-record"
                          items={record.fields
                            .filter(
                              (field) =>
                                field.value !== null && field.value !== '',
                            )
                            .map((field) => ({
                              key: field.key,
                              label: field.label,
                              children: displayField(field),
                            }))}
                        />
                      ))
                    ) : (
                      <Text type="secondary">無紀錄</Text>
                    ),
                  }))}
                />
              </>
            )}
          </div>
        </Drawer>
      </section>
    </ConfigProvider>
  )
}
