import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Empty, Modal, Pagination, Space, Spin, Tag, Typography } from 'antd';
import { EditOutlined, PictureOutlined } from '@ant-design/icons';
import api from '../../services/api';
import { CATEGORIES, STATUS, type Item } from './model';
import { canOpenPrecheck } from './mailroom-workflow';
import { receivingPrecheckStageLabel } from './initial-inspection-model';
import MailroomLabelPrint from './MailroomLabelPrint';
import type { DirectLabelPrint } from './mailroom-label';

function photoLoader(entityId: string) {
  const cache = new Map<string, Blob>();
  const queue: (() => void)[] = []; let active = 0;
  const release = () => { const next = queue.shift(); if (next) next(); else active--; };
  return async (path: string, key: string, signal: AbortSignal) => {
    const cached = cache.get(key); if (cached) return cached;
    if (active >= 4) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    try {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const result = await api.get<Blob>(path, { params: { entityId }, responseType: 'blob', signal });
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(result.data.type)) throw new Error('Invalid photo');
      if (cache.size >= 24) cache.delete(cache.keys().next().value!);
      cache.set(key, result.data); return result.data;
    } finally { release(); }
  };
}
function ItemThumbnail({ item, entityId, loadPhoto }: { item: Item; entityId: string; loadPhoto: ReturnType<typeof photoLoader> }) {
  const scope = JSON.stringify([entityId, item.id, item.version, item.evidenceThumbnailUrl]);
  return <ItemPhoto key={scope} item={item} scope={scope} loadPhoto={loadPhoto} />;
}
function ItemPhoto({ item, scope, loadPhoto }: { item: Item; scope: string; loadPhoto: ReturnType<typeof photoLoader> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [snapshot, setSnapshot] = useState<{ scope: string; src?: string; failed?: boolean }>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const path = item.evidenceThumbnailUrl;
  const hasPhotoPath = !!path && /^\/mailroom\/prechecks\/items\/[^/]+\/photo(?:\?|$)/.test(path);
  useEffect(() => {
    const controller = new AbortController(); let url: string | undefined;
    const target = ref.current;
    if (!target || !path || !hasPhotoPath) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      loadPhoto(path, scope, controller.signal).then(blob => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob); setSnapshot({ scope, src: url });
      }).catch(() => { if (!controller.signal.aborted) setSnapshot({ scope, failed: true }); });
    });
    observer.observe(target);
    return () => { observer.disconnect(); controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [scope, path, hasPhotoPath, loadPhoto]);
  const src = snapshot?.scope === scope ? snapshot.src : undefined;
  const placeholder = snapshot?.failed ? '載入失敗' : !hasPhotoPath ? item.evidenceCount > 0 ? '無法預覽' : '無照片' : '載入中';
  const photoFailed = () => setSnapshot({ scope, failed: true });
  return <>
    <button ref={ref} type="button" className="mailroom-receiving-photo" disabled={!src} aria-label={src ? `放大 ${item.label} 的實收照片` : `${item.label}：${placeholder}`} title={src ? '放大照片' : placeholder} onClick={() => setPreviewOpen(true)}>
      {src ? <img src={src} alt={`${item.label} 實收照片`} onError={photoFailed} /> : <span className="mailroom-receiving-photo-placeholder"><PictureOutlined aria-hidden /><span>{placeholder}</span></span>}
    </button>
    <Modal className="mailroom-photo-preview" title={item.productName || item.label} open={previewOpen && !!src} onCancel={() => setPreviewOpen(false)} footer={null} width={860} centered destroyOnHidden>
      {src && <img src={src} alt={`${item.label} 實收照片放大`} onError={photoFailed} />}
    </Modal>
  </>;
}
export default function ReceivingItemList({ entityId, items, total, page, loading, selectedIds, onSelect, onPage, onOpen, onInspect, canEdit, onDirectPrint, onLabelBusyChange, pendingActionLabel }: {
  entityId: string; items: Item[]; total: number; page: number; loading: boolean; selectedIds: string[];
  onSelect: (ids: string[]) => void; onPage: (page: number) => void; onOpen: (id: string) => void; onInspect: (ids: string[]) => void; canEdit: boolean;
  onDirectPrint?: DirectLabelPrint; onLabelBusyChange?: (busy: boolean) => void; pendingActionLabel?: string;
}) {
  const loadPhoto = useMemo(() => photoLoader(entityId), [entityId]);
  const printing = useRef(new Set<string>()), labelBusy = useRef(onLabelBusyChange);
  useEffect(() => { labelBusy.current = onLabelBusyChange; }, [onLabelBusyChange]);
  function updateLabelBusy(id: string, busy: boolean) {
    if (busy) printing.current.add(id); else printing.current.delete(id);
    labelBusy.current?.(printing.current.size > 0);
  }
  useEffect(() => () => { printing.current.clear(); labelBusy.current?.(false); }, []);
  const allSelected = items.length > 0 && items.every(item => selectedIds.includes(item.id));
  return <Spin spinning={loading}><div className="mailroom-receiving-list" aria-label="收件實物列表">
    {!!items.length && <div className="mailroom-receiving-head"><Checkbox aria-label="選取本頁實物" checked={allSelected} indeterminate={!allSelected && items.some(item => selectedIds.includes(item.id))} onChange={event => onSelect(event.target.checked ? items.map(item => item.id) : [])} /><span>照片</span><span>案件／實物</span><span>進度／類型</span><span>操作</span></div>}
    {items.map(item => <div className="mailroom-receiving-row" key={item.id}>
      <Checkbox aria-label={`選取 ${item.label}`} checked={selectedIds.includes(item.id)} onChange={event => onSelect(event.target.checked ? [...selectedIds, item.id] : selectedIds.filter(id => id !== item.id))} />
      <ItemThumbnail item={item} entityId={entityId} loadPhoto={loadPhoto} />
      <div className="mailroom-receiving-identity"><Button type="link" className="mailroom-item-link" onClick={() => onOpen(item.id)}>{item.productName}</Button><div>{item.receipt.sourceNumber || item.receipt.senderLabel || '待客服配對'}</div><Typography.Text type="secondary">{item.label}{item.serialNumber ? ` · SN ${item.serialNumber}` : ''}</Typography.Text></div>
      <div className="mailroom-receiving-stage"><Tag>{item.statusLabel || STATUS[item.status] || item.status}</Tag><Tag>{CATEGORIES[item.receipt.category] || item.receipt.category}</Tag>{item.precheck && <div><Typography.Text type="secondary">{receivingPrecheckStageLabel(item.precheck.stage, item.status)}{item.precheck.savedByName ? ` · ${item.precheck.savedByName} · v${item.precheck.revision}` : ''}</Typography.Text></div>}</div>
      <div className="mailroom-receiving-row-actions"><Button className="mailroom-receiving-edit" icon={<EditOutlined aria-hidden />} aria-label={`編輯初檢 ${item.label}`} title="編輯初檢" disabled={!canEdit || !canOpenPrecheck(item)} onClick={() => onInspect([item.id])} /><MailroomLabelPrint entityId={entityId} itemIds={[item.id]} directDisabled={!canEdit} iconOnly ariaLabel={`列印物件標籤 ${item.label}`} onDirectPrint={onDirectPrint} pendingActionLabel={pendingActionLabel} onBusyChange={busy => updateLabelBusy(item.id, busy)} /></div>
    </div>)}
    {!items.length && <Empty description="目前沒有符合條件的收件" />}
    <Space className="mailroom-receiving-pagination"><Pagination current={page} pageSize={50} total={total} showSizeChanger={false} onChange={onPage} /></Space>
  </div></Spin>;
}
