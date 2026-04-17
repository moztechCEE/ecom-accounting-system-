import React, { useEffect, useMemo, useState } from 'react'
import { Card, Input, Select, Space, Table, Tag, Typography, message } from 'antd'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  accountingService,
  AccountingPeriod,
  JournalEntry,
} from '../services/accounting.service'

const { Title, Text } = Typography

const JournalEntriesPage: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [journals, setJournals] = useState<JournalEntry[]>([])
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [periodId, setPeriodId] = useState<string | undefined>()
  const [searchText, setSearchText] = useState('')

  const loadData = async (nextPeriodId?: string) => {
    setLoading(true)
    try {
      const [periodRows, journalRows] = await Promise.all([
        accountingService.getPeriods(),
        accountingService.getJournals(undefined, nextPeriodId),
      ])
      setPeriods(periodRows)
      setJournals(journalRows)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '載入會計分錄失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData(periodId)
  }, [periodId])

  const filtered = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) {
      return journals
    }
    return journals.filter((journal) => {
      const haystacks = [
        journal.description,
        journal.sourceModule || '',
        journal.sourceId || '',
        ...journal.journalLines.map((line) => `${line.account.code} ${line.account.name} ${line.memo || ''}`),
      ]
      return haystacks.some((text) => text.toLowerCase().includes(keyword))
    })
  }, [journals, searchText])

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Title level={2} className="!text-gray-800 font-light tracking-tight !mb-1">
            會計分錄
          </Title>
          <Text className="text-gray-500">
            查看系統已產生的營收、撥款、薪資與人工分錄，確認每筆交易是否已落帳。
          </Text>
        </div>
        <Space wrap>
          <Select
            allowClear
            placeholder="依會計期間篩選"
            className="min-w-[220px]"
            value={periodId}
            onChange={(value) => setPeriodId(value)}
            options={periods.map((period) => ({
              label: `${period.name} · ${period.status}`,
              value: period.id,
            }))}
          />
          <Input
            prefix={<SearchOutlined className="text-gray-400" />}
            placeholder="搜尋描述、來源模組、科目"
            className="min-w-[280px]"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <Tag
            color="blue"
            className="cursor-pointer rounded-full px-3 py-1"
            onClick={() => loadData(periodId)}
          >
            <ReloadOutlined /> 重新整理
          </Tag>
        </Space>
      </div>

      <Card className="glass-card !border-0">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filtered}
          expandable={{
            expandedRowRender: (record) => (
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="mb-3 text-sm font-medium text-slate-700">分錄明細</div>
                <div className="space-y-2">
                  {record.journalLines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[160px_minmax(0,1fr)_120px_120px] gap-3 rounded-xl bg-white px-4 py-3 text-sm"
                    >
                      <div className="font-mono text-slate-600">
                        {line.account.code} {line.account.name}
                      </div>
                      <div className="text-slate-500">{line.memo || '—'}</div>
                      <div className="text-right text-emerald-700">
                        {Number(line.debit || 0).toLocaleString()}
                      </div>
                      <div className="text-right text-rose-700">
                        {Number(line.credit || 0).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ),
          }}
          columns={[
            {
              title: '日期',
              dataIndex: 'date',
              key: 'date',
              render: (value: string) => dayjs(value).format('YYYY/MM/DD'),
              width: 120,
            },
            {
              title: '描述',
              dataIndex: 'description',
              key: 'description',
            },
            {
              title: '來源',
              key: 'source',
              width: 180,
              render: (_, record: JournalEntry) => (
                <div className="text-xs text-slate-500">
                  <div>{record.sourceModule || 'manual'}</div>
                  <div className="font-mono">{record.sourceId || '—'}</div>
                </div>
              ),
            },
            {
              title: '狀態',
              key: 'status',
              width: 120,
              render: (_, record: JournalEntry) => (
                <Tag color={record.approvedAt ? 'green' : 'gold'}>
                  {record.approvedAt ? '已審核' : '草稿'}
                </Tag>
              ),
            },
            {
              title: '借貸合計',
              key: 'amount',
              width: 160,
              align: 'right',
              render: (_, record: JournalEntry) => {
                const total = record.journalLines.reduce(
                  (sum, line) => sum + Number(line.debit || 0),
                  0,
                )
                return <span className="font-mono">{total.toLocaleString()}</span>
              },
            },
          ]}
          pagination={{ pageSize: 12, showSizeChanger: true }}
        />
      </Card>
    </div>
  )
}

export default JournalEntriesPage
