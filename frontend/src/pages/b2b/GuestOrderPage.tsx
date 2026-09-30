import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import BrandMark from '../../components/BrandMark'
import { b2bPublicService, publicB2bError } from '../../services/b2b-public.service'
import type { GuestOrderSummary } from '../../services/b2b-public.service'
import './GuestShopPage.css'

const money = (value: string | number) => new Intl.NumberFormat('zh-TW', {
  style: 'currency', currency: 'TWD', maximumFractionDigits: 2,
}).format(Number(value) || 0)

export default function GuestOrderPage() {
  const { reference = '' } = useParams()
  const [result, setResult] = useState<{ reference: string; order?: GuestOrderSummary; error?: string } | null>(null)
  const validReference = /^G-[0-9A-F]{24}$/.test(reference)
  const current = result?.reference === reference ? result : null
  const order = current?.order || null
  const error = !validReference ? '採購單連結無效。' : current?.error || ''
  const loading = validReference && !current

  useEffect(() => {
    if (!validReference) return
    let active = true
    b2bPublicService.guestOrder(reference)
      .then((order) => { if (active) setResult({ reference, order }) })
      .catch((reason) => { if (active) setResult({ reference, error: publicB2bError(reason, '找不到此採購單，可能已過期或被取消。') }) })
    return () => { active = false }
  }, [reference, validReference])

  const sameTaxBasis = useMemo(() => order?.items.length && order.items.every((item) => item.taxBasis === order.items[0].taxBasis), [order])
  const referenceTotal = useMemo(() => order?.items.reduce((sum, item) => sum + Number(item.lineTotal), 0) || 0, [order])

  return <div className="guest-shop">
    <header className="guest-shop-header"><div className="guest-shop-brand"><BrandMark className="guest-shop-mark" alt="Corely" /><span>Corely <small>商品採購</small></span></div><nav aria-label="頁面導覽"><a href="/b2b/shop">商品目錄</a></nav></header>
    <main className="guest-order-shell"><a href="/b2b/shop">← 返回商品目錄</a><section className="guest-order-card" aria-labelledby="guest-order-title">
      <span className="guest-shop-kicker">PURCHASE REQUEST</span>
      <h1 id="guest-order-title">待確認採購單</h1>
      {loading ? <p>正在載入採購單…</p> : error ? <div className="guest-shop-notice guest-shop-notice-error" role="alert">{error}</div> : order ? <>
        <p>這是您送出的採購品項與當時建議售價，供雙方核對。業務核實庫存、交期與專屬價格後，會另行提供確認版本。</p>
        <div className="guest-order-meta"><span>編號：<strong>{order.reference}</strong></span><span>送出時間：<strong>{new Date(order.createdAt).toLocaleString('zh-TW')}</strong></span><span>狀態：<strong>{order.status === 'MATCHED' ? '已核實顧客，業務處理中' : '待業務核對'}</strong></span></div>
        <div style={{ overflowX: 'auto' }}><table className="guest-order-table"><thead><tr><th scope="col">商品</th><th scope="col" className="guest-order-number">數量</th><th scope="col" className="guest-order-number">建議售價</th><th scope="col" className="guest-order-number">參考小計</th></tr></thead><tbody>{order.items.map((item) => <tr key={item.sku}><td><strong>{item.name}</strong><small>{item.sku}</small></td><td className="guest-order-number">{item.quantity}</td><td className="guest-order-number">{money(item.msrp)}<small>{item.taxBasis === 'TAX_INCLUDED' ? '含稅' : '未稅'}</small></td><td className="guest-order-number">{money(item.lineTotal)}</td></tr>)}</tbody></table></div>
        {sameTaxBasis ? <p style={{ textAlign: 'right', fontWeight: 750 }}>建議售價參考合計（{order.items[0].taxBasis === 'TAX_INCLUDED' ? '含稅' : '未稅'}）：{money(referenceTotal)}</p> : <p>商品稅別不同，請分別參考各品項金額；正式金額以確認版報價為準。</p>}
        <div className="guest-order-bottom">此頁只顯示建議售價，不顯示專屬價格或顧客資料。這份採購單尚未成立 ERP 銷貨單，也未預留或扣除庫存。請與業務在既有 LINE 群組討論缺貨與修改事項；確認版將由人員另行提供。</div>
      </> : null}
    </section></main>
    <footer className="guest-shop-footer">Corely · 採購單查詢</footer>
  </div>
}
