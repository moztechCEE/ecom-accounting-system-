import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Select } from 'antd';
import { useAuth } from '../../contexts/AuthContext';
import { nativeAfterSales, type NativeCaseDetail } from '../../services/native-after-sales.service';
import { registrationTokenMatchesActor } from './pending-registration';
import { operationRequestIntent } from './operation-request-intent';
import { clearPendingBrandReview, pendingBrandReviewKey, readPendingBrandReview, savePendingBrandReview, type PendingBrandReview } from './pending-brand-review';
export default function NativeLegacyBrandReview({ entityId, detail, onReload, onPendingChange, onDirtyChange }: {
  entityId: string; detail: NativeCaseDetail; onReload: () => void; onPendingChange: (v: boolean) => void; onDirtyChange: (v: boolean) => void;
}) {
  const { user } = useAuth(), scope = { actorId: user?.id || '', entityId, caseId: detail.id }, scopeKey = JSON.stringify(scope);
  const current = useRef(scopeKey); current.current = scopeKey;
  const alive = useRef(true), running = useRef(false), abort = useRef<AbortController | null>(null);
  const [form] = Form.useForm(), [open, setOpen] = useState(false), [pending, setPending] = useState<PendingBrandReview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    alive.current = true; running.current = false; setOpen(false); setBusy(false); setError('');
    try { const saved = readPendingBrandReview(localStorage, scope); setPending(saved); onPendingChange(!!saved); if (saved) setError('案件品牌確認結果待核對'); } catch (e) { setError((e as Error).message); onPendingChange(true); }
    return () => { alive.current = false; abort.current?.abort(); };
  }, [scopeKey]);
  async function confirm() {
    if (running.current || !scope.actorId || !entityId || !detail.updatedAt || !pending && detail.canConfirmBrand !== true) return;
    const key = scopeKey, token = localStorage.getItem('access_token') || '', controller = new AbortController(); abort.current = controller;
    const active = () => alive.current && current.current === key && registrationTokenMatchesActor(token, scope.actorId) && localStorage.getItem('access_token') === token;
    running.current = true; setBusy(true); setError(''); let saved: PendingBrandReview | null = pending;
    try {
      if (!active() || !navigator.locks) throw new Error('登入狀態已變更，品牌確認尚未送出');
      const values = pending ? pending.request : await form.validateFields();
      await navigator.locks.request(pendingBrandReviewKey(scope), { mode: 'exclusive', signal: controller.signal }, async () => {
        if (!active()) throw new Error('登入狀態已變更，品牌確認尚未送出');
        saved = readPendingBrandReview(localStorage, scope);
        if (!saved) {
          saved = { ...scope, schema: 'corely.doa.pending-brand-review.v1', request: { operation: 'BIND_LEGACY_BRAND', requestId: crypto.randomUUID(), expectedUpdatedAt: detail.updatedAt!, brand: values.brand, proofReference: String(values.proofReference).trim() } };
          savePendingBrandReview(localStorage, saved);
        }
        setPending(saved); onPendingChange(true); onDirtyChange(true);
        if (!active()) throw new Error('登入狀態已變更，請以相同請求重新核對');
        operationRequestIntent('after_sales.brand_review.request', saved.request.requestId, detail.id);
        const result = await nativeAfterSales.command(entityId, detail.id, 'brand-review', saved.request, { token, expectedActorId: scope.actorId, signal: controller.signal });
        if (!active()) return;
        if (result.reviewId !== 'brand-review-' + saved.request.requestId || result.caseId !== detail.id || result.brand !== saved.request.brand) throw new Error('品牌確認回執待核對，請以相同請求重試');
        clearPendingBrandReview(localStorage, saved); setPending(null); setOpen(false); onPendingChange(false); onDirtyChange(false); onReload();
      });
    } catch (e) {
      if (alive.current && current.current === key) { const value = (e as any)?.response?.data?.message; setError(typeof value === 'string' ? value : (e as Error).message || '品牌確認結果待核對'); if (saved) setPending(saved); onPendingChange(!!saved); }
    } finally { if (alive.current && current.current === key) { running.current = false; setBusy(false); } }
  }
  if (!detail.canConfirmBrand && !pending && !error) return null;
  return <div className="native-legacy-brand-review">
    {error && <Alert type="error" message={error} showIcon />}
    <Button data-operation-action="after_sales.brand_review.open" disabled={busy || !!pending} onClick={() => { form.resetFields(); setOpen(true); }}>確認案件品牌</Button>
    {pending && <Button data-operation-action="after_sales.brand_review.retry" loading={busy} onClick={() => void confirm()}>重試品牌確認</Button>}
    <Drawer title="確認案件品牌" open={open} width="min(480px, 100vw)" maskClosable={!busy && !pending} onClose={() => { if (!busy && !pending) { setOpen(false); onDirtyChange(false); } }} footer={<Button data-operation-action="after_sales.brand_review.confirm" type="primary" loading={busy} disabled={!!pending} onClick={() => void confirm()}>確認品牌</Button>}>
      <Form form={form} layout="vertical" disabled={busy || !!pending} onValuesChange={() => onDirtyChange(true)}>
        <Form.Item name="brand" label="案件品牌" rules={[{ required: true, message: '請選擇品牌' }]}><Select aria-label="歷史案件品牌" options={['MOZTECH','BONSON','MORITEK','OTHER'].map(value => ({ value, label: value === 'OTHER' ? '其他' : value }))} /></Form.Item>
        <Form.Item name="proofReference" label="核對依據" rules={[{ required: true, whitespace: true, message: '請填寫核對依據' }]}><Input.TextArea aria-label="品牌核對依據" maxLength={1000} rows={3} /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}
