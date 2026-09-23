import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import BrandMark from '../../components/BrandMark'
import { b2bErrorMessage, b2bService, getB2BToken } from '../../services/b2b.service'
import type { B2BCatalog, B2BCatalogItem, B2BProfile, B2BRequestDetail } from '../../services/b2b.service'
import { buildRequestInput, quotePath, statusText } from './order'
import './B2BPortal.css'

const money = (amount: string | number) =>
  new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 2 })
    .format(Number(amount) || 0)

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

function PortalBrand() {
  return (
    <span className="b2b-brand">
      <BrandMark className="b2b-brand-mark" alt="Corely" />
      <span>Corely <small>客戶採購入口</small></span>
    </span>
  )
}

function ErrorNotice({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="b2b-error" role="alert">
      <span>{text}</span>
      {onRetry ? <button className="b2b-text-button" type="button" onClick={onRetry}>重試</button> : null}
      {!getB2BToken() ? <Link to="/b2b/login">重新登入</Link> : null}
    </div>
  )
}

export function B2BLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [companyCode, setCompanyCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await b2bService.login(companyCode, email, password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from?.startsWith('/b2b/') && from !== '/b2b/login' ? from : '/b2b/catalog', { replace: true })
    } catch (reason) {
      setError(b2bErrorMessage(reason, '登入失敗，請檢查公司代碼、電子郵件與密碼。', '公司代碼、電子郵件或密碼不正確。'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="b2b b2b-login-screen">
      <div className="b2b-login-intro">
        <PortalBrand />
        <h1>採購更清楚，<br />每一筆需求都有紀錄。</h1>
        <p>登入後查看貴公司的商品價格、送出採購需求，並追蹤線上報價與人工核對進度。</p>
        <div className="b2b-steps"><span>01 選擇商品</span><span>02 送出需求</span><span>03 人員確認庫存與交期</span></div>
      </div>
      <section className="b2b-login-card" aria-labelledby="b2b-login-title">
        <span className="b2b-eyebrow">CUSTOMER ACCESS</span>
        <h2 id="b2b-login-title">客戶登入</h2>
        <p>請使用 Corely 提供的公司代碼及專屬帳號。</p>
        <form onSubmit={submit}>
          <label>公司代碼<input required autoComplete="organization" value={companyCode} onChange={(event) => setCompanyCode(event.target.value)} placeholder="例如公司代碼" /></label>
          <label>電子郵件<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label>
          <label>密碼<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="輸入密碼" /></label>
          {error ? <ErrorNotice text={error} /> : null}
          <button type="submit" className="b2b-primary-button" disabled={submitting}>{submitting ? '登入中…' : '登入客戶入口'}</button>
        </form>
        <p className="b2b-login-help">尚未取得帳號或需要重設密碼，請洽您的業務窗口。</p>
      </section>
    </main>
  )
}

export function B2BPortalLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<B2BProfile | null>(null)
  const [checking, setChecking] = useState(Boolean(getB2BToken()))

  useEffect(() => {
    let mounted = true
    if (!getB2BToken()) return
    b2bService.me()
      .then((value) => { if (mounted) setProfile(value) })
      .catch(() => { if (mounted) setProfile(null) })
      .finally(() => { if (mounted) setChecking(false) })
    return () => { mounted = false }
  }, [])

  if (checking) return <main className="b2b b2b-loading">正在確認客戶登入…</main>
  if (!profile) return <Navigate to="/b2b/login" state={{ from: location.pathname }} replace />

  const logout = async () => {
    try { await b2bService.logout() } catch { /* The local session is cleared even if the server is unavailable. */ }
    navigate('/b2b/login', { replace: true })
  }

  return (
    <div className="b2b b2b-shell">
      <header className="b2b-header">
        <Link to="/b2b/catalog" className="b2b-brand-link"><PortalBrand /></Link>
        <nav aria-label="客戶入口導覽"><Link to="/b2b/catalog">商品選購</Link><Link to="/b2b/requests">我的採購需求</Link></nav>
        <div className="b2b-account"><span>{profile.customerName || profile.companyName}<small>{profile.name}</small></span><button type="button" onClick={() => void logout()}>登出</button></div>
      </header>
      <Outlet context={profile} />
      <footer className="b2b-footer">Corely 客戶採購入口 · 商品、價格與採購資料僅供貴公司帳號查閱</footer>
    </div>
  )
}

