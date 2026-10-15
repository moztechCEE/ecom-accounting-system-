import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Pagination, Space, Spin, Tag, Typography } from 'antd';
import { Collapse } from 'antd';
import api from '../../services/api';
import { errorText } from '../mailroom/model';
import { repairPrecheckPendingSummary, type RepairItem } from './repair-model';
import type { RepairListResponse } from './repair-list-model';

const { Text } = Typography;
type Result = { scope: string; items: RepairItem[]; total: number };
function validResult(value: RepairListResponse, entityId: string): boolean {
  return !!value && Number.isSafeInteger(value.total) && value.total >= 0
    && Array.isArray(value.items) && value.items.length <= 50 && value.items.length <= value.total
    && new Set(value.items.map(item => item?.id)).size === value.items.length
    && value.items.every(item => !!item && typeof item.id === 'string' && !!item.id.trim()
      && item.entityId === entityId && item.status === 'RECEIVED'
      && (item.receipt?.category === 'REPAIR' || item.receipt?.category === 'RETURN' && typeof item.repairOwnerId === 'string' && !!item.repairOwnerId.trim())
      && typeof item.productName === 'string' && !!item.productName.trim()
      && typeof item.label === 'string' && (item.receipt.sourceNumber === null || typeof item.receipt.sourceNumber === 'string'));
}
function progress(value: unknown): { label: string; known: boolean; stage?: 'DRAFT' | 'READY' } {
  const summary = repairPrecheckPendingSummary(value);
  if (summary) return { label: summary.stage === 'DRAFT' ? '收發初檢中' : '初檢完成待交接', known: true, stage: summary.stage };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as { stage?: unknown; revision?: unknown };
    if (row.stage === 'NOT_STARTED' && row.revision === 0) return { label: '待初檢', known: true };
    if (row.stage === 'STALE' && Number.isSafeInteger(row.revision) && Number(row.revision) > 0) return { label: '實物資料已更新', known: true };
    if (row.stage === 'SUBMITTED' && Number.isSafeInteger(row.revision) && Number(row.revision) > 0) return { label: '已交維修部門', known: true };
  }
  return { label: '初檢進度未確認', known: false };
}

export default function RepairPrecheckQueue({ entityId, onOpen }: { entityId: string; onOpen: (id: string) => void }) {
  const [paging, setPaging] = useState({ entityId, page: 1 });
  const page = paging.entityId === entityId ? paging.page : 1;
  const generation = useRef(0);
  const [refresh, setRefresh] = useState(0);
  const scope = JSON.stringify([entityId, page, refresh]);
  const [result, setResult] = useState<Result>();
  const [failure, setFailure] = useState<{ scope: string; message: string }>();
  useEffect(() => {
    const controller = new AbortController(), request = ++generation.current;
    if (!entityId.trim()) return () => controller.abort();
    void api.get<RepairListResponse>('/mailroom/items', {
      params: { entityId, view: 'repair', repairScope: 'all', status: 'RECEIVED', page }, signal: controller.signal,
    }).then(({ data }) => {
      if (controller.signal.aborted || request !== generation.current) return;
      if (!validResult(data, entityId)) throw new Error('Invalid repair precheck list');
      setResult({ scope, items: data.items, total: data.total });
    }).catch(error => {
      if (!controller.signal.aborted && request === generation.current) setFailure({ scope, message: errorText(error) });
    });
    return () => { controller.abort(); };
  }, [entityId, page, scope]);
  const current = result?.scope === scope ? result : undefined;
  const error = !entityId.trim() ? '請先選擇公司' : failure?.scope === scope ? failure.message : undefined;
  const busy = !current && !error;
  const states = current?.items.map(item => progress(item.precheck)) || [];
  const known = states.every(state => state.known);
  return <section aria-label="收發初檢預覽">
    <Collapse items={[{ key: 'precheck', label: <Space wrap><span>收發初檢</span>{current && <Text type="secondary">已收維修件 {current.total} 件</Text>}</Space>,
      children: <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Button size="small" loading={busy} onClick={() => setRefresh(value => value + 1)}>重新整理</Button>
        {busy && <Spin aria-label="收發初檢載入中" />}
        {error && <Alert type="error" showIcon message={error} />}
        {current && <>
          <Text type="secondary">{known ? `本頁初檢中 ${states.filter(state => state.stage === 'DRAFT').length} 件／本頁完成待交接 ${states.filter(state => state.stage === 'READY').length} 件` : '本頁初檢進度未確認'}</Text>
          {current.items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="沒有已收維修件" /> : <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {current.items.map((item, index) => <li key={item.id} style={{ padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
              <Space direction="vertical" size={4} style={{ width: '100%', overflowWrap: 'anywhere' }}>
                <Text strong>{item.productName}</Text>
                <Text type="secondary">{item.receipt.sourceNumber || item.label}</Text>
                <Space wrap><Tag color={states[index].stage === 'READY' ? 'green' : undefined}>{states[index].label}</Tag>
                  <Button size="small" onClick={() => onOpen(item.id)} aria-label={`開啟案件：${item.productName} · ${item.receipt.sourceNumber || item.label}`}>開啟案件</Button>
                </Space>
              </Space>
            </li>)}
          </ul>}
          {current.total > 50 && <Pagination size="small" current={page} pageSize={50} total={current.total} showSizeChanger={false}
            onChange={next => setPaging({ entityId, page: next })} />}
        </>}
      </Space> }]} />
  </section>;
}
