import { useEffect, useRef, useState } from 'react';
import { Button, Tag, Typography } from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import { STATUS } from '../mailroom/model';
import { REPAIR_STATUS } from './repair-model';
import { repairTodoLabel, type RepairListItem } from './repair-list-model';
import api from '../../services/api';

const { Text } = Typography;

function CasePhoto({ item, entityId }: { item: RepairListItem; entityId: string }) {
  const source = item.repairOverview?.photoUrl;
  const key = `${entityId}:${item.id}:${item.version}:${source}`;
  const safe = source === `/mailroom/items/${encodeURIComponent(item.id)}/repair-photo`;
  const target = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<{key: string; url: string}>();
  const [failedKey, setFailedKey] = useState<string>();
  const url = photo?.key === key ? photo.url : undefined;
  useEffect(() => {
    if (!safe || !source) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let started = false;
    const load = async () => {
      if (started) return;
      started = true;
      try {
        const result = await api.get<Blob>(source, {params: {entityId}, responseType: 'blob', signal: controller.signal});
        if (controller.signal.aborted) return;
        if (!(result.data instanceof Blob) || result.data.size > 1024 * 1024 || !/^image\/(png|jpeg|webp)$/i.test(result.data.type)) throw Error('Invalid case photo');
        objectUrl = URL.createObjectURL(result.data);
        setPhoto({key, url: objectUrl});
      } catch {if (!controller.signal.aborted) setFailedKey(key);}
    };
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {observer?.disconnect();void load();}
    });
    if (target.current && observer) observer.observe(target.current);else void load();
    return () => {observer?.disconnect();controller.abort();if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [entityId, source, safe, key]);
  return <div className="repair-case-photo" ref={target}>
    {url && failedKey !== key ? <img src={url} alt={`案件照片：${item.productName}`} decoding="async" onError={() => setFailedKey(key)} /> :
      <span role="img" aria-label={failedKey === key ? '案件照片無法載入' : safe ? '案件照片載入中' : '未提供案件照片'}><PictureOutlined /></span>}
  </div>;
}

export default function RepairCaseList({ items, entityId, onOpen }: { items: RepairListItem[]; entityId: string; onOpen: (id: string) => void }) {
  return <ul className="repair-case-list">{items.map(item => {
    const number = item.receipt.sourceNumber || item.label;
    return <li key={item.id} className="repair-case-row">
      <CasePhoto item={item} entityId={entityId} />
      <div className="repair-case-product">
        <Button type="link" className="repair-product-title" onClick={() => onOpen(item.id)}>{item.productName}</Button>
        <Text type="secondary" className="repair-case-number">{number}</Text>
        <div className="repair-case-contact">
          <Text>{item.repairOverview?.customerName?.trim() || '未提供姓名'}</Text>
          <Text type="secondary">{item.repairOverview?.customerPhone?.trim() || '未提供電話'}</Text>
        </div>
      </div>
      <div className="repair-case-progress">
        <Tag color={item.status === 'WAITING_CUSTOMER' ? 'orange' : 'blue'}>{repairTodoLabel(item) || item.statusLabel || REPAIR_STATUS[item.status] || STATUS[item.status] || item.status}</Tag>
      </div>
      <Button className="repair-case-open" onClick={() => onOpen(item.id)} aria-label={`開啟案件：${item.productName} · ${number}`}>開啟案件</Button>
    </li>;
  })}</ul>;
}
