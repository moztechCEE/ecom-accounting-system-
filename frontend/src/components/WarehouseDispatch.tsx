import { useEffect, useRef, useState } from "react";
import { Alert, Button, Select, Table } from "antd";
import { Link } from "react-router-dom";
import api from "../services/api";
type Preview = {
  orderNumber: string;
  brand: string;
  sourceHash: string;
  items: {
    id: string;
    name: string;
    sku: string;
    barcode: string;
    quantity: number;
  }[];
};
export default function WarehouseDispatch({
  entityId,
  onDispatched,
  orderId,
}: {
  entityId: string;
  onDispatched: () => void;
  orderId?: string;
}) {
  const [id, setId] = useState(orderId || ""),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(""),
    [prepickUrl, setPrepickUrl] = useState<string | null>(null);
  const [options, setOptions] = useState<{ id: string; orderNumber: string }[]>(
      [],
    ),
    [search, setSearch] = useState("");
  useEffect(() => {
    if (orderId) return;
    const abort = new AbortController(),
      timer = setTimeout(() => {
        api
          .get<{ id: string; orderNumber: string }[]>(
            "/wms/workbench/dispatch-orders",
            { params: { entityId, search }, signal: abort.signal },
          )
          .then((r) => {
            if (!abort.signal.aborted) setOptions(r.data);
          })
          .catch(() => {
            if (!abort.signal.aborted)
              setError("無法載入待拋轉訂單，請重新搜尋");
          });
      }, 250);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [entityId, search, orderId]);
  const flight = useRef(false),
    key = useRef("");
  async function run(confirm = false) {
    if (flight.current || !id.trim() || (confirm && !preview)) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    setPrepickUrl(null);
    try {
      if (confirm) {
        const response = await api.post<{ prepickUrl?: string | null; workBarcode?: string; reservationAccepted?: boolean }>(
          `/wms/workbench/dispatch/${encodeURIComponent(id.trim())}`,
          { entityId, sourceHash: preview!.sourceHash, requestId: key.current },
        );
        setSuccess(`訂單 ${preview!.orderNumber} 已送達 WMS 預揀${response.data.workBarcode ? ` · 工作條碼 ${response.data.workBarcode}` : ""}`);
        setPrepickUrl(response.data.prepickUrl || null);
        setPreview(null);
        onDispatched();
      } else {
        const r = await api.get<Preview>(
          `/wms/workbench/dispatch/${encodeURIComponent(id.trim())}`,
          { params: { entityId, area: "dispatch" } },
        );
        setPreview(r.data);
        key.current = crypto.randomUUID();
      }
    } catch (e) {
      const response = (
        e as { response?: { status: number; data?: { message?: string } } }
      ).response;
      setError(
        response && response.status < 500
          ? response.data?.message || "訂單內容或權限待確認"
          : "連線或拋單結果尚未確認。請保留此單，核對後以原請求重試，不要另建訂單。",
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="warehouse-dispatch">
      <header>
        <h2>ERP 訂單拋轉</h2>
        {!orderId && <Link to="/sales/orders">業務訂單</Link>}
      </header>
      <div className="warehouse-scan-form">
        {!orderId && (
          <Select
            aria-label="選擇 ERP 訂單"
            placeholder="搜尋待拋轉訂單"
            showSearch
            filterOption={false}
            style={{ minWidth: 280 }}
            value={id || undefined}
            disabled={busy}
            options={options.map((o) => ({
              value: o.id,
              label: o.orderNumber,
            }))}
            onSearch={setSearch}
            onChange={(value) => {
              setId(value);
              setPreview(null);
              setSuccess("");
              setPrepickUrl(null);
              setError("");
            }}
          />
        )}
        <Button loading={busy} disabled={!id} onClick={() => void run()}>
          預覽拋單
        </Button>
      </div>
      {error && <Alert type="warning" message={error} />}{" "}
      {success && <Alert type="success" message={success} />}
      {prepickUrl && <a href={prepickUrl} target="_blank" rel="noopener noreferrer">打開 WMS 預揀工作單 →</a>}
      {preview && (
        <>
          <h3>
            {preview.orderNumber} · {preview.brand}
          </h3>
          <Table
            rowKey="id"
            size="small"
            dataSource={preview.items}
            pagination={false}
            columns={[
              { title: "商品", dataIndex: "name" },
              { title: "SKU", dataIndex: "sku" },
              { title: "條碼", dataIndex: "barcode" },
              { title: "數量", dataIndex: "quantity" },
            ]}
          />
          <Button type="primary" loading={busy} onClick={() => void run(true)}>
            確認拋單
          </Button>
        </>
      )}
    </section>
  );
}