export function B2BCatalogPage() {
  const profile = useOutletContext<B2BProfile>()
  const navigate = useNavigate()
  const requestId = useRef<string | null>(null)
  const [catalog, setCatalog] = useState<B2BCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [customerPoNumber, setCustomerPoNumber] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    b2bService.catalog()
      .then(setCatalog)
      .catch((reason) => setError(b2bErrorMessage(reason, '無法載入專屬商品，請稍後重試。')))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    b2bService.catalog()
      .then(setCatalog)
      .catch((reason) => setError(b2bErrorMessage(reason, '無法載入專屬商品，請稍後重試。')))
      .finally(() => setLoading(false))
  }, [])

  const visibleItems = useMemo(() => (catalog?.items || []).filter((item) =>
    `${item.name} ${item.sku} ${item.description || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ), [catalog, search])
  const selectedItems = (catalog?.items || []).filter((item) => (quantities[item.productId] || 0) > 0)
  const subtotal = selectedItems.reduce((sum, item) => sum + Number(item.unitPrice) * quantities[item.productId], 0)
  const estimatedTax = subtotal * Number(catalog?.taxRate || 0) / 100

  const updateQuantity = (item: B2BCatalogItem, value: string) => {
    setQuantities((current) => ({ ...current, [item.productId]: value === '' ? 0 : Number(value) }))
    setSubmitError('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || !catalog) return
    setSubmitError('')
    try {
      if (!requestId.current) requestId.current = crypto.randomUUID()
      const input = buildRequestInput(requestId.current, customerPoNumber, note, quantities, catalog.items)
      setSubmitting(true)
      const saved = await b2bService.submitRequest(input)
      requestId.current = null
      navigate(quotePath(saved.id))
    } catch (reason) {
      setSubmitError(reason instanceof Error && !('response' in reason)
        ? reason.message
        : b2bErrorMessage(reason, '採購需求送出失敗，請稍後重試。'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="b2b-main">
      <div className="b2b-heading"><span className="b2b-eyebrow">PRODUCT CATALOG</span><h1>{profile.customerName} 的專屬商品</h1><p>此頁顯示貴公司可採購的商品與專屬價格。庫存與交期由人員在收到需求後確認。</p></div>
      <div className="b2b-catalog-layout">
        <section className="b2b-catalog-list" aria-label="可採購商品">
          <div className="b2b-section-head"><div><h2>商品目錄</h2><p>{catalog ? `共 ${catalog.items.length} 項可採購商品` : '載入中'}</p></div><input className="b2b-search" type="search" placeholder="搜尋商品名稱或 SKU" aria-label="搜尋商品" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="b2b-stock-hint"><strong>庫存由人員核對</strong><span>送出需求後，業務會確認實際可供數量與交期，再與您聯繫。</span></div>
          {loading ? <div className="b2b-empty">正在載入商品…</div> : null}
          {error ? <ErrorNotice text={error} onRetry={load} /> : null}
          {!loading && !error && !visibleItems.length ? <div className="b2b-empty">{catalog?.items.length ? '找不到符合的商品。' : '目前尚無可採購商品，請聯繫業務窗口。'}</div> : null}
          <div className="b2b-products">
            {visibleItems.map((item) => <article className="b2b-product" key={item.productId}>
              <div className="b2b-product-icon">{item.name.slice(0, 1)}</div>
              <div className="b2b-product-info"><span className="b2b-sku">{item.sku}</span><h3>{item.name}</h3>{item.description ? <p>{item.description}</p> : null}</div>
              <div className="b2b-product-buy"><strong>{money(item.unitPrice)}</strong><small>貴公司專屬單價</small><label>數量<input type="number" min="0" step="1" inputMode="numeric" value={quantities[item.productId] ?? 0} onChange={(event) => updateQuantity(item, event.target.value)} aria-label={`${item.name} 採購數量`} /></label></div>
            </article>)}
          </div>
        </section>
        <aside className="b2b-cart" aria-labelledby="b2b-cart-title">
          <h2 id="b2b-cart-title">本次採購需求 <span>{selectedItems.length}</span></h2>
          {selectedItems.length ? <div className="b2b-cart-lines">{selectedItems.map((item) => <div key={item.productId}><span>{item.name}<small>{item.sku} · {quantities[item.productId]} 件</small></span><strong>{money(Number(item.unitPrice) * quantities[item.productId])}</strong></div>)}</div> : <p className="b2b-cart-empty">請在商品目錄輸入採購數量。</p>}
          <div className="b2b-totals"><div><span>商品小計</span><strong>{money(subtotal)}</strong></div><div><span>稅額試算 {catalog?.taxRate || '5'}%</span><strong>{money(estimatedTax)}</strong></div><div className="b2b-grand-total"><span>暫估總額</span><strong>{money(subtotal + estimatedTax)}</strong></div></div>
          <form onSubmit={submit} className="b2b-cart-form"><label>貴公司採購單號 <span>*</span><input required maxLength={80} value={customerPoNumber} onChange={(event) => setCustomerPoNumber(event.target.value)} placeholder="請輸入採購單號" /></label><label>備註／希望交期<textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如希望送達日期、收貨需求" /></label>{submitError ? <ErrorNotice text={submitError} /> : null}<button className="b2b-primary-button" type="submit" disabled={submitting || !selectedItems.length}>{submitting ? '送出中…' : '送出採購需求'}</button></form>
          <p className="b2b-cart-footnote">送出後會產生線上報價連結。金額為目前價格試算，供貨、數量與交期需由人員確認。</p>
        </aside>
      </div>
    </main>
  )
}

export function B2BRequestsPage() {
  const [requests, setRequests] = useState<B2BRequestDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = () => {
    setLoading(true)
    setError('')
    b2bService.requests().then(setRequests)
      .catch((reason) => setError(b2bErrorMessage(reason, '無法載入採購需求，請稍後重試。')))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    b2bService.requests().then(setRequests)
      .catch((reason) => setError(b2bErrorMessage(reason, '無法載入採購需求，請稍後重試。')))
      .finally(() => setLoading(false))
  }, [])
  return <main className="b2b-main b2b-narrow"><div className="b2b-heading"><span className="b2b-eyebrow">PURCHASE REQUESTS</span><h1>我的採購需求</h1><p>查看貴公司的採購需求及每筆線上報價。</p></div><div className="b2b-section-head"><h2>需求紀錄</h2><Link className="b2b-outline-button" to="/b2b/catalog">選購商品</Link></div>{loading ? <div className="b2b-empty">正在載入需求…</div> : null}{error ? <ErrorNotice text={error} onRetry={load} /> : null}{!loading && !error && !requests.length ? <div className="b2b-empty">尚未建立採購需求。<Link to="/b2b/catalog">前往商品目錄</Link></div> : null}<div className="b2b-request-list">{requests.map((request) => <Link className="b2b-request-card" to={quotePath(request.id)} key={request.id}><div><span className="b2b-sku">{request.requestNumber}</span><h3>採購單號：{request.customerPoNumber}</h3><small>{dateTime(request.createdAt)} · {request.items.length} 項商品</small></div><div><span className={`b2b-status b2b-status--${request.status}`}>{request.salesOrderId ? '已確認接單' : statusText[request.status]}</span><strong>{money(request.total)}</strong></div></Link>)}</div></main>
}

export function B2BRequestDetailPage() {
  const { id } = useParams()
  const [result, setResult] = useState<{ id: string; request?: B2BRequestDetail; error?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!id) return
    let active = true
    b2bService.request(id)
      .then((request) => { if (active) setResult({ id, request }) })
      .catch((reason) => { if (active) setResult({ id, error: b2bErrorMessage(reason, '找不到這筆採購需求，或無權查看。') }) })
    return () => { active = false }
  }, [id])
  if (!result || result.id !== id) return <main className="b2b-main b2b-narrow"><div className="b2b-empty">正在載入報價…</div></main>
  if (result.error || !result.request) return <main className="b2b-main b2b-narrow"><ErrorNotice text={result.error || '找不到這筆採購需求。'} /><Link to="/b2b/requests">返回需求紀錄</Link></main>
  const request = result.request

  const link = `${window.location.origin}${quotePath(request.id)}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true) }
    catch { setCopied(false) }
  }

  return <main className="b2b-main b2b-narrow">
    <Link className="b2b-back-link" to="/b2b/requests">← 返回我的採購需求</Link>
    <div className="b2b-detail-top"><div><span className="b2b-eyebrow">ONLINE QUOTE</span><h1>線上報價與採購需求</h1><p>需求編號 {request.requestNumber} · 建立於 {dateTime(request.createdAt)}</p></div><span className={`b2b-status b2b-status--${request.status}`}>{request.salesOrderId ? '已確認接單' : statusText[request.status]}</span></div>
    <div className="b2b-review-banner"><strong>{request.salesOrderId ? '已確認接單' : request.status === 'stock_confirmed' ? '庫存已核對' : request.status === 'needs_adjustment' ? '此需求需要調整' : '等待人工確認'}</strong><span>{request.salesOrderId ? '業務已確認接單，後續出貨資訊請與業務窗口聯繫。' : request.status === 'pending_stock_review' ? '此單尚未保留庫存，也尚未確認交期。業務人員會核對後與您聯繫。' : request.reviewNote || '請與業務窗口確認最終供貨與交期。'}</span></div>
    <section className="b2b-detail-card"><div className="b2b-detail-grid"><div><small>貴公司採購單號</small><strong>{request.customerPoNumber}</strong></div><div><small>報價／需求編號</small><strong>{request.requestNumber}</strong></div><div><small>預計交期</small><strong>{request.deliveryDate || '待確認'}</strong></div><div><small>確認時間</small><strong>{request.reviewedAt ? dateTime(request.reviewedAt) : '待確認'}</strong></div></div>{request.salesOrderId ? <div className="b2b-detail-note"><small>ERP 銷售訂單 ID</small><strong>{request.salesOrderId}</strong></div> : null}<h2>商品明細</h2><div className="b2b-detail-items">{request.items.map((item) => <div key={item.id}><span><strong>{item.name}</strong><small>{item.sku} · 申購 {item.quantity} 件{item.confirmedQuantity !== null ? ` · 確認 ${item.confirmedQuantity} 件` : ''}</small></span><span>{money(item.unitPrice)} / 件</span><strong>{money(item.lineTotal)}</strong></div>)}</div><div className="b2b-detail-totals"><div><span>商品小計</span><strong>{money(request.subtotal)}</strong></div><div><span>稅額</span><strong>{money(request.tax)}</strong></div><div className="b2b-grand-total"><span>總額</span><strong>{money(request.total)}</strong></div></div>{request.note ? <div className="b2b-detail-note"><small>採購備註</small><p>{request.note}</p></div> : null}{request.reviewNote ? <div className="b2b-detail-note"><small>業務回覆</small><p>{request.reviewNote}</p></div> : null}</section>
    <section className="b2b-share-card"><div><h2>分享線上報價</h2><p>此連結可貼到 LINE 討論；收件人仍須使用貴公司的客戶帳號登入，才能查看內容。</p></div><div className="b2b-share-actions"><input aria-label="線上報價連結" readOnly value={link} onFocus={(event) => event.target.select()} /><button className="b2b-outline-button" type="button" onClick={() => void copy()}>{copied ? '已複製' : '複製連結'}</button></div></section>
  </main>
}
