import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Empty, Pagination, Space, Spin, Tag, Typography } from 'antd';
import { EditOutlined, PictureOutlined } from '@ant-design/icons';
import api from '../../services/api';
import { CATEGORIES, STATUS, type Item } from './model';
import { canOpenPrecheck } from './mailroom-workflow';
import { PRECHECK_STAGES } from './initial-inspection-model';

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
function ItemThumbnail({ item, entityId, loadPhoto, onOpen }: { item: Item; entityId: string; loadPhoto: ReturnType<typeof photoLoader>; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [snapshot, setSnapshot] = useState<{ scope: string; src: string }>();
  const scope = JSON.stringify([entityId, item.id, item.version, item.evidenceThumbnailUrl]);
  useEffect(() => {
    const controller = new AbortController(); let url: string | undefined;
    const target = ref.current, path = item.evidenceThumbnailUrl;
    if (!target || !path || !/^\/mailroom\/prechecks\/items\/[^/]+\/photo(?:\?|$)/.test(path)) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      loadPhoto(path, scope, controller.signal).then(blob => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob); setSnapshot({ scope, src: url });
      }).catch(() => {});
    });
    observer.observe(target);
    return () => { observer.disconnect(); controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [scope, item.evidenceThumbnailUrl, loadPhoto]);
  const src = snapshot?.scope === scope ? snapshot.src : undefined;
  return <button ref={ref} type="button" className="mailroom-receiving-photo" aria-label={`查看 ${item.label}，${item.evidenceCount} 張實收照片`} onClick={onOpen}>{src ? <img src={src} alt={`${item.label} 實收照片`} /> : <PictureOutlined aria-hidden />}</button>;
}
export default function ReceivingItemList({ entityId, items, total, page, loading, selectedIds, onSelect, onPage, onOpen, onInspect, canEdit }: {
  entityId: string; items: Item[]; total: number; page: number; loading: boolean; selectedIds: string[];
  onSelect: (ids: string[]) => void; onPage: (page: number) => void; onOpen: (id: string) => void; onInspect: (ids: string[]) => void; canEdit: boolean;
}) {
  const loadPhoto = useMemo(() => photoLoader(entityId), [entityId]);
  const allSelected = items.length > 0 && items.every(item => selectedIds.includes(item.id));
  return <Spin spinning={loading}><div className="mailroom-receiving-list" aria-label="收件實物列表">
    {!!items.length && <div className="mailroom-receiving-head"><Checkbox aria-label="選取本頁實物" checked={allSelected} indeterminate={!allSelected && items.some(item => selectedIds.includes(item.id))} onChange={event => onSelect(event.target.checked ? items.map(item => item.id) : [])} /><span>照片</span><span>案件／實物</span><span>進度／類型</span><span>編輯</span></div>}
    {items.map(item => <div className="mailroom-receiving-row" key={item.id}>
      <Checkbox aria-label={`選取 ${item.label}`} checked={selectedIds.includes(item.id)} onChange={event => onSelect(event.target.checked ? [...selectedIds, item.id] : selectedIds.filter(id => id !== item.id))} />
      <ItemThumbnail item={item} entityId={entityId} loadPhoto={loadPhoto} onOpen={() => onOpen(item.id)} />
      <div className="mailroom-receiving-identity"><Button type="link" className="mailroom-item-link" onClick={() => onOpen(item.id)}>{item.productName}</Button><div>{item.receipt.sourceNumber || item.receipt.senderLabel || '待客服配對'}</div><Typography.Text type="secondary">{item.label}{item.serialNumber ? ` · SN ${item.serialNumber}` : ''}</Typography.Text></div>
      <div className="mailroom-receiving-stage"><Tag>{item.statusLabel || STATUS[item.status] || item.status}</Tag><Tag>{CATEGORIES[item.receipt.category] || item.receipt.category}</Tag>{item.precheck && <div><Typography.Text type="secondary">{PRECHECK_STAGES[item.precheck.stage] || item.precheck.stage}{item.precheck.savedByName ? ` · ${item.precheck.savedByName} · v${item.precheck.revision}` : ''}</Typography.Text></div>}</div>
      <Button className="mailroom-receiving-edit" icon={<EditOutlined aria-hidden />} aria-label={`編輯初檢 ${item.label}`} title="編輯初檢" disabled={!canEdit || !canOpenPrecheck(item)} onClick={() => onInspect([item.id])} />
    </div>)}
    {!items.length && <Empty description="目前沒有符合條件的收件" />}
    <Space className="mailroom-receiving-pagination"><Pagination current={page} pageSize={50} total={total} showSizeChanger={false} onChange={onPage} /></Space>
  </div></Spin>;
}
