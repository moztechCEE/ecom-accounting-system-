import OperationsCompanySelector from "../components/OperationsCompanySelector";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Input,
  message,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import dayjs from "dayjs";
import { useLocation, useNavigate } from "react-router-dom";
import { useEntityContext } from "../hooks/useEntityContext";
import {
  operationsAdmin,
  adminError,
  type LogsResult,
  type LogRow,
} from "../services/operations-admin.service";
import { hasAnyPermission, isAdminUser } from "../utils/access";
import { useAuth } from "../contexts/AuthContext";
const labels: Record<string, string> = {
  ERP: "營運系統",
  INTERACTION: "操作點選",
  MAILROOM: "收發與維修",
  OUTBOUND: "出貨交辦",
  SYNC: "跨系統同步",
  SOURCE: "售後案件",
  WMS: "儲運系統",
};
const outcomes: Record<string, string> = {
  COMMITTED: "已提交",
  INTENT: "已點選",
  CANCELLED: "已取消",
  VALIDATION_BLOCKED: "欄位未通過",
  PENDING: "等待發送",
  SENDING: "發送中",
  DELIVERED: "對端已接收",
  ACKNOWLEDGED: "對端已接收",
  FAILED: "失敗",
  UNKNOWN: "結果待確認",
};
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export default function OperationLogsPage() {
  const entityId = useEntityContext();
  const { search } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstSource =
    new URLSearchParams(search).get("source") ||
    (isAdminUser(user) || hasAnyPermission(user, ["operation_logs:read"])
      ? "ERP"
      : "SOURCE");
  const [source, setSource] = useState(firstSource);
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [recordId, setRecordId] = useState("");
  const [brand, setBrand] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<string>();
  const [result, setResult] = useState<{
    entityId: string;
    data: LogsResult;
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<LogRow>();
  const query = useMemo(
    () => ({
      entityId,
      source,
      from: range[0].toISOString(),
      to: range[1].toISOString(),
      recordId: recordId.trim() || undefined,
      brand,
    }),
    [entityId, source, range, recordId, brand],
  );
  const current = result?.entityId === entityId ? result.data : undefined;
  const canExport =
    isAdminUser(user) || hasAnyPermission(user, ["operation_logs:export"]);
  useEffect(() => {
    setCursor(undefined);
    setDetail(undefined);
  }, [entityId, source, range, recordId, brand]);
  useEffect(() => {
    if (!entityId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    operationsAdmin
      .logs({ ...query, cursor }, controller.signal)
      .then((data) => setResult({ entityId, data }))
      .catch((error) => {
        if (!controller.signal.aborted) setError(adminError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, cursor, refresh]);
  const archive = async () => {
    setBusy(true);
    try {
      const result = await operationsAdmin.archive(query);
      const blob = await operationsAdmin.download(entityId, result.id);
      downloadBlob(blob, "操作日誌-" + result.id + ".jsonl.gz");
      downloadBlob(
        new Blob([JSON.stringify(result.manifest, null, 2)], {
          type: "application/json",
        }),
        "操作日誌-" + result.id + ".manifest.json",
      );
      message.success("封存包已匯出");
    } catch (error) {
      message.error(adminError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ padding: 24 }}>
      <Space
        wrap
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <Space wrap>
          <h1 style={{ margin: 0 }}>操作日誌</h1>
          <OperationsCompanySelector entityId={entityId} />
        </Space>
        <Space>
          <Button
            data-operation-action="operation_logs.refresh"
            onClick={() => setRefresh((value) => value + 1)}
          >
            更新
          </Button>
          {canExport && !["SOURCE", "WMS"].includes(source) && (
            <Button
              data-operation-action="operation_logs.archive"
              loading={busy}
              onClick={archive}
            >
              匯出封存包
            </Button>
          )}
        </Space>
      </Space>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          value={source}
          style={{ width: 160 }}
          onChange={(value) => {
            setSource(value);
            setBrand(undefined);
          }}
          options={(
            current?.sources || [
              "ERP",
              "INTERACTION",
              "MAILROOM",
              "OUTBOUND",
              "SYNC",
              "SOURCE",
              "WMS",
            ]
          ).map((value) => ({ value, label: labels[value] }))}
        />
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          onChange={(value) => {
            if (value?.[0] && value[1])
              setRange([value[0].startOf("day"), value[1].endOf("day")]);
          }}
        />
        <Input.Search
          aria-label="案件或紀錄編號"
          placeholder="案件／紀錄編號"
          allowClear
          onSearch={setRecordId}
          style={{ width: 240 }}
        />
        {["ERP", "INTERACTION", "SOURCE"].includes(source) && (
          <Select
            aria-label="品牌"
            placeholder="全部品牌"
            allowClear
            value={brand}
            onChange={setBrand}
            style={{ width: 130 }}
            options={[
              { value: "MOZTECH", label: "MOZTECH" },
              { value: "BONSON", label: "BONSON" },
            ]}
          />
        )}
      </Space>
      {error && <Alert type="error" message={error} showIcon />}
      {current?.sourceStatus === "UNAVAILABLE" && (
        <Alert type="warning" message="售後日誌暫時無法讀取" showIcon />
      )}
      {current?.sourceStatus === "PORTAL_ONLY" ? (
        <Button
          onClick={() => navigate(current.portalPath || "/warehouse/logs")}
        >
          開啟儲運操作紀錄
        </Button>
      ) : (
        <>
          <Table<LogRow>
            loading={loading}
            rowKey="id"
            dataSource={current?.items || []}
            pagination={false}
            scroll={{ x: 880 }}
            columns={[
              {
                title: "時間",
                dataIndex: "occurredAt",
                width: 180,
                render: (value) => new Date(value).toLocaleString("zh-TW"),
              },
              { title: "動作", dataIndex: "actionId" },
              { title: "案件／紀錄", dataIndex: "recordId", ellipsis: true },
              {
                title: "操作人",
                dataIndex: "actorId",
                ellipsis: true,
                render: (_, row) => row.actorName || row.actorId || "系統",
              },
              {
                title: "結果",
                dataIndex: "outcome",
                render: (value) => <Tag>{outcomes[value] || value}</Tag>,
              },
              {
                title: "",
                width: 70,
                render: (_, row) => (
                  <Button
                    data-operation-action="operation_logs.detail"
                    size="small"
                    onClick={() => setDetail(row)}
                  >
                    查看
                  </Button>
                ),
              },
            ]}
            locale={{ emptyText: "此範圍沒有紀錄" }}
          />
          <Space style={{ marginTop: 16 }}>
            {cursor && (
              <Button onClick={() => setCursor(undefined)}>回到最新</Button>
            )}
            <Button
              disabled={!current?.nextCursor}
              onClick={() => setCursor(current?.nextCursor || undefined)}
            >
              下一頁
            </Button>
          </Space>
        </>
      )}
      <Drawer
        title="操作紀錄"
        open={!!detail}
        onClose={() => setDetail(undefined)}
        width="min(480px, 100vw)"
      >
        {detail && (
          <dl>
            {[
              ["時間", new Date(detail.occurredAt).toLocaleString("zh-TW")],
              ["來源", labels[detail.source]],
              ["動作", detail.actionId],
              ["結果", outcomes[detail.outcome] || detail.outcome],
              ["操作人", detail.actorName || detail.actorId],
              ["案件／紀錄", detail.recordId],
              ["品牌", detail.brand],
              ["作業編號", detail.requestId],
              ["異動欄位", detail.changedFieldNames?.join("、")],
              ["前狀態", detail.fromStatus],
              ["後狀態", detail.toStatus],
            ]
              .filter(([, value]) => value)
              .map(([key, value]) => (
                <div key={key} style={{ marginBottom: 16 }}>
                  <dt style={{ color: "#667085" }}>{key}</dt>
                  <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
                    {value}
                  </dd>
                </div>
              ))}
          </dl>
        )}
      </Drawer>
    </div>
  );
}
