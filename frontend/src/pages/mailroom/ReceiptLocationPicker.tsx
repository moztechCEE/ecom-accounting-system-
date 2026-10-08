import { useEffect, useRef, useState } from "react";
import { Alert, Button, Select } from "antd";
import api from "../../services/api";
import { errorText } from "./model";
type Location = { id: string; code: string; name: string; rackId: string; isActive: boolean };
type Rack = { id: string; code: string; name: string; isActive: boolean; zone: string };
export default function ReceiptLocationPicker({ entityId, active, value, onChange, disabled }: {
  entityId: string; active: boolean; value?: string; onChange?: (id: string, code: string) => void; disabled?: boolean;
}) {
  const [locations, setLocations] = useState<Location[]>([]), [racks, setRacks] = useState<Rack[]>([]), [loading, setLoading] = useState(false), [failure, setFailure] = useState(""), [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current; const controller = new AbortController();
    if (!active || !entityId) return;
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setLocations([]); setRacks([]); setFailure(""); } });
    void api.get<{ locations: Location[]; racks: Rack[] }>("/mailroom/storage", { params: { entityId }, signal: controller.signal })
      .then(r => { if (generation.current === id) { setLocations(r.data.locations); setRacks(r.data.racks); } })
      .catch(e => { if (generation.current === id && !controller.signal.aborted) setFailure(errorText(e)); })
      .finally(() => { if (generation.current === id) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [entityId, active, revision]);
  return <><Select aria-label="選擇收件儲位" value={value} loading={loading} showSearch optionFilterProp="label" disabled={disabled} placeholder="選擇儲位，例如 A1" style={{ width: "100%" }}
    options={racks.filter(rack => rack.isActive).map(rack => ({ label: `${rack.name}（${rack.zone === "OUTBOUND" ? "寄件區" : "收件區"}）`, options: locations.filter(location => location.isActive && location.rackId === rack.id).map(location => ({ value: location.id, label: `${location.code}${location.name && location.name !== location.code ? ` · ${location.name}` : ""}` })) }))}
    onChange={id => { const location = locations.find(row => row.id === id); if (location) onChange?.(id, location.code); }} />
    {failure && <Alert type="warning" message="儲位暫時無法載入" description={failure} action={<Button onClick={() => setRevision(n => n + 1)}>重試</Button>} />}</>;
}
