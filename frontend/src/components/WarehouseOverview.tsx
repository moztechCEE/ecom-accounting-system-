import { useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Input,
  Pagination,
  Progress,
  Tag,
  Tooltip,
} from "antd";
import { ReloadOutlined, ClockCircleOutlined, UnorderedListOutlined, InboxOutlined, CodeSandboxOutlined } from "@ant-design/icons";
import {
  label,
  time,
  useManagement,
  type OverviewData,
} from "../services/warehouse-management";
import WarehouseOrderPanel from "./WarehouseOrderPanel";
import type { WarehouseRow } from "../services/warehouse.types";

const summaryCards = [
  { key: 'pending', label: '待揀貨', icon: <ClockCircleOutlined /> },
  { key: 'picking', label: '揀貨中', icon: <UnorderedListOutlined /> },
  { key: 'picked', label: '待裝箱', icon: <InboxOutlined /> },
  { key: 'packing', label: '裝箱中', icon: <CodeSandboxOutlined /> },
];
export default function WarehouseOverview({ entityId }: { entityId: string }) {
  const [search, setSearch] = useState(""),
    [pickPage, setPickPage] = useState(1),
    [packPage, setPackPage] = useState(1);
  const [selected, setSelected] = useState<WarehouseRow | null>(null);
  const { data, error, loading, refresh } = useManagement<OverviewData>(
    "overview",
    { entityId, search, pickPage, packPage },
    !!entityId,
  );
  return (
    <section className="warehouse-management">
      <header className="warehouse-management-header">
        <div>
          <span className="station-eyebrow">儲運管理中心</span>
          <h1>儲運總覽</h1>
        </div>
        <div className="station-controls">
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
            重新整理
          </Button>
        </div>
      </header>
      <div className="warehouse-management-tools">
        <Input.Search
          aria-label="查找儲運訂單"
          placeholder="輸入／掃描單號"
          allowClear
          onSearch={(q) => {
            setSearch(q);
            setPickPage(1);
            setPackPage(1);
            setSelected(null);
          }}
        />
        {data && (
          <span>
            {data.source === "fixture" ? (
              <Tag color="gold">本機測試資料</Tag>
            ) : (
              <Tooltip title="只包含已核准公司與品牌對照的 WMS 訂單">
                已授權訂單
              </Tooltip>
            )}{" "}
            更新 {time(data.observedAt)}
          </span>
        )}
      </div>
      {error && <Alert type="warning" message={error} />}
      {!data && !error && (
        <p role="status">{loading ? "正在載入作業進度" : "請先選擇公司"}</p>
      )}
      {data && (
        <>
          <div className="warehouse-summary">
            {summaryCards.map(({ key, label: title, icon }) => (
              <article key={key} className={`warehouse-status-card status-${key}`} aria-label={title}>
                <div><span>{title}</span><strong>{data.summary[key]} <small>單</small></strong></div>
                <span className="warehouse-status-icon" aria-hidden="true">{icon}</span>
              </article>
            ))}
          </div>
          <div className="warehouse-lanes">
            {(["pick", "pack"] as const).map((stage) => {
              const lane = data[stage],
                isPick = stage === "pick";
              return (
                <section
                  className={`warehouse-lane lane-${stage}`}
                  key={stage}
                  aria-label={isPick ? "揀貨區" : "裝箱區"}
                >
                  <header>
                    <div>
                      <span className="lane-number">
                        {isPick ? "01" : "02"}
                      </span>
                      <h2>{isPick ? "揀貨區" : "裝箱區"}</h2>
                    </div>
                    <strong>{lane.total} 單</strong>
                  </header>
                  <div className="warehouse-lane-orders">
                    {lane.items.map((order) => {
                      const done = isPick ? order.picked : order.packed,
                        actor = isPick ? order.picker : order.packer;
                      return (
                        <button
                          className="warehouse-manager-order"
                          key={order.id}
                          onClick={() =>
                            setSelected({
                              ...order,
                              assignee: actor,
                              warehouseLabel: label(order.state),
                              logisticsLabel: "尚未接入物流對照",
                              receiptLabel: "尚未確認",
                            })
                          }
                        >
                          <div className="warehouse-order-line">
                            <b>{order.orderNumber}</b>
                            <Tag
                              color={
                                ["picking", "packing"].includes(order.state)
                                  ? "blue"
                                  : undefined
                              }
                            >
                              {label(order.state)}
                            </Tag>
                          </div>
                          <div className="warehouse-order-line">
                            <span>{order.brand}</span>
                            <span>{actor || "待認領"}</span>
                          </div>
                          {order.blocked > 0 && (
                            <span>
                              <Tag color="orange">
                                {order.blocked} 項未結例外
                              </Tag>
                            </span>
                          )}
                          <Progress
                            percent={
                              order.required
                                ? Math.min(
                                    100,
                                    Math.round((done / order.required) * 100),
                                  )
                                : 0
                            }
                            showInfo={false}
                            strokeColor={isPick ? "#bb7c28" : "#249789"}
                            size="small"
                          />
                          <div className="warehouse-order-line">
                            <span>
                              核對{" "}
                              <b>
                                {done} / {order.required}
                              </b>{" "}
                              件
                            </span>
                            <span>更新 {time(order.updatedAt)}</span>
                          </div>
                          {!isPick && (
                            <small>揀貨：{order.picker || "未記錄"}</small>
                          )}
                        </button>
                      );
                    })}
                    {!lane.items.length && (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                          search
                            ? "沒有符合的訂單"
                            : `目前沒有${isPick ? "揀貨" : "裝箱"}任務`
                        }
                      />
                    )}
                  </div>
                  {lane.total > 10 && (
                    <Pagination
                      simple
                      current={lane.page}
                      total={lane.total}
                      pageSize={10}
                      onChange={isPick ? setPickPage : setPackPage}
                    />
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
      {selected && data && !error && (
        <WarehouseOrderPanel
          entityId={entityId}
          order={selected}
          onClose={() => setSelected(null)}
          station="overview"
          stage={null}
        />
      )}
    </section>
  );
}
