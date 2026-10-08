import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Space, Statistic, Tag } from "antd";
import api from "../../services/api";
import { errorText } from "./model";
type Summary = { complete: boolean; counts: { awaitingCases: number; awaitingItems: number; inTransitCases: number } | null };
export default function ArrivalSummary({ entityId, revision, paused }: { entityId: string; revision: number; paused: boolean }) {
  const [snapshot, setSnapshot] = useState<{ entityId: string; data?: Summary; error?: string; loading: boolean }>();
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    if (!entityId) return;
    setSnapshot(previous => ({ entityId, data: previous?.entityId === entityId ? previous.data : undefined, loading: true }));
    try { const result = await api.get<Summary>("/mailroom/source-summary", { params: { entityId } }); if (generation.current === ticket) setSnapshot({ entityId, data: result.data, loading: false }); }
    catch (error) { if (generation.current === ticket) setSnapshot(previous => ({ entityId, data: previous?.entityId === entityId ? previous.data : undefined, error: errorText(error), loading: false })); }
  }, [entityId]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh, revision]);
  useEffect(() => { const timer = setInterval(() => { if (!paused && document.visibilityState === "visible") void refresh(); }, 30000); return () => clearInterval(timer); }, [paused, refresh]);
  const current = snapshot?.entityId === entityId ? snapshot : undefined, counts = current?.data?.complete ? current.data.counts : null;
  return <div className="mailroom-arrival-summary">
    <Space wrap size={16}><Card size="small"><Statistic title="售後待到貨案件" value={counts?.awaitingCases ?? "—"} suffix="筆" loading={current?.loading} /></Card><Card size="small"><Statistic title="尚待收件物品" value={counts?.awaitingItems ?? "—"} suffix="件" loading={current?.loading} /></Card><Card size="small"><Statistic title="已確認在途案件" value={counts?.inTransitCases ?? "—"} suffix="筆" loading={current?.loading} /></Card>{current?.error && counts && <Tag color="warning">統計未更新</Tag>}</Space>
    {current?.error ? <Alert type="warning" message="到貨統計暫時無法更新" description={current.error} action={<Button onClick={() => void refresh()}>重試</Button>} /> : current?.data && !current.data.complete ? <Alert type="info" message="到貨統計尚未完整，請以逐筆案件進度核對。" /> : null}
  </div>;
}
