import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Segmented, Space, Statistic, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import {
  accountingService,
  AccountingPeriod,
} from '../services/accounting.service'

const { Title, Text } = Typography

const AccountingPeriodsPage: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [status, setStatus] = useState<string | undefined>()
  const [actionPeriodId, setActionPeriodId] = useState<string | null>(null)

  const loadPeriods = async (nextStatus?: string) => {
    setLoading(true)
    try {
      const rows = await accountingService.getPeriods(undefined, nextStatus)
      setPeriods(rows)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '載入會計期間失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPeriods(status)
  }, [status])

  const handleClosePeriod = async (periodId: string) => {
    setActionPeriodId(periodId)
    try {
      await accountingService.closePeriod(periodId)
      message.success('會計期間已關帳')
      await loadPeriods(status)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '會計期間關帳失敗')
    } finally {
      setActionPeriodId(null)
    }
  }

  const handleLockPeriod = async (periodId: string) => {
    setActionPeriodId(periodId)
    try {
      await accountingService.lockPeriod(periodId)
      message.success('會計期間已鎖定')
      await loadPeriods(status)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '會計期間鎖定失敗')
    } finally {
      setActionPeriodId(null)
    }
  }

  const summary = useMemo(() => ({
    open: periods.filter((period) => period.status === 'open').length,
    closed: periods.filter((period) => period.status === 'closed').length,
    locked: periods.filter((period) => period.status === 'locked').length,
  }), [periods])

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Title level={2} className="!text-gray-800 font-light tracking-tight !mb-1">
            會計期間
          </Title>
          <Text className="text-gray-500">
            檢查目前各期間是否為開放、已結帳或已鎖定，避免分錄落在錯誤期間。
          </Text>
        </div>
        <Segmented
          options={[
            { label: '全部', value: '' },
            { label: '開放', value: 'open' },
            { label: '已結帳', value: 'closed' },
            { label: '已鎖定', value: 'locked' },
          ]}
          value={status || ''}
          onChange={(value) => setStatus(String(value) || undefined)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card !border-0">
          <Statistic title="開放期間" value={summary.open} valueStyle={{ color: '#16a34a' }} />
        </Card>
        <Card className="glass-card !border-0">
          <Statistic title="已結帳期間" value={summary.closed} valueStyle={{ color: '#f59e0b' }} />
        </Card>
        <Card className="glass-card !border-0">
          <Statistic title="已鎖定期間" value={summary.locked} valueStyle={{ color: '#475569' }} />
        </Card>
      </div>

      <Card className="glass-card !border-0">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={periods}
          columns={[
            {
              title: '期間',
              dataIndex: 'name',
              key: 'name',
              render: (value: string) => <span className="font-medium text-slate-800">{value}</span>,
            },
            {
              title: '起訖',
              key: 'range',
              render: (_, record: AccountingPeriod) =>
                `${dayjs(record.startDate).format('YYYY/MM/DD')} - ${dayjs(record.endDate).format('YYYY/MM/DD')}`,
            },
            {
              title: '狀態',
              dataIndex: 'status',
              key: 'status',
              width: 120,
              render: (value: string) => (
                <Tag color={value === 'open' ? 'green' : value === 'closed' ? 'gold' : 'default'}>
                  {value === 'open' ? '開放' : value === 'closed' ? '已結帳' : '已鎖定'}
                </Tag>
              ),
            },
            {
              title: '最後更新',
              dataIndex: 'updatedAt',
              key: 'updatedAt',
              width: 160,
              render: (value: string) => dayjs(value).format('YYYY/MM/DD HH:mm'),
            },
            {
              title: '操作',
              key: 'actions',
              width: 220,
              render: (_, record: AccountingPeriod) => (
                <Space>
                  {record.status === 'open' && (
                    <Button
                      size="small"
                      onClick={() => handleClosePeriod(record.id)}
                      loading={actionPeriodId === record.id}
                    >
                      關帳
                    </Button>
                  )}
                  {record.status === 'closed' && (
                    <Button
                      size="small"
                      onClick={() => handleLockPeriod(record.id)}
                      loading={actionPeriodId === record.id}
                    >
                      鎖帳
                    </Button>
                  )}
                  {record.status === 'locked' && <Tag>已鎖定</Tag>}
                </Space>
              ),
            },
          ]}
          pagination={{ pageSize: 12, showSizeChanger: true }}
        />
      </Card>
    </div>
  )
}

export default AccountingPeriodsPage
