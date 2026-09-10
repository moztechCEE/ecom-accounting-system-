import { useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Result,
  Select,
  Table,
  Tag,
} from "antd";
import { ReloadOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useEntityContext } from "../hooks/useEntityContext";
import { hasPermission } from "../utils/access";
import { WAREHOUSE_REPORTS } from "../config/workspaces";
import {
  label,
  time,
  useManagement,
  type ReportData,
  type ReportRecord,
} from "../services/warehouse-management";
import "./WarehouseCenterPage.css";

export default function WarehouseReportsPage() {
  const { report } = useParams(),
    entityId = useEntityContext(),
    { user } = useAuth();
  const [query] = useSearchParams(),
    initialSearch = query.get("order") || "";
  const config = WAREHOUSE_REPORTS.find((r) => r.key === report);
  if (
    !config ||
    !hasPermission(user, "wms_tasks:read") ||
    !hasPermission(user, config.permission)
  )
    return <Result status="403" title="沒有此頁面權限" />;
  return (
    <Report
      key={`${entityId}:${report}:${initialSearch}`}
      entityId={entityId}
      section={config.key}
      title={config.label}
      initialSearch={initialSearch}
    />
  );
}
function Report({
  entityId,
  section,
  title,
  initialSearch,
}: {
  entityId: string;
  section: string;
  title: string;
  initialSearch: string;
}) {
  const [days, setDays] = useState(section === "exceptions" ? 0 : 30),
    [status, setStatus] = useState(
      section === "exceptions" ? "unresolved" : "all",
    ),
    [search, setSearch] = useState(initialSearch),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReportRecord | null>(null);
  const { data, error, loading, refresh } = useManagement<ReportData>(
    section,
    { entityId, days, status, search, page },
    !!entityId,
  );
  const isException = section === "exceptions",
    isDefect = section === "defects",
    isScan = section === "scan-errors";
  const columns = [
    {
      title: "時間",
      dataIndex: "occurredAt",
      width: 180,
      render: (value: string) => (
        <time style={{ whiteSpace: "nowrap" }} dateTime={value}>
          {time(value, true)}
        </time>
      ),
    },
    {
      title: "訂單",
      dataIndex: "orderNumber",
      render: (_: string, r: ReportRecord) => (
        <Button type="link" onClick={() => setSelected(r)}>
          {r.orderNumber}
        </Button>
      ),
    },
    { title: "品牌", dataIndex: "brand" },
    { title: isDefect ? "回報人員" : "操作人員", dataIndex: "actor" },
    ...(isDefect
      ? [{ title: "商品", dataIndex: "product" }]
      : [
          {
            title: isException ? "類型" : "操作",
            dataIndex: "action",
            render: label,
          },
        ]),
    ...(isException
      ? [
          {
            title: "狀態",
            dataIndex: "status",
            render: (s: string) => (
              <Tag color={s === "open" ? "orange" : undefined}>{label(s)}</Tag>
            ),
          },
        ]
      : []),
    ...(isScan
      ? [
          {
            title: "掃描值",
            dataIndex: "scanValue",
            render: (s: string) => <code>{s || "—"}</code>,
          },
        ]
      : []),
    {
      title: "操作",
      key: "detail",
      render: (_: unknown, r: ReportRecord) => (
        <Button onClick={() => setSelected(r)}>查看</Button>
      ),
    },
  ];
  return (
    <section className="warehouse-management">
      <header className="warehouse-management-header">
        <div>
          <Link to="/warehouse">
            <ArrowLeftOutlined /> 儲運總覽
          </Link>
          <h1>{title}</h1>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            setSelected(null);
            refresh();
          }}
          loading={loading}
        >
          重新整理
        </Button>
      </header>
      <div className="warehouse-report-filters">
        <Input.Search
          aria-label="搜尋紀錄"
          placeholder="訂單／人員"
          defaultValue={initialSearch}
          allowClear
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
            setSelected(null);
          }}
        />
        <Select
          aria-label="查詢期間"
          value={days}
          options={[
            ...(isException ? [{ value: 0, label: "全部期間" }] : []),
            { value: 1, label: "今天" },
            { value: 7, label: "近 7 天" },
            { value: 30, label: "近 30 天" },
            { value: 90, label: "近 90 天" },
          ]}
          onChange={(v) => {
            setDays(v);
            setPage(1);
            setSelected(null);
          }}
        />
        {isException && (
          <Select
            aria-label="例外狀態"
            value={status}
            options={[
              "unresolved",
              "all",
              "open",
              "ack",
              "resolved",
              "rejected",
            ].map((value) => ({
              value,
              label:
                value === "all"
                  ? "全部狀態"
                  : value === "unresolved"
                    ? "未結案"
                    : label(value),
            }))}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
              setSelected(null);
            }}
          />
        )}
      </div>
      {error && <Alert type="warning" message={error} />}
      {data && (
        <>
          <div className="warehouse-report-summary">
            <div>
              <span>
                {isDefect ? "不良回報" : isScan ? "刷錯紀錄" : "符合條件"}
              </span>
              <strong>
                {data.total} <small>筆</small>
              </strong>
            </div>
            <div className="warehouse-breakdown">
              {data.breakdown.map((r) => (
                <span key={r.label}>
                  {label(r.label)} <b>{r.count}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="warehouse-source-note">
            {data.source === "fixture" ? (
              <Tag color="gold">本機測試資料</Tag>
            ) : (
              <Tag>已授權訂單</Tag>
            )}
            {days ? `近 ${days} 天` : "全部期間"} ·{" "}
            {isDefect
              ? "回報次數，非產品不良率"
              : isScan
                ? "刷錯次數，非錯誤率"
                : "唯讀紀錄"}{" "}
            · 更新 {time(data.observedAt)}
          </div>
        </>
      )}
      <Table<ReportRecord>
        rowKey="id"
        className="warehouse-report-table"
        columns={columns}
        dataSource={data?.records || []}
        loading={loading}
        scroll={{ x: 850 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={error ? "資料尚未取得" : "此期間沒有符合的紀錄"}
            />
          ),
        }}
        pagination={{
          current: page,
          total: data?.total || 0,
          pageSize: 25,
          showSizeChanger: false,
          onChange: (v) => {
            setPage(v);
            setSelected(null);
          },
        }}
      />
      <Drawer
        title={selected?.orderNumber}
        open={!!selected && !!data && !error}
        onClose={() => setSelected(null)}
        width={520}
      >
        {selected && (
          <>
            <Descriptions
              column={1}
              bordered
              size="small"
              items={[
                { key: "brand", label: "品牌", children: selected.brand },
                {
                  key: "time",
                  label: "時間",
                  children: time(selected.occurredAt, true),
                },
                { key: "actor", label: "操作人員", children: selected.actor },
                ...Object.entries({
                  action: "操作",
                  status: "狀態",
                  stage: "工作階段",
                  product: "商品",
                  barcode: "條碼",
                  scanValue: "掃描值",
                  reason: "原因",
                  originalSn: "原 SN",
                  newSn: "更換 SN",
                  ackNote: "核可備註",
                  resolutionNote: "結案備註",
                })
                  .filter(([key]) => selected[key as keyof ReportRecord])
                  .map(([key, name]) => ({
                    key,
                    label: name,
                    children: ["action", "status", "stage", "reason"].includes(
                      key,
                    )
                      ? label(selected[key as keyof ReportRecord])
                      : selected[key as keyof ReportRecord],
                  })),
              ]}
            />
            {isException && (
              <Alert
                style={{ marginTop: 20 }}
                type="info"
                message="核可與結案尚未開通"
              />
            )}
          </>
        )}
      </Drawer>
    </section>
  );
}
