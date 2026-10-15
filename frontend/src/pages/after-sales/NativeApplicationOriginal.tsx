import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Image, Space, Typography } from 'antd';
import { useAuth } from '../../contexts/AuthContext';
import { nativeAfterSales, type NativeApplication, type NativeProduct } from '../../services/native-after-sales.service';
import { registrationTokenMatchesActor } from './pending-registration';
import { originalIntakeProductLabel } from './native-application-model';

/** The original submission is displayed beside the separately editable CSR review. Never used as an ERP product FK. */
export default function NativeApplicationOriginal({ entityId, applicationId, submitted, products = [] }: { entityId: string; applicationId: string; submitted?: NativeApplication['submittedData']; products?: NativeProduct[] }) {
  const { user } = useAuth(), scope = JSON.stringify([user?.id, entityId, applicationId]);
  const latest = useRef(scope); latest.current = scope;
  const abort = useRef<AbortController | null>(null);
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string }>(), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => { setPhoto(undefined); setError(''); setLoading(false); return () => { abort.current?.abort(); }; }, [scope]);
  async function showPhoto(index: number) {
    const token = localStorage.getItem('access_token') || '', captured = scope, actor = user?.id || '';
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const valid = () => !controller.signal.aborted && latest.current === captured && localStorage.getItem('access_token') === token && registrationTokenMatchesActor(token, actor);
    if (!valid()) return; setLoading(true); setError('');
    try { const result = await nativeAfterSales.applicationPhoto(entityId, applicationId, index, controller.signal); if (valid()) setPhoto(result); }
    catch { if (valid()) setError('無法讀取原申請照片，請更新後重試'); }
    finally { if (valid()) setLoading(false); }
  }
  if (!submitted) return null;
  const intake = submitted.intake;
  return <section aria-label="顧客原始申請" style={{ marginBottom: 16 }}>
    <Typography.Text strong>顧客原始申請</Typography.Text>
    <Descriptions column={1} size="small" items={[
      { key: 'product', label: '原始品名', children: submitted.productDescription || '未填寫' },
      { key: 'fault', label: '問題描述', children: submitted.faultDescription || '未填寫' },
      { key: 'address', label: '原回寄地址', children: submitted.address || '未填寫' },
      ...(intake ? [{ key: 'zip', label: '郵遞區號', children: intake.address.postalCode },
        { key: 'barcode', label: '原條碼', children: intake.barcodeUnavailable ? '顧客無法提供' : intake.barcode || '未填寫' },
        { key: 'selected', label: '顧客選品', children: intake.products.map(item => originalIntakeProductLabel(item, products)).join('；') || '未選擇' },
        { key: 'packaging', label: '寄回須知', children: intake.packagingAcknowledged ? '已勾選確認' : '未確認' }] : []),
      { key: 'email', label: '原 Email', children: `${submitted.email || '未填寫'}${intake?.emailVerification.status === 'UNVERIFIED' ? '（未驗證）' : ''}` },
    ]} />
    <Space wrap>{submitted.photos.map(p => <Button key={p.index} size="small" loading={loading} data-operation-action="after_sales.application.photo" onClick={() => void showPhoto(p.index)}>查看顧客照片 {p.index + 1}</Button>)}</Space>
    {error && <Alert type="error" showIcon message={error} />}
    <Drawer title={photo?.name || '產品照片'} open={!!photo} width="min(660px, 100vw)" onClose={() => setPhoto(undefined)}>{photo && <Image src={photo.dataUrl} alt="顧客提交的產品外觀" preview={false} style={{ maxWidth: '100%' }} />}</Drawer>
  </section>;
}
