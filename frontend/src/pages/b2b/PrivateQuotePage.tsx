import { useEffect, useState } from 'react'
import BrandMark from '../../components/BrandMark'
import { b2bPrivateQuoteService } from '../../services/b2b-private-quote.service'
import type { B2BFormalQuote } from '../../services/b2b.service'
import './GuestShopPage.css'

const money = (value: string | number) => new Intl.NumberFormat('zh-TW', {
  style: 'currency', currency: 'TWD', maximumFractionDigits: 2,
}).format(Number(value) || 0)

function readFragmentToken(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = params.get('token')
  return token && /^[A-Za-z0-9_-]{40,100}$/.test(token) ? token : null
}

export default function PrivateQuotePage() {
  const [token, setToken] = useState(readFragmentToken)
  const [quote, setQuote] = useState<B2BFormalQuote | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(token))
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    // Fragments are not sent to the server. Remove the token from browser history
    // before any navigation or third-party resource can see the visible URL.
    if (window.location.hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
  }, [])

  useEffect(() => {
    if (!token) return
    let active = true
    b2bPrivateQuoteService.preview(token)
      .then((result) => { if (active) { setQuote(result); setError('') } })
      .catch(() => { if (active) setError('這份報價連結無效、已過期或已被新版取代，請聯絡業務索取新連結。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  const accept = async () => {
    if (!token || !quote || quote.status !== 'sent' || accepting) return
    setAccepting(true)
    setError('')
    try {
      const result = await b2bPrivateQuoteService.accept(token)
      setQuote(result)
      setToken(null)
    } catch {
      setError('目前無法確認這份報價；可能已過期或有新版。請重新開啟 Email 連結，或聯絡業務查核。')
    } finally { setAccepting(false) }
  }

  return <div className="guest-shop">
    <header className="guest-shop-header"><div className="guest-shop-brand"><BrandMark className="guest-shop-mark" alt="Corely" /><span>Corely <small>專屬報價</small></span></div><nav aria-label="頁面導覽"><a href="/b2b/shop">商品目錄</a></nav></header>
    <main className="guest-order-shell"><section className="guest-order-card" aria-labelledby="private-quote-title">
      <span className="guest-shop-kicker">PRIVATE QUOTATION</span>
      <h1 id="private-quote-title">專屬報價確認</h1>
      {!token && !quote ? <div className="guest-shop-notice guest-shop-notice-error" role="alert">此連結缺少驗證資料，請從業務寄出的 Email 開啟。</div> : null}
      {loading ? <p>正在核對報價版本…</p> : null}
      {error ? <div className="guest-shop-notice guest-shop-notice-error" role="alert">{error}</div> : null}
      {quote && !loading ? <>
        <p>請核對品項、數量、實際採購價及交期。只有您按下「確認接受」後，業務才能把此版本轉成 ERP 銷貨單。</p>
        <div className="guest-order-meta"><span>報價單：<strong>{quote.quotationNo}</strong></span><span>版本：<strong>V{quote.version}</strong></span><span>買方：<strong>{quote.buyerName}</strong></span><span>有效期限：<strong>{quote.validUntil || '依業務通知'}</strong></span></div>
        <div style={{ overflowX: 'auto' }}><table className="guest-order-table"><thead><tr><th scope="col">商品</th><th scope="col" className="guest-order-number">數量</th><th scope="col" className="guest-order-number">未稅單價</th><th scope="col" className="guest-order-number">含稅小計</th></tr></thead><tbody>{quote.items.map((item) => <tr key={item.requestItemId}><td><strong>{item.name}</strong><small>{item.sku}</small></td><td className="guest-order-number">{item.quantity}</td><td className="guest-order-number">{money(item.unitPrice)}</td><td className="guest-order-number">{money(item.total)}</td></tr>)}</tbody></table></div>
        <div className="guest-order-totals"><span>未稅金額 {money(quote.subtotal)}</span><span>稅額 {money(quote.tax)}</span><strong>合計 {money(quote.total)}</strong></div>
        <div className="guest-order-terms"><p>交期：{quote.deliveryDate || quote.deliveryTerms || '請洽業務'}</p>{quote.paymentTerms ? <p>付款條件：{quote.paymentTerms}</p> : null}{quote.deliveryDate && quote.deliveryTerms ? <p>交貨條件：{quote.deliveryTerms}</p> : null}</div>
        {quote.status === 'accepted' ? <div className="guest-order-bottom" role="status">已接受 V{quote.version} 報價。業務仍須確認接單；目前尚未建立銷貨單或預留庫存。</div> : quote.status === 'sent' ? <div className="guest-order-accept"><button type="button" disabled={accepting || Boolean(error)} onClick={() => void accept()}>{accepting ? '確認中…' : `確認接受 V${quote.version} 報價`}</button><p>確認後會留下接受時間與版次紀錄；若品項或價格需修改，請先與業務溝通，不要按確認。</p></div> : <div className="guest-order-bottom">此報價版本已失效，請聯絡業務取得最新版。</div>}
      </> : null}
    </section></main>
    <footer className="guest-shop-footer">Corely · 專屬報價確認</footer>
  </div>
}
