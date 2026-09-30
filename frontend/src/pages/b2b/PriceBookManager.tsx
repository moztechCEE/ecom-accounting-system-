import { useEffect, useState } from 'react'
import { Alert, AutoComplete, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { b2bAdminService } from '../../services/b2b-admin.service'
import type { B2BPriceBook, B2BPriceOffer, B2BPriceOfferInput } from '../../services/b2b-admin.service'
import ProductSearchSelect from './ProductSearchSelect'

const { Text } = Typography
const pageSize = 20
const money = (value: string | number | null) => value == null ? '未設定' : `NT$ ${Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`
const localTime = (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm')
const errorText = (error: unknown) => {
  const value = error as { response?: { data?: { message?: string } }; message?: string }
  return value?.response?.data?.message || value?.message || '操作失敗，請稍後重試。'
}

type BookValues = { productId: string; brand?: string | null; msrp: number; regularPrice?: number | null; groupBuyPrice?: number | null; taxBasis: B2BPriceBook['taxBasis']; isPublic: boolean }
type OfferValues = {
  unitPrice: number
  startsAt: string
  endsAt: string
  audience: B2BPriceOffer['audience']
  audienceCode?: string
}
type OfferEditor = { book: B2BPriceBook; offer: B2BPriceOffer | null }

export default function PriceBookManager({ entityId, canWrite }: { entityId: string; canWrite: boolean }) {
  const [books, setBooks] = useState<B2BPriceBook[]>([])
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [brandRefresh, setBrandRefresh] = useState(0)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [bookOpen, setBookOpen] = useState(false)
  const [offerEditor, setOfferEditor] = useState<OfferEditor | null>(null)
  const [bookForm] = Form.useForm<BookValues>()
  const [offerForm] = Form.useForm<OfferValues>()
  const productId = Form.useWatch('productId', bookForm)
  const bookTaxBasis = Form.useWatch('taxBasis', bookForm)
  const audience = Form.useWatch('audience', offerForm)

  const reload = async () => {
    if (!entityId) return
    setLoading(true)
    setError('')
    try {
      const result = await b2bAdminService.priceBooks(entityId, { search, limit: pageSize, offset: (page - 1) * pageSize })
      setBooks(result.rows)
      setTotal(result.total)
    }
    catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!entityId) return
    let active = true
    b2bAdminService.priceBooks(entityId, { search, limit: pageSize, offset: (page - 1) * pageSize })
      .then((result) => { if (active) { setBooks(result.rows); setTotal(result.total) } })
      .catch((reason) => { if (active) setError(errorText(reason)) })
    return () => { active = false }
  }, [entityId, page, search])

  useEffect(() => {
    setBrandOptions([])
    if (!entityId) return
    let active = true
    b2bAdminService.priceBookBrands(entityId)
      .then(({ brands }) => { if (active) setBrandOptions(brands) })
      .catch(() => { if (active) setBrandOptions([]) })
    return () => { active = false }
  }, [entityId, brandRefresh])

  const openBook = (book?: B2BPriceBook) => {
    bookForm.resetFields()
    if (book) bookForm.setFieldsValue({ productId: book.productId, brand: book.brand || '', msrp: book.msrp == null ? undefined : Number(book.msrp), regularPrice: book.regularPrice == null ? null : Number(book.regularPrice), groupBuyPrice: book.groupBuyPrice == null ? null : Number(book.groupBuyPrice), taxBasis: book.taxBasis, isPublic: book.isPublic })
    else bookForm.setFieldsValue({ isPublic: false })
    setBookOpen(true)
  }

  const saveBook = async () => {
    try {
      const values = await bookForm.validateFields()
      if (!Number.isFinite(values.msrp) || values.msrp <= 0 || Math.round(values.msrp * 100) !== values.msrp * 100) throw new Error('建議售價須大於 0，最多小數兩位。')
      if (values.regularPrice != null && (!Number.isFinite(values.regularPrice) || values.regularPrice <= 0 || Math.round(values.regularPrice * 100) !== values.regularPrice * 100)) throw new Error('常態售價須大於 0，最多小數兩位；不用時請留空。')
      if (values.groupBuyPrice != null && (!Number.isFinite(values.groupBuyPrice) || values.groupBuyPrice <= 0 || Math.round(values.groupBuyPrice * 100) !== values.groupBuyPrice * 100)) throw new Error('團購主進貨價須大於 0，最多小數兩位；不用時請留空。')
      setSaving(true)
      await b2bAdminService.savePriceBook(values.productId, { entityId, currency: 'TWD', taxBasis: values.taxBasis, msrp: values.msrp, regularPrice: values.regularPrice ?? null, groupBuyPrice: values.groupBuyPrice ?? null, brand: values.brand?.trim() || null, isPublic: values.isPublic === true })
      setBookOpen(false)
      message.success('商品價目已儲存')
      await reload()
      setBrandRefresh((value) => value + 1)
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'errorFields' in reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const openOffer = (book: B2BPriceBook, offer: B2BPriceOffer | null = null) => {
    offerForm.resetFields()
    offerForm.setFieldsValue(offer ? {
      unitPrice: Number(offer.unitPrice),
      startsAt: dayjs(offer.startsAt).format('YYYY-MM-DDTHH:mm'),
      endsAt: dayjs(offer.endsAt).format('YYYY-MM-DDTHH:mm'),
      audience: offer.audience,
      audienceCode: offer.audienceCode || undefined,
    } : { audience: 'ALL' })
    setOfferEditor({ book, offer })
  }

  const offerInput = (values: OfferValues, isActive?: boolean): B2BPriceOfferInput => ({
    entityId,
    unitPrice: values.unitPrice,
    startsAt: dayjs(values.startsAt).toISOString(),
    endsAt: dayjs(values.endsAt).toISOString(),
    audience: values.audience,
    audienceCode: values.audience === 'CODE' ? values.audienceCode?.trim() || null : null,
    ...(isActive == null ? {} : { isActive }),
  })

  const saveOffer = async () => {
    if (!offerEditor) return
    try {
      const values = await offerForm.validateFields()
      if (!dayjs(values.startsAt).isValid() || !dayjs(values.endsAt).isValid() || !dayjs(values.endsAt).isAfter(dayjs(values.startsAt))) throw new Error('結束時間必須晚於開始時間。')
      if (!Number.isFinite(values.unitPrice) || values.unitPrice <= 0 || Math.round(values.unitPrice * 100) !== values.unitPrice * 100) throw new Error('優惠價須大於 0，最多小數兩位。')
      if (values.audience === 'CODE' && !values.audienceCode?.trim()) throw new Error('活動限定代碼不可留空。')
      setSaving(true)
      const input = offerInput(values, offerEditor.offer?.isActive)
      if (offerEditor.offer) await b2bAdminService.updatePriceOffer(offerEditor.book.productId, offerEditor.offer.id, input)
      else await b2bAdminService.createPriceOffer(offerEditor.book.productId, input)
      setOfferEditor(null)
      message.success(offerEditor.offer ? '優惠價已更新' : '優惠價已建立')
      await reload()
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'errorFields' in reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const toggleOffer = async (book: B2BPriceBook, offer: B2BPriceOffer) => {
    try {
      setSaving(true)
      await b2bAdminService.updatePriceOffer(book.productId, offer.id, {
        entityId,
        unitPrice: Number(offer.unitPrice),
        startsAt: offer.startsAt,
        endsAt: offer.endsAt,
        audience: offer.audience,
        audienceCode: offer.audienceCode,
        isActive: !offer.isActive,
      })
      message.success(offer.isActive ? '優惠價已停用' : '優惠價已啟用')
      await reload()
    } catch (reason) { message.error(errorText(reason)) }
    finally { setSaving(false) }
  }

  const columns: ColumnsType<B2BPriceBook> = [
    { title: '商品', key: 'product', render: (_, book) => <><Text strong>{book.name}</Text><br /><Text type="secondary">{book.sku}</Text></> },
    { title: '品牌', dataIndex: 'brand', key: 'brand', render: (value: string | null) => value || '未設定' },
    { title: '稅別', dataIndex: 'taxBasis', key: 'taxBasis', render: (value: B2BPriceBook['taxBasis']) => value === 'TAX_INCLUDED' ? '含稅' : '未稅' },
    { title: '建議售價（牌價）', dataIndex: 'msrp', key: 'msrp', align: 'right', render: money },
    { title: '常態售價', dataIndex: 'regularPrice', key: 'regular', align: 'right', render: money },
    { title: '團購主進貨價（內部）', dataIndex: 'groupBuyPrice', key: 'groupBuy', align: 'right', render: money },
    { title: '活動價', key: 'offers', render: (_, book) => <Tag color="orange">{book.offers?.filter((offer) => offer.isActive).length || 0} 檔啟用</Tag> },
    { title: '既有登入入口', dataIndex: 'isPublished', key: 'published', render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '已發布' : '未發布'}</Tag> },
    { title: '免登入公開', dataIndex: 'isPublic', key: 'public', render: (value: boolean) => <Tag color={value ? 'blue' : 'default'}>{value ? '允許公開建議售價' : '不公開'}</Tag> },
    { title: '操作', key: 'actions', render: (_, book) => canWrite ? <Space wrap><Button size="small" onClick={() => openBook(book)}>編輯商品價目</Button><Button size="small" onClick={() => openOffer(book)}>新增活動價</Button></Space> : null },
  ]

  return <>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="公開商品入口啟用後，只有明確允許免登入公開、且已發布的商品會顯示建議售價。" description="常態價、團購主進貨價與活動價均為內部資料。團購主身分須先核實；批發／代理價格通常低於團購主進貨價，但正式成交價仍由業務確認。既有登入入口的發布設定不能單獨授權免登入公開。" />
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}><Input.Search placeholder="搜尋 SKU 或商品名稱" allowClear style={{ width: 280 }} onSearch={(value) => { setPage(1); setSearch(value.trim()) }} /><Space><Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>重新整理</Button>{canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={() => openBook()}>新增商品價目</Button> : null}</Space></div>
    {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
    <Table rowKey="productId" loading={loading} columns={columns} dataSource={books} scroll={{ x: 1100 }} pagination={{ current: page, pageSize, total, showSizeChanger: false, onChange: setPage, showTotal: (count) => `共 ${count} 項價目` }} expandable={{ expandedRowRender: (book) => <Table rowKey="id" size="small" pagination={false} dataSource={book.offers || []} locale={{ emptyText: '尚無活動價' }} columns={[
      { title: '單價', dataIndex: 'unitPrice', key: 'price', render: money },
      { title: '適用期間', key: 'period', render: (_, offer) => `${localTime(offer.startsAt)} ～ ${localTime(offer.endsAt)}` },
      { title: '活動條件', key: 'condition', render: (_, offer) => offer.audience === 'CODE' ? `活動代碼 ${offer.audienceCode || '—'}` : '所有符合期間者' },
      { title: '狀態', dataIndex: 'isActive', key: 'active', render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '啟用' : '停用'}</Tag> },
      { title: '操作', key: 'actions', render: (_, offer) => canWrite ? <Space><Button size="small" onClick={() => openOffer(book, offer)}>編輯</Button><Popconfirm title={offer.isActive ? '停用此優惠價？' : '啟用此優惠價？'} onConfirm={() => void toggleOffer(book, offer)}><Button size="small" disabled={saving}>{offer.isActive ? '停用' : '啟用'}</Button></Popconfirm></Space> : null },
    ]} /> }} />

    <Modal title="商品價目" open={bookOpen} confirmLoading={saving} onCancel={() => setBookOpen(false)} onOk={() => void saveBook()} okText="儲存價目" destroyOnHidden>
      <Form form={bookForm} layout="vertical">
        <Form.Item name="productId" label="商品" rules={[{ required: true, message: '請選擇商品' }]}><ProductSearchSelect entityId={entityId} enabled={bookOpen} selectedProduct={books.find((book) => book.productId === productId) ? { id: productId, sku: books.find((book) => book.productId === productId)!.sku, name: books.find((book) => book.productId === productId)!.name } : undefined} /></Form.Item>
        <Form.Item name="brand" label="品牌（選填，公開目錄篩選用）" rules={[{ max: 100, message: '品牌最多 100 字' }]}><AutoComplete options={brandOptions.map((brand) => ({ value: brand }))} filterOption={(input, option) => String(option?.value || '').toLocaleLowerCase().includes(input.toLocaleLowerCase())}><Input maxLength={100} placeholder="輸入品牌或選擇既有品牌；留空則不顯示" /></AutoComplete></Form.Item>
        <Form.Item name="taxBasis" label="價格稅別" rules={[{ required: true, message: '請選擇含稅或未稅' }]}><Select options={[{ value: 'TAX_INCLUDED', label: '含稅價' }, { value: 'TAX_EXCLUDED', label: '未稅價' }]} /></Form.Item>
        <Form.Item name="msrp" label={`建議售價（公開入口啟用後顯示；${bookTaxBasis === 'TAX_INCLUDED' ? '含稅' : bookTaxBasis === 'TAX_EXCLUDED' ? '未稅' : '請先選稅別'} TWD）`} rules={[{ required: true, message: '請填建議售價' }, { type: 'number', min: 0.01, max: 100000000, message: '請填有效價格' }]}><InputNumber min={0.01} precision={2} prefix="NT$" style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="regularPrice" label={`常態售價（選填；${bookTaxBasis === 'TAX_INCLUDED' ? '含稅' : bookTaxBasis === 'TAX_EXCLUDED' ? '未稅' : '請先選稅別'} TWD）`} rules={[{ type: 'number', min: 0.01, max: 100000000, message: '請填有效價格' }]}><InputNumber min={0.01} precision={2} prefix="NT$" style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="groupBuyPrice" label={`團購主進貨價（選填；${bookTaxBasis === 'TAX_INCLUDED' ? '含稅' : bookTaxBasis === 'TAX_EXCLUDED' ? '未稅' : '請先選稅別'} TWD）`} rules={[{ type: 'number', min: 0.01, max: 100000000, message: '請填有效價格' }]}><InputNumber min={0.01} precision={2} prefix="NT$" style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="isPublic" label="免登入公開顯示此商品（僅建議售價）" valuePropName="checked"><Switch /></Form.Item>
      </Form>
      <Text type="secondary">新商品預設不公開。免登入公開還需商品在「商品發布」頁已發布；團購主進貨價不會對外顯示。活動價請在儲存後另行設定期間。</Text>
    </Modal>

    <Modal title={`${offerEditor?.offer ? '編輯' : '新增'}活動價 · ${offerEditor?.book.name || ''}`} open={Boolean(offerEditor)} confirmLoading={saving} onCancel={() => setOfferEditor(null)} onOk={() => void saveOffer()} okText="儲存活動價" destroyOnHidden>
      <Form form={offerForm} layout="vertical">
        <Form.Item name="unitPrice" label={`活動單價（${offerEditor?.book.taxBasis === 'TAX_INCLUDED' ? '含稅' : '未稅'} TWD）`} rules={[{ required: true, message: '請填單價' }, { type: 'number', min: 0.01, max: 100000000, message: '請填有效價格' }]}><InputNumber min={0.01} precision={2} prefix="NT$" style={{ width: '100%' }} /></Form.Item>
        <Space style={{ width: '100%' }} size="middle"><Form.Item name="startsAt" label="開始時間" rules={[{ required: true, message: '請填開始時間' }]}><Input type="datetime-local" /></Form.Item><Form.Item name="endsAt" label="結束時間" rules={[{ required: true, message: '請填結束時間' }]}><Input type="datetime-local" /></Form.Item></Space>
        <Form.Item name="audience" label="活動適用對象" rules={[{ required: true }]}><Select options={[{ value: 'ALL', label: '符合期間者' }, { value: 'CODE', label: '指定活動代碼' }]} /></Form.Item>
        {audience === 'CODE' ? <Form.Item name="audienceCode" label="活動代碼" rules={[{ required: true, whitespace: true, message: '請填活動代碼' }]}><Input maxLength={100} placeholder="輸入活動代碼" /></Form.Item> : null}
      </Form>
      <Text type="secondary">時間依目前裝置的時區輸入；已出具的正式報價不受此處修改影響。</Text>
    </Modal>
  </>
}
