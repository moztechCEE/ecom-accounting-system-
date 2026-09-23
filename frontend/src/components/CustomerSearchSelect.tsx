import { useEffect, useMemo, useState } from 'react'
import { Button, Divider, Select, Spin, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { customerService } from '../services/customer.service'
import type { Customer } from '../services/customer.service'
import { includeSelectedCustomer } from '../services/customer-page'
import { useEntityContext } from '../hooks/useEntityContext'

interface CustomerSearchSelectProps {
  value?: string
  onChange?: (value?: string) => void
  entityId?: string
  enabled?: boolean
  placeholder?: string
  allowClear?: boolean
  selectedCustomer?: Customer | null
  onSearchTextChange?: (text: string) => void
  onCreateCustomer?: () => void
}

const label = (customer: Customer) => [
  customer.code,
  customer.companyName || customer.name,
  customer.companyName && customer.name !== customer.companyName ? customer.name : null,
  customer.taxId,
].filter(Boolean).join(' · ')

export default function CustomerSearchSelect({
  value, onChange, entityId, enabled = true, placeholder = '輸入客戶名稱或編號搜尋',
  allowClear, selectedCustomer, onSearchTextChange, onCreateCustomer,
}: CustomerSearchSelectProps) {
  const selectedEntityId = useEntityContext()
  const lookupEntityId = entityId || selectedEntityId
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Customer[]>([])
  const [pinned, setPinned] = useState<{ entityId: string; customer: Customer } | null>(null)
  const [loadedEntityId, setLoadedEntityId] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState(false)

  const visibleRows = useMemo(() => loadedEntityId === lookupEntityId ? rows : [], [loadedEntityId, lookupEntityId, rows])
  const visiblePinned = pinned?.entityId === lookupEntityId && pinned.customer.id === value
    ? pinned.customer : selectedCustomer?.id === value ? selectedCustomer : null

  useEffect(() => {
    if (!enabled) return
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(false)
      customerService.findPage({ entityId: lookupEntityId, search, limit: 20 })
        .then((page) => {
          if (!active) return
          setRows(page.rows.filter((customer) => customer.isActive))
          setLoadedEntityId(lookupEntityId)
          setHasMore(page.hasMore)
        })
        .catch(() => { if (active) { setRows([]); setError(true) } })
        .finally(() => { if (active) setLoading(false) })
    }, search ? 300 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [enabled, lookupEntityId, search])

  useEffect(() => {
    if (!enabled || !value || visiblePinned?.id === value || visibleRows.some((row) => row.id === value)) return
    let active = true
    customerService.findOne(value, lookupEntityId)
      .then((customer) => { if (active && customer?.id === value) setPinned({ entityId: lookupEntityId, customer }) })
      .catch(() => { /* The selected ID remains visible if the record is inaccessible. */ })
    return () => { active = false }
  }, [enabled, value, lookupEntityId, visiblePinned?.id, visibleRows])

  const options = useMemo(() => includeSelectedCustomer(visibleRows, value, visiblePinned)
    .map((customer) => ({ value: customer.id, label: label(customer), disabled: !customer.isActive })), [visibleRows, value, visiblePinned])
  if (value && !options.some((option) => option.value === value)) options.unshift({ value, label: `客戶 ID: ${value}`, disabled: false })

  return <Select
    showSearch
    filterOption={false}
    allowClear={allowClear}
    value={value}
    onChange={(next) => {
      const customer = includeSelectedCustomer(visibleRows, next, visiblePinned).find((row) => row.id === next)
      setPinned(customer ? { entityId: lookupEntityId, customer } : null)
      onChange?.(next)
    }}
    onSearch={(text) => { setSearch(text); onSearchTextChange?.(text) }}
    options={options}
    loading={loading}
    placeholder={placeholder}
    notFoundContent={loading ? <Spin size="small" /> : error ? '讀取客戶失敗，請重新搜尋' : '找不到客戶，請輸入名稱或編號'}
    dropdownRender={(menu) => <>{menu}{hasMore ? <Typography.Text type="secondary" style={{ display: 'block', padding: '8px 12px' }}>僅顯示前 20 筆，請輸入更多關鍵字</Typography.Text> : null}{onCreateCustomer ? <><Divider style={{ margin: '6px 0' }} /><Button type="text" block icon={<PlusOutlined />} onClick={onCreateCustomer}>新增客戶資訊</Button></> : null}</>}
    style={{ width: '100%' }}
  />
}
