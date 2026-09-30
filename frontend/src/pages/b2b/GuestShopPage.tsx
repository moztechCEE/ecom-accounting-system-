import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import BrandMark from '../../components/BrandMark'
import { b2bPublicService, publicB2bError } from '../../services/b2b-public.service'
import type { PublicCatalogFacets, PublicCatalogItem, GuestRequestInput, GuestRequestReceipt } from '../../services/b2b-public.service'
import './GuestShopPage.css'

const entityId = window.__APP_CONFIG__?.defaultEntityId?.trim() || import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'
const pageSize = 24
const money = (value: string | number) => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 2 }).format(Number(value) || 0)
type CartLine = { product: PublicCatalogItem; quantity: number }
type Contact = { companyName: string; contactName: string; contactEmail: string; contactPhone: string; customerPoNumber: string; note: string }
const emptyContact: Contact = { companyName: '', contactName: '', contactEmail: '', contactPhone: '', customerPoNumber: '', note: '' }

export default function GuestShopPage() {
  const [products, setProducts] = useState<PublicCatalogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState('')
  const [facets, setFacets] = useState<PublicCatalogFacets>({ brands: [], categories: [] })
  const [loading, setLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [contact, setContact] = useState<Contact>(emptyContact)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [receipt, setReceipt] = useState<GuestRequestReceipt | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const requestId = useRef(crypto.randomUUID())
  const lastAttemptPayload = useRef<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    b2bPublicService.catalogFacets(entityId)
      .then((result) => { if (active) setFacets(result) })
      .catch(() => { if (active) setFacets({ brands: [], categories: [] }) })
    return () => { active = false }
  }, [refresh])

  useEffect(() => {
    let active = true
    setLoading(true)
    setCatalogError('')
    b2bPublicService.catalog(entityId, { search, brand: brand || undefined, category: category || undefined, limit: pageSize, offset: (page - 1) * pageSize })
      .then((result) => { if (active) { setProducts(result.items); setTotal(result.total) } })
      .catch((reason) => { if (active) { setProducts([]); setCatalogError(publicB2bError(reason, '無法讀取公開商品，請稍後再試。')) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [page, search, brand, category, refresh])

  const lines = useMemo(() => Object.values(cart), [cart])
  const referenceBasis = lines.length && lines.every((line) => line.product.taxBasis === lines[0].product.taxBasis) ? lines[0].product.taxBasis : null
  const referenceTotal = lines.reduce((sum, line) => sum + Number(line.product.msrp) * line.quantity, 0)
  const maxPage = Math.max(1, Math.ceil(total / pageSize))

  const changeQuantity = (product: PublicCatalogItem, quantity: number) => {
    setReceipt(null)
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000) return
    setCart((current) => {
      const next = { ...current }
      if (quantity === 0) delete next[product.productId]
      else next[product.productId] = { product, quantity }
      return next
    })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setSubmitError('')
    const companyName = contact.companyName.trim()
    const contactName = contact.contactName.trim()
    const contactEmail = contact.contactEmail.trim().toLowerCase()
    if (!companyName || !contactName || !contactEmail || !/^\S+@\S+\.\S+$/.test(contactEmail)) {
      setSubmitError('請填寫公司、聯絡人與有效電子郵件。')
      return
    }
    if (!lines.length || lines.length > 100 || lines.some((line) => !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000)) {
      setSubmitError('請選擇 1 至 100 項商品，每項數量為 1 至 1,000。')
      return
    }
    const payload: Omit<GuestRequestInput, 'requestId'> = {
        entityId,
        companyName,
        contactName,
        contactEmail,
        ...(contact.contactPhone.trim() ? { contactPhone: contact.contactPhone.trim() } : {}),
        ...(contact.customerPoNumber.trim() ? { customerPoNumber: contact.customerPoNumber.trim() } : {}),
        ...(contact.note.trim() ? { note: contact.note.trim() } : {}),
        items: lines.map((line) => ({ productId: line.product.productId, quantity: line.quantity })),
    }
    const fingerprint = JSON.stringify(payload)
    // A replay with unchanged content keeps the idempotency key. Changed content gets a new key.
    if (lastAttemptPayload.current !== null && lastAttemptPayload.current !== fingerprint) requestId.current = crypto.randomUUID()
    lastAttemptPayload.current = fingerprint
    try {
      setSubmitting(true)
      const result = await b2bPublicService.submitRequest({ ...payload, requestId: requestId.current })
      setReceipt(result)
      setCopyStatus('')
      setCart({})
      setContact(emptyContact)
      requestId.current = crypto.randomUUID()
      lastAttemptPayload.current = null
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (reason) {
      setSubmitError(`${publicB2bError(reason, '需求送出失敗，請稍後再試。')} 若結果不明，請保留此頁重試；內容未改會沿用同一提交編號，修改內容則使用新編號。`)
    } finally { setSubmitting(false) }
  }

  const copyOrderLink = async () => {
    if (!receipt) return
    const url = new URL(receipt.orderUrl, window.location.origin).toString()
    try {
      await navigator.clipboard.writeText(url)
      setCopyStatus('已複製連結，可以貼到 LINE 群組討論。')
    } catch {
      setCopyStatus('瀏覽器無法自動複製；請開啟採購單後複製網址。')
    }
  }

  return <div className="guest-shop">
    <header className="guest-shop-header">
      <div className="guest-shop-brand"><BrandMark className="guest-shop-mark" alt="Corely" /><span>Corely <small>商品採購</small></span></div>
      <nav aria-label="頁面導覽"><a href="#products">商品目錄</a><a href="#cart">採購車 <span>{lines.length}</span></a></nav>
    </header>

    <main>
      <section className="guest-shop-hero">
        <div className="guest-shop-hero-inner"><p className="guest-shop-kicker">CORELY PRODUCT CATALOG</p><h1>找到需要的商品，<br />建立採購單。</h1><p>依品牌、類別或關鍵字選品，填入數量即可產生待確認採購單。公開頁只顯示建議售價；業務核庫並與您確認後，才會提供專屬價格與正式版本。</p><a href="#products" className="guest-shop-hero-action">瀏覽商品 <span aria-hidden>↗</span></a></div>
        <div className="guest-shop-hero-panel" aria-hidden><span>01</span><strong>選商品</strong><span>02</span><strong>建立採購單</strong><span>03</span><strong>雙方確認</strong></div>
      </section>

      {receipt ? <section className="guest-shop-receipt" role="status"><div><span>待確認採購單已建立</span><h2>我們已收到您的採購品項</h2><p>採購單編號：<strong>{receipt.reference}</strong></p><p>此連結只顯示品項、數量與建議售價，可先在 LINE 與業務討論。專屬價格會在核對顧客與庫存後另行提供；目前尚未成立銷貨單，也未預留庫存。</p><div className="guest-shop-receipt-actions"><a href={receipt.orderUrl}>查看採購單</a><button type="button" onClick={() => void copyOrderLink()}>複製採購單連結</button><button type="button" onClick={() => setReceipt(null)}>繼續選購</button></div>{copyStatus ? <p role="status">{copyStatus}</p> : null}</div></section> : null}

      <div className="guest-shop-content">
        <section id="products" className="guest-shop-products" aria-labelledby="guest-shop-products-title">
          <div className="guest-shop-section-head"><div><span className="guest-shop-kicker">CATALOG</span><h2 id="guest-shop-products-title">商品目錄</h2><p>可瀏覽已公開上架的商品；頁面只顯示建議售價，正式採購價由業務核對後提供。</p></div><form role="search" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchText.trim()) }}><input aria-label="搜尋 SKU 或商品名稱" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜尋商品名稱或 SKU" /><button type="submit">搜尋</button></form></div>
          <div className="guest-shop-filters"><label>品牌<select aria-label="依品牌篩選" value={brand} onChange={(event) => { setPage(1); setBrand(event.target.value) }}><option value="">全部品牌</option>{facets.brands.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>分類<select aria-label="依商品分類篩選" value={category} onChange={(event) => { setPage(1); setCategory(event.target.value) }}><option value="">全部分類</option>{facets.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>{brand || category || search ? <button type="button" onClick={() => { setBrand(''); setCategory(''); setSearch(''); setSearchText(''); setPage(1) }}>清除篩選</button> : null}</div>
          {catalogError ? <div className="guest-shop-notice guest-shop-notice-error" role="alert">{catalogError}<button type="button" onClick={() => setRefresh((current) => current + 1)}>重試</button></div> : null}
          {loading ? <div className="guest-shop-placeholder">正在載入商品…</div> : !catalogError && !products.length ? <div className="guest-shop-placeholder">目前沒有符合條件的公開商品。</div> : null}
          <div className="guest-shop-grid">{products.map((product) => <article className="guest-shop-product" key={product.productId}>
            <div className="guest-shop-product-visual" aria-hidden>{product.name.slice(0, 1)}</div>
            <div className="guest-shop-product-body"><span className="guest-shop-sku">{product.sku}</span><h3>{product.name}</h3><p>{[product.brand, product.category].filter(Boolean).join(' · ') || '商品'}</p><div className="guest-shop-product-bottom"><div><small>建議售價 · {product.taxBasis === 'TAX_INCLUDED' ? '含稅' : '未稅'}</small><strong>{money(product.msrp)}</strong></div><label><span className="guest-shop-sr-only">{product.name} 採購數量</span><input type="number" min="0" max="1000" step="1" value={cart[product.productId]?.quantity ?? 0} onChange={(event) => changeQuantity(product, Number(event.target.value))} /></label></div></div>
          </article>)}</div>
          {!catalogError && total > pageSize ? <div className="guest-shop-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一頁</button><span>第 {page}／{maxPage} 頁 · 共 {total} 項</span><button type="button" disabled={page >= maxPage || loading} onClick={() => setPage((value) => value + 1)}>下一頁</button></div> : null}
        </section>

        <aside id="cart" className="guest-shop-cart" aria-labelledby="guest-shop-cart-title">
          <div className="guest-shop-cart-head"><span className="guest-shop-kicker">YOUR REQUEST</span><h2 id="guest-shop-cart-title">採購車 <span>{lines.length}</span></h2><p>送出後由人員核實身分、庫存與實際價格。</p></div>
          {!lines.length ? <div className="guest-shop-empty-cart">先從左側商品目錄選擇數量。</div> : <><div className="guest-shop-cart-lines">{lines.map((line) => <div key={line.product.productId}><div><strong>{line.product.name}</strong><small>{line.product.sku} · {line.quantity} 件</small></div><button type="button" aria-label={`移除 ${line.product.name}`} onClick={() => changeQuantity(line.product, 0)}>移除</button></div>)}</div>{referenceBasis ? <div className="guest-shop-reference"><span>建議售價參考合計（{referenceBasis === 'TAX_INCLUDED' ? '含稅' : '未稅'}）</span><strong>{money(referenceTotal)}</strong></div> : <p className="guest-shop-mixed-tax">品項稅別不同，請依各商品參考價查看；正式金額以報價單為準。</p>}</>}
          <form onSubmit={(event) => void submit(event)} className="guest-shop-form">
            <h3>聯絡與採購資訊</h3>
            <label>公司／商號名稱 <span>*</span><input required maxLength={120} autoComplete="organization" value={contact.companyName} onChange={(event) => setContact((current) => ({ ...current, companyName: event.target.value }))} /></label>
            <label>聯絡人 <span>*</span><input required maxLength={80} autoComplete="name" value={contact.contactName} onChange={(event) => setContact((current) => ({ ...current, contactName: event.target.value }))} /></label>
            <label>電子郵件 <span>*</span><input required type="email" maxLength={254} autoComplete="email" value={contact.contactEmail} onChange={(event) => setContact((current) => ({ ...current, contactEmail: event.target.value }))} /></label>
            <label>電話（選填）<input type="tel" maxLength={40} autoComplete="tel" value={contact.contactPhone} onChange={(event) => setContact((current) => ({ ...current, contactPhone: event.target.value }))} /></label>
            <label>貴公司採購單號（選填）<input maxLength={100} value={contact.customerPoNumber} onChange={(event) => setContact((current) => ({ ...current, customerPoNumber: event.target.value }))} /></label>
            <label>補充需求（選填）<textarea rows={3} maxLength={1000} value={contact.note} onChange={(event) => setContact((current) => ({ ...current, note: event.target.value }))} /></label>
            {submitError ? <div className="guest-shop-notice guest-shop-notice-error" role="alert">{submitError}</div> : null}
            <button type="submit" className="guest-shop-submit" disabled={!lines.length || submitting}>{submitting ? '建立中…' : '建立待確認採購單'}</button>
            <p>建立後會產生可查看品項的採購單連結。這仍是待確認需求，尚非正式銷貨單；建議售價僅供參考。</p>
          </form>
        </aside>
      </div>
    </main>
    <footer className="guest-shop-footer">Corely · 商品採購需求入口</footer>
  </div>
}
