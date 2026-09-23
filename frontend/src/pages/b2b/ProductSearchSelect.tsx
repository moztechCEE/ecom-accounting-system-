import { useEffect, useMemo, useState } from 'react'
import { Select, Spin, Typography } from 'antd'
import { b2bAdminService } from '../../services/b2b-admin.service'
import type { B2BProductOption } from '../../services/b2b-admin.service'

interface Props {
  value?: string
  onChange?: (value?: string) => void
  entityId: string
  enabled: boolean
  selectedProduct?: B2BProductOption | null
}

const label = (product: B2BProductOption) => `${product.sku} · ${product.name}`

export default function ProductSearchSelect({ value, onChange, entityId, enabled, selectedProduct }: Props) {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<B2BProductOption[]>([])
  const [pinned, setPinned] = useState<{ entityId: string; product: B2BProductOption } | null>(null)
  const [loadedEntityId, setLoadedEntityId] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState(false)

  const visibleRows = useMemo(() => loadedEntityId === entityId ? rows : [], [loadedEntityId, entityId, rows])
  const visiblePinned = pinned?.entityId === entityId && pinned.product.id === value
    ? pinned.product : selectedProduct?.id === value ? selectedProduct : null
  useEffect(() => {
    if (!enabled || !entityId) return
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(false)
      b2bAdminService.productOptions(entityId, search)
        .then((page) => { if (active) { setRows(page.rows); setLoadedEntityId(entityId); setHasMore(page.hasMore) } })
        .catch(() => { if (active) { setRows([]); setError(true) } })
        .finally(() => { if (active) setLoading(false) })
    }, search ? 300 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [enabled, entityId, search])

  const options = useMemo(() => {
    const matches = visibleRows.map((product) => ({ value: product.id, label: label(product) }))
    if (value && !visibleRows.some((product) => product.id === value)) {
      matches.unshift({ value, label: visiblePinned?.id === value ? label(visiblePinned) : `商品 ID: ${value}` })
    }
    return matches
  }, [visibleRows, value, visiblePinned])

  return <Select
    showSearch filterOption={false} value={value} options={options} loading={loading}
    placeholder="輸入 SKU 或商品名稱搜尋"
    onSearch={setSearch}
    onChange={(next) => {
      const product = visibleRows.find((row) => row.id === next) || visiblePinned
      setPinned(product ? { entityId, product } : null)
      onChange?.(next)
    }}
    notFoundContent={loading ? <Spin size="small" /> : error ? '讀取商品失敗，請重新搜尋' : '找不到商品，請輸入 SKU 或名稱'}
    dropdownRender={(menu) => <>{menu}{hasMore ? <Typography.Text type="secondary" style={{ display: 'block', padding: '8px 12px' }}>僅顯示前 20 筆，請輸入更多關鍵字</Typography.Text> : null}</>}
    style={{ width: '100%' }}
  />
}
