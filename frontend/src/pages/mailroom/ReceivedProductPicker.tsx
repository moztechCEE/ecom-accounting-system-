import { useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Select, Spin, Typography } from "antd";
import api from "../../services/api";
import { errorText } from "./model";
export type ReceivedProduct = { id: string; name: string; sku: string | null; barcode: string | null; modelNumber: string | null; hasSerialNumbers: boolean };
export default function ReceivedProductPicker({ entityId, active, value, selected, onChange, disabled }: {
  entityId: string; active: boolean; value?: string; selected?: ReceivedProduct;
  onChange: (product: ReceivedProduct) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState(""), [result, setResult] = useState<{ scope: string; items: ReceivedProduct[] }>({ scope: "", items: [] }), [loading, setLoading] = useState(false), [failure, setFailure] = useState(""), [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const scope = `${entityId}:${query.trim()}`;
  const rows = active && result.scope === scope ? result.items : [];
  useEffect(() => {
    const id = ++generation.current; const controller = new AbortController();
    if (!active || !entityId) return;
    const timer = setTimeout(async () => {
      setLoading(true); setFailure(""); setResult({ scope, items: [] });
      try { const result = await api.get<{ items: ReceivedProduct[] }>("/mailroom/product-options", { params: { entityId, search: query.trim() }, signal: controller.signal }); if (generation.current === id) setResult({ scope, items: result.data.items }); }
      catch (e) { if (generation.current === id && !controller.signal.aborted) setFailure(errorText(e)); }
      finally { if (generation.current === id) setLoading(false); }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); generation.current++; };
  }, [active, entityId, query, revision, scope]);
  const options = [...new Map([...rows, ...(selected ? [selected] : [])].map(row => [row.id, row])).values()];
  return <div><Select aria-label="搜尋實收產品" showSearch filterOption={false} style={{ width: "100%" }} disabled={disabled} loading={loading} value={value}
    placeholder="搜尋產品名稱、SKU 或條碼" onSearch={text => setQuery(text.slice(0, 100))}
    onChange={id => { const product = options.find(row => row.id === id); if (product) onChange(product); }}
    options={options.map(product => ({ value: product.id, label: product.name, product }))}
    optionRender={({ data }) => <div><strong>{data.product.name}</strong><div><Typography.Text type="secondary">{[data.product.sku, data.product.barcode].filter(Boolean).join(" · ") || "未設定產品代碼"}</Typography.Text></div></div>}
    notFoundContent={loading ? <Spin size="small" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={failure ? "產品暫時無法載入" : "沒有符合的產品"} />} />
    {failure && <Alert type="warning" message={failure} action={<Button onClick={() => setRevision(v => v + 1)}>重試</Button>} />}
  </div>;
}
