import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
  Upload,
  message,
} from "antd";
import {
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  ToolOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { useAuth } from "../../contexts/AuthContext";
import { hasPermission, isAdminUser } from "../../utils/access";
import api from "../../services/api";
import { webSocketService } from "../../services/websocket.service";
import {
  ACTIONS,
  CATEGORIES,
  DISPOSITIONS,
  STATUS,
  errorText,
  mailroomEnabled,
  type Item,
  type Person,
  type Source,
  type Task,
} from "./model";
import TabletAcceptance from "./TabletAcceptance";
import SourceCasePicker from "./SourceCasePicker";
import RepairDocuments from "../repair/RepairDocuments";
import type { RepairItem } from "../repair/repair-model";
import "./mailroom.css";
const { Text, Title, Paragraph } = Typography;
const requestId = () => crypto.randomUUID();
const date = (value: string) => dayjs(value).format("MM/DD HH:mm");
const statusColor = (status: string) =>
  ["MISMATCH", "WAITING_CUSTOMER"].includes(status)
    ? "orange"
    : ["COLLECTED", "READY_FOR_DISPATCH", "PENDING_WELFARE_STOCK"].includes(
          status,
        )
      ? "green"
      : "blue";
const RETURN_PACKAGING = {
  INTACT: "完整",
  MINOR_DAMAGE: "輕微破損",
  MAJOR_DAMAGE: "嚴重破損",
  NOT_PROVIDED: "未附包裝",
};
const RETURN_PRODUCT = {
  NEW_UNUSED: "全新未使用",
  MINOR_WEAR: "輕微磨損",
  VISIBLE_WEAR: "明顯磨損",
  SEVERE_DAMAGE: "嚴重磨損／破損",
};
const RETURN_ACCESSORIES = {
  COMPLETE: "完整",
  MISSING: "缺少配件",
  NONE_EXPECTED: "原商品無附配件",
};
const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
const field = (label: string, name: string, required = false) => (
  <Form.Item
    label={label}
    name={name}
    rules={
      required
        ? [{ required: true, whitespace: true, message: `請填寫${label}` }]
        : []
    }
  >
    <Input maxLength={name === "location" ? 160 : 200} />
  </Form.Item>
);
export default function MailroomPage({
  mode = "mailroom",
}: {
  mode?: "mailroom" | "repair" | "mine";
}) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const entityId =
    params.get("entityId") || localStorage.getItem("entityId") || "";
  const [rows, setRows] = useState<Item[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState<string>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [people, setPeople] = useState<Person[]>([]),
    [detail, setDetail] = useState<Item>(),
    [detailLoading, setDetailLoading] = useState(false),
    [create, setCreate] = useState(false);
  const [createSource, setCreateSource] = useState<Source>(),
    [listTab, setListTab] = useState("awaiting"),
    [arrivalRevision, setArrivalRevision] = useState(0);
  const selectedId = params.get("itemId");
  const enabled = mailroomEnabled();
  const canMail = hasPermission(user, "mailroom:update"),
    canRepair = hasPermission(user, "repair_workbench:update"),
    canReview = hasPermission(user, "mailroom:review");
  const generation = useRef(0),
    detailGeneration = useRef(0);
  const refresh = useCallback(
    async (quiet = false) => {
      if (!enabled || !entityId) return;
      const generationId = ++generation.current;
      if (!quiet) setLoading(true);
      try {
        if (mode === "mine") {
          const [tasks, receipts] = await Promise.all([
            api.get<Task[]>("/mailroom/tasks", { params: { entityId } }),
            api.get<{ items: Item[] }>("/mailroom/items", {
              params: { entityId, view: "mine" },
            }),
          ]);
          const items = [
            ...new Map(
              [...tasks.data.map((t) => t.item), ...receipts.data.items].map(
                (x) => [x.id, x],
              ),
            ).values(),
          ];
          if (generation.current === generationId) {
            setRows(items);
            setTotal(items.length);
            setError("");
          }
        } else {
          const result = await api.get("/mailroom/items", {
            params: { entityId, view: mode, page, search, status },
          });
          if (generation.current === generationId) {
            setRows(result.data.items);
            setTotal(result.data.total);
            setError("");
          }
        }
      } catch (e) {
        if (generation.current === generationId) setError(errorText(e));
      } finally {
        if (generation.current === generationId) setLoading(false);
      }
    },
    [enabled, entityId, mode, page, search, status],
  );
  const loadDetail = useCallback(async () => {
    const id = ++detailGeneration.current;
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    setDetailLoading(true);
    setDetail(undefined);
    try {
      const result = await api.get<Item>(
        "/mailroom/items/" + encodeURIComponent(selectedId),
        { params: { entityId } },
      );
      if (id === detailGeneration.current) setDetail(result.data);
    } catch (e) {
      if (id === detailGeneration.current) message.error(errorText(e));
    } finally {
      if (id === detailGeneration.current) setDetailLoading(false);
    }
  }, [selectedId, entityId]);
  useEffect(() => {
    void refresh();
    const backgroundRefresh = () => {
      if (document.visibilityState === "visible" && !create && !selectedId)
        void refresh(true);
    };
    const timer = setInterval(backgroundRefresh, 30000);
    const unsubscribe = webSocketService.subscribe((n) => {
      if (n.category === "mailroom") backgroundRefresh();
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
      generation.current++;
    };
  }, [refresh, create, selectedId]);
  useEffect(() => {
    void loadDetail();
    return () => {
      detailGeneration.current++;
    };
  }, [loadDetail]);
  useEffect(() => {
    let alive = true;
    if (
      enabled &&
      (hasPermission(user, "mailroom:read") ||
        hasPermission(user, "repair_workbench:read"))
    )
      api
        .get<Person[]>("/mailroom/people", { params: { entityId } })
        .then((r) => {
          if (alive) setPeople(r.data);
        })
        .catch(() => {
          if (alive) setPeople([]);
        });
    return () => {
      alive = false;
      setPeople([]);
    };
  }, [entityId, enabled, user]);
  function openItem(id?: string) {
    const next = new URLSearchParams(params);
    if (id) next.set("itemId", id);
    else next.delete("itemId");
    setParams(next);
  }
  if (!enabled)
    return (
      <Alert
        type="info"
        message="收發室工作台尚未啟用"
        description="完成測試與帳號設定後即可開放。"
      />
    );
  const visible =
    mode === "mine"
      ? rows.filter(
          (x) =>
            (!status || x.status === status) &&
            (!search ||
              [x.productName, x.label, x.receipt.sourceNumber].some((v) =>
                v?.includes(search),
              )),
        )
      : rows;
  return (
    <div className="mailroom-page">
      <div className="mailroom-heading">
        <div>
          <Text className="mailroom-eyebrow">
            {mode === "mailroom"
              ? "行政部 · 收件與交接"
              : mode === "repair"
                ? "維修部 · 檢測與處理"
                : "個人工作 · 待辦與簽領"}
          </Text>
          <Title level={2}>
            {mode === "mailroom"
              ? "收發室工作台"
              : mode === "repair"
                ? "維修工作台"
                : "我的待辦與收件"}
          </Title>
          <Paragraph type="secondary">
            {mode === "mailroom"
              ? "售後案件自動列入待到貨；收到實物後核對，再交給下一位同仁簽收。"
              : mode === "repair"
                ? "先確認實物並簽收，再逐步記錄檢測、維修與整新結果。"
                : "查看交辦給你的物件。通知已讀後，待辦仍保留至完成簽收或處理。"}
          </Paragraph>
        </div>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              void refresh();
              setArrivalRevision((value) => value + 1);
            }}
          >
            重新整理
          </Button>
          {mode === "mailroom" && hasPermission(user, "mailroom:create") ? (
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              onClick={() => {
                setCreateSource(undefined);
                setCreate(true);
              }}
            >
              登記收件
            </Button>
          ) : null}
        </Space>
      </div>
      <div className="mailroom-process">
        {(mode === "repair"
          ? ["本人簽收", "檢測／整新", "客服確認", "維修處理", "交回收發室"]
          : ["登記到件", "核對／檢查", "通知交接", "對方簽收", "追蹤後續"]
        ).map((label, index) => (
          <span key={label}>
            <b>{index + 1}</b>
            {label}
          </span>
        ))}
      </div>
      {error ? (
        <Alert
          type="error"
          showIcon
          message="目前無法載入"
          description={error}
          action={<Button onClick={() => void refresh()}>重試</Button>}
        />
      ) : null}
      {mode === "mailroom" ? (
        <Tabs
          activeKey={listTab}
          onChange={setListTab}
          items={[
            { key: "awaiting", label: "待到貨案件" },
            { key: "received", label: "已收件物件" },
          ]}
        />
      ) : null}
      {mode === "mailroom" && listTab === "awaiting" ? (
        <AwaitingCases
          entityId={entityId}
          paused={create || !!selectedId}
          revision={arrivalRevision}
          canCreate={hasPermission(user, "mailroom:create")}
          onReceive={(source) => {
            setCreateSource(source);
            setCreate(true);
          }}
        />
      ) : null}
      {mode !== "mailroom" || listTab === "received" ? (
        <Card
          className="mailroom-list"
          title={
            <Space>
              {mode === "repair" ? <ToolOutlined /> : <InboxOutlined />}
              <span>{mode === "mine" ? "交辦與收件紀錄" : "物件與進度"}</span>
              <Tag>{total} 件</Tag>
            </Space>
          }
        >
          <div className="mailroom-filters">
            <Input.Search
              aria-label="搜尋物件"
              placeholder="搜尋案件、產品、SN 或存放位置"
              allowClear
              onSearch={(value) => {
                setSearch(value);
                setPage(1);
              }}
              style={{ maxWidth: 420 }}
            />
            <Select
              aria-label="篩選進度"
              placeholder="全部進度"
              value={status}
              allowClear
              style={{ minWidth: 235 }}
              options={Object.entries(STATUS).map(([value, label]) => ({
                value,
                label,
              }))}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            />
          </div>
          <Table<Item>
            rowKey="id"
            loading={loading}
            dataSource={visible}
            locale={{
              emptyText: (
                <Empty
                  description={
                    mode === "repair"
                      ? "目前沒有指派給你的維修或整新物件"
                      : "目前沒有符合條件的收件"
                  }
                />
              ),
            }}
            scroll={{ x: 1130 }}
            pagination={
              mode === "mine"
                ? { pageSize: 20 }
                : {
                    current: page,
                    pageSize: 50,
                    total,
                    onChange: setPage,
                    showSizeChanger: false,
                  }
            }
            columns={[
              {
                title: "物件／來源",
                key: "product",
                width: 310,
                render: (_, item) => (
                  <div>
                    <Button
                      type="link"
                      className="mailroom-item-link"
                      onClick={() => openItem(item.id)}
                    >
                      {item.productName}
                    </Button>
                    <div>
                      <Tag>{CATEGORIES[item.receipt.category]}</Tag>
                      <Text type="secondary">
                        {item.receipt.sourceNumber ||
                          item.receipt.senderLabel ||
                          "一般收件"}
                      </Text>
                    </div>
                    <Text className="mailroom-meta">{item.label}</Text>
                  </div>
                ),
              },
              {
                title: "目前進度",
                dataIndex: "status",
                width: 230,
                render: (s: string, item) => (
                  <>
                    <Tag color={statusColor(s)}>{STATUS[s] || s}</Tag>
                    {item.grade ? (
                      <div className="mailroom-meta">
                        {item.grade} 級 · {DISPOSITIONS[item.disposition || ""]}
                      </div>
                    ) : null}
                  </>
                ),
              },
              {
                title: "位置／保管人",
                width: 200,
                key: "custody",
                render: (_, item) => (
                  <>
                    <div>{item.location}</div>
                    <Text type="secondary">{item.custodianName}</Text>
                  </>
                ),
              },
              {
                title: "下一位同仁",
                width: 160,
                dataIndex: "nextUserName",
                render: (value: string) => value || "待後續安排",
              },
              {
                title: "收件時間",
                width: 110,
                key: "date",
                render: (_, item) => date(item.receipt.receivedAt),
              },
              {
                title: "",
                key: "open",
                width: 120,
                render: (_, item) => (
                  <Button onClick={() => openItem(item.id)}>
                    {item.mine ? "處理待辦" : "查看紀錄"}
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      ) : null}
      <Drawer
        title="物件進度與交接"
        width={720}
        open={!!selectedId}
        onClose={() => openItem()}
        destroyOnHidden
      >
        <Spin spinning={detailLoading}>
          {detail ? (
            <ItemDetail
              key={detail.id + ":" + detail.version}
              item={detail}
              userId={user?.id || ""}
              entityId={entityId}
              people={people}
              canMail={canMail}
              canRepair={canRepair}
              canReview={canReview}
              canAdmin={isAdminUser(user)}
              onSaved={async () => {
                await Promise.all([loadDetail(), refresh()]);
              }}
            />
          ) : !detailLoading ? (
            <Empty description="物件不存在，或你沒有查看權限" />
          ) : null}
        </Spin>
      </Drawer>
      <ReceiptDrawer
        initialSource={createSource}
        open={create}
        entityId={entityId}
        people={people}
        onClose={() => setCreate(false)}
        onCreated={(id) => {
          setCreate(false);
          void refresh();
          setArrivalRevision((value) => value + 1);
          setListTab("received");
          openItem(id);
        }}
      />
    </div>
  );
}
function AwaitingCases({
  entityId,
  paused,
  revision,
  canCreate,
  onReceive,
}: {
  entityId: string;
  paused: boolean;
  revision: number;
  canCreate: boolean;
  onReceive: (source: Source) => void;
}) {
  const [cases, setCases] = useState<Source[]>([]),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [moreBusy, setMoreBusy] = useState(false),
    [failure, setFailure] = useState("");
  const pages = useRef(1),
    generation = useRef(0);
  const refresh = useCallback(
    async (quiet = false) => {
      if (!entityId) return;
      const id = ++generation.current;
      if (!quiet) setLoading(true);
      try {
        let next: string | null = null;
        const items: Source[] = [];
        for (let page = 0; page < pages.current; page++) {
          const result: {
            data: { items: Source[]; nextCursor: string | null };
          } = await api.get<{
            items: Source[];
            nextCursor: string | null;
          }>("/mailroom/source-cases", {
            params: {
              entityId,
              awaiting: true,
              search,
              ...(next ? { cursor: next } : {}),
            },
          });
          items.push(...result.data.items);
          next = result.data.nextCursor || null;
          if (!next) break;
        }
        if (generation.current === id) {
          setCases([...new Map(items.map((item) => [item.id, item])).values()]);
          setCursor(next);
          setFailure("");
        }
      } catch (error) {
        if (generation.current === id) setFailure(errorText(error));
      } finally {
        if (generation.current === id) setLoading(false);
      }
    },
    [entityId, search],
  );
  useEffect(() => {
    pages.current = 1;
    setCases([]);
    setCursor(null);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, revision]);
  useEffect(() => {
    const poll = () => {
      if (!paused && document.visibilityState === "visible" && !moreBusy)
        void refresh(true);
    };
    const timer = setInterval(poll, 30000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [paused, moreBusy, refresh]);
  async function loadMore() {
    if (!cursor || moreBusy) return;
    const id = ++generation.current;
    setMoreBusy(true);
    try {
      const result = await api.get<{
        items: Source[];
        nextCursor: string | null;
      }>("/mailroom/source-cases", {
        params: { entityId, awaiting: true, search, cursor },
      });
      if (generation.current === id) {
        pages.current++;
        setCases((old) => [
          ...new Map(
            [...old, ...result.data.items].map((item) => [item.id, item]),
          ).values(),
        ]);
        setCursor(result.data.nextCursor || null);
        setFailure("");
      }
    } catch (error) {
      if (generation.current === id) setFailure(errorText(error));
    } finally {
      setMoreBusy(false);
    }
  }
  return (
    <Card
      className="mailroom-list"
      title={
        <Space>
          <InboxOutlined />
          <span>售後待到貨</span>
          <Tag>{cases.length} 筆已載入</Tag>
        </Space>
      }
    >
      <Paragraph type="secondary">
        自動顯示尚有產品未到貨的維修與退貨案件。登記收件只計入這次實際收到的物件。
      </Paragraph>
      <Input.Search
        aria-label="搜尋待到貨案件"
        placeholder="搜尋售後案件單號"
        allowClear
        onSearch={setSearch}
        style={{ maxWidth: 420, marginBottom: 20 }}
      />
      {failure ? (
        <Alert
          type="warning"
          showIcon
          message="待到貨清單暫時無法更新"
          description={failure}
          action={<Button onClick={() => void refresh()}>重試</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Table<Source>
        rowKey="id"
        loading={loading}
        dataSource={cases}
        pagination={false}
        scroll={{ x: 1000 }}
        locale={{
          emptyText: (
            <Empty
              description={
                cursor
                  ? "這批案件均已收齊，可繼續載入較早案件"
                  : "目前沒有待到貨案件"
              }
            />
          ),
        }}
        columns={[
          {
            title: "售後案件／品項",
            width: 350,
            key: "source",
            render: (_, source) => (
              <div>
                <strong>{source.number}</strong>
                <div>
                  <Tag>{CATEGORIES[source.type] || source.type}</Tag>
                  <Text type="secondary">{source.customerLabel}</Text>
                </div>
                <Text className="mailroom-meta">
                  {source.items
                    .map((item) => `${item.name} × ${item.quantity}`)
                    .join("、")}
                </Text>
              </div>
            ),
          },
          {
            title: "售後進度",
            width: 180,
            dataIndex: "status",
            render: (value, source) => <Tag>{source.statusLabel || value}</Tag>,
          },
          {
            title: "到貨數量",
            width: 160,
            key: "quantity",
            render: (_, source) => (
              <>
                <div>
                  已收到 {source.receivedQuantity ?? 0}／
                  {source.expectedQuantity ??
                    source.items.reduce(
                      (sum, item) => sum + item.quantity,
                      0,
                    )}{" "}
                  件
                </div>
                <Text type="secondary">
                  尚待{" "}
                  {source.remainingQuantity ??
                    source.items.reduce(
                      (sum, item) =>
                        sum + (item.remainingQuantity ?? item.quantity),
                      0,
                    )}{" "}
                  件
                </Text>
              </>
            ),
          },
          {
            title: "承辦客服",
            width: 180,
            key: "assignee",
            render: (_, source) =>
              source.assigneeName ||
              source.assigneeEmail || (
                <Text type="secondary">待指定承辦客服</Text>
              ),
          },
          {
            title: "",
            width: 130,
            key: "receive",
            render: (_, source) =>
              canCreate ? (
                <Button type="primary" onClick={() => onReceive(source)}>
                  登記收件
                </Button>
              ) : null,
          },
        ]}
      />
      {cursor ? (
        <Button
          className="mailroom-load-more"
          loading={moreBusy}
          disabled={loading}
          onClick={() => void loadMore()}
        >
          載入更多待到貨案件
        </Button>
      ) : null}
    </Card>
  );
}
function ItemDetail({
  item,
  userId,
  entityId,
  people,
  canMail,
  canRepair,
  canReview,
  canAdmin,
  onSaved,
}: {
  item: Item;
  userId: string;
  entityId: string;
  people: Person[];
  canMail: boolean;
  canRepair: boolean;
  canReview: boolean;
  canAdmin: boolean;
  onSaved: () => Promise<void>;
}) {
  const [action, setAction] = useState<string>(),
    [busy, setBusy] = useState(false),
    [photos, setPhotos] = useState<string[]>([]),
    [failure, setFailure] = useState("");
  const [tablet, setTablet] = useState(false);
  const [form] = Form.useForm();
  const operation = useRef<{ body: string; id: string } | undefined>(undefined);
  const mine = item.nextUserId === userId,
    ownRepair =
      canRepair && item.repairOwnerId === userId && item.custodianId === userId;
  const actions: string[] = [];
  if (
    canReview &&
    (canAdmin || item.receipt.customerServiceUserId === userId) &&
    item.receipt.category === "RETURN" &&
    item.returnInspection &&
    !item.returnInspection.reviewedAt &&
    !["MISMATCH", "RECEIVED"].includes(item.status)
  )
    actions.push("acknowledge_inspection");
  if (
    canMail &&
    item.receipt.category === "UNMATCHED" &&
    item.status === "RECEIVED"
  )
    actions.push("identify");
  if (
    canMail &&
    item.status === "RECEIVED" &&
    item.receipt.category === "REPAIR"
  )
    actions.push("inspect");
  if (
    canMail &&
    [
      "RECEIVED",
      "PENDING_RESTOCK",
      "PENDING_DISPOSITION",
      "PENDING_REFURBISH",
    ].includes(item.status) &&
    item.receipt.category === "RETURN"
  )
    actions.push("grade");
  if (canReview && item.status === "MISMATCH") actions.push("resolve_mismatch");
  if (canReview && item.status === "WAITING_CUSTOMER")
    actions.push("resolve_customer");
  if (
    mine &&
    [
      "WAITING_PICKUP",
      "WAITING_REPAIR_ACCEPTANCE",
      "PENDING_REFURBISH",
    ].includes(item.status) &&
    (item.status === "WAITING_PICKUP" || canRepair)
  )
    actions.push("accept");
  if (mine && canMail && item.status === "WAITING_RETURN_ACCEPTANCE")
    actions.push("accept_return");
  if (ownRepair && item.status === "REPAIR_RECEIVED")
    actions.push("start_inspection");
  if (
    ownRepair &&
    ["REPAIR_RECEIVED", "INSPECTING", "REPAIRING"].includes(item.status)
  )
    actions.push("await_customer");
  if (ownRepair && item.status === "INSPECTING") actions.push("start_repair");
  if (ownRepair && item.status === "REPAIRING") actions.push("complete_repair");
  if (ownRepair && item.status === "REFURBISHING")
    actions.push("complete_refurbish");
  if (
    canMail &&
    [
      "WAITING_PICKUP",
      "WAITING_REPAIR_ACCEPTANCE",
      "PENDING_REFURBISH",
      "WAITING_RETURN_ACCEPTANCE",
    ].includes(item.status)
  )
    actions.push("assign");
  if (
    canMail &&
    [
      "RECEIVED",
      "MISMATCH",
      "WAITING_REPAIR_ACCEPTANCE",
      "PENDING_RESTOCK",
      "PENDING_DISPOSITION",
      "PENDING_REFURBISH",
    ].includes(item.status)
  )
    actions.push("correct");
  if (canMail && item.custodianId === userId && item.status !== "COLLECTED")
    actions.push("move");
  const match = Form.useWatch("matchResult", form),
    grade = Form.useWatch("grade", form);
  const targetCategory = Form.useWatch("targetCategory", form),
    identifyCase = Form.useWatch("sourceCaseId", form);
  const [identifySources, setIdentifySources] = useState<Source[]>([]),
    [identifyLoading, setIdentifyLoading] = useState(false);
  async function findIdentifySources(search: string) {
    setIdentifyLoading(true);
    try {
      const result = await api.get<{ items: Source[] }>(
        "/mailroom/source-cases",
        { params: { entityId, search } },
      );
      setIdentifySources(result.data.items);
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setIdentifyLoading(false);
    }
  }
  const identifyGeneral =
    action === "identify" && ["LETTER", "PARCEL"].includes(targetCategory);
  const needsNext =
    identifyGeneral ||
    (action === "resolve_mismatch" && item.receipt.category !== "RETURN") ||
    action === "assign" ||
    (action === "inspect" && match === "MATCH") ||
    (action === "grade" && match === "MATCH" && ["B", "C"].includes(grade));
  const targetPeople = people.filter((p) =>
    identifyGeneral || (action === "assign" && item.status === "WAITING_PICKUP")
      ? true
      : action === "assign" && item.status === "WAITING_RETURN_ACCEPTANCE"
        ? p.mailroom
        : p.repair,
  );
  function choose(value: string) {
    setAction(value);
    setFailure("");
    setPhotos([]);
    form.resetFields();
    form.setFieldsValue({
      productName: item.productName,
      sku: item.sku || "",
      serialNumber: item.serialNumber || "",
      location: item.location,
      ...(value === "grade" && item.returnInspection
        ? {
            returnInspection: {
              packaging: item.returnInspection.packaging,
              product: item.returnInspection.product,
              accessories: item.returnInspection.accessories,
            },
            grade: item.grade || undefined,
            disposition: item.disposition || undefined,
          }
        : {}),
    });
  }
  async function save() {
    try {
      const values = await form.validateFields();
      if (action === "grade" && !photos.length && !item.evidence?.length) {
        setFailure("退貨檢查至少需留存一張有效實物照片，請拍照留底後再儲存。");
        return;
      }
      const body = JSON.stringify({
        ...values,
        entityId,
        action,
        expectedVersion: item.version,
        ...(photos.length ? { evidence: photos } : {}),
      });
      if (operation.current?.body !== body)
        operation.current = { body, id: requestId() };
      setBusy(true);
      setFailure("");
      await api.post("/mailroom/items/" + item.id + "/actions", {
        ...JSON.parse(body),
        requestId: operation.current.id,
      });
      message.success("已更新進度並建立交接紀錄");
      setAction(undefined);
      await onSaved();
    } catch (e) {
      if (!(e as { errorFields?: unknown }).errorFields)
        setFailure(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const canTablet =
    canMail &&
    item.custodianId === userId &&
    !!item.nextUserId &&
    ["WAITING_REPAIR_ACCEPTANCE", "PENDING_REFURBISH"].includes(item.status);
  const missingCustomerService =
    !!item.receipt.sourceCaseId &&
    !item.receipt.customerServiceUserId &&
    (["MISMATCH", "WAITING_CUSTOMER"].includes(item.status) ||
      (item.receipt.category === "RETURN" && !!item.grade));
  return (
    <div className="mailroom-detail">
      <Title level={3}>{item.productName}</Title>
      {canReview &&
      (item.receipt.category === "REPAIR" || item.repairOwnerId) ? (
        <RepairDocuments
          item={{ ...(item as RepairItem), editable: false }}
          entityId={entityId}
          onSaved={onSaved}
        />
      ) : null}
      <Space wrap>
        <Tag>{CATEGORIES[item.receipt.category]}</Tag>
        <Tag color={statusColor(item.status)}>{STATUS[item.status]}</Tag>
        <Text type="secondary">{item.label}</Text>
      </Space>
      <Descriptions
        column={{ xs: 1, sm: 2 }}
        size="small"
        bordered
        style={{ marginTop: 20 }}
        items={[
          {
            key: "source",
            label: "售後案件",
            children: item.receipt.sourceNumber || "一般收件",
          },
          {
            key: "time",
            label: "收件時間",
            children: date(item.receipt.receivedAt),
          },
          {
            key: "declared",
            label: "原申報",
            children: item.declared
              ? `${item.declared.name} · SKU ${item.declared.sku || "未提供"} · SN ${item.declared.serialNumber || "未提供"}`
              : "無售後申報",
          },
          { key: "actual", label: "實收品項", children: item.productName },
          { key: "sku", label: "SKU", children: item.sku || "未提供" },
          { key: "sn", label: "SN", children: item.serialNumber || "未提供" },
          { key: "location", label: "存放位置", children: item.location },
          { key: "owner", label: "目前保管", children: item.custodianName },
          {
            key: "next",
            label: "下一位同仁",
            children: item.nextUserName || "待後續安排",
          },
          {
            key: "grade",
            label: "分級與去向",
            children: item.grade
              ? `${item.grade} · ${DISPOSITIONS[item.disposition || ""]}`
              : "尚未分級",
          },
        ]}
      />
      {missingCustomerService ? (
        <Alert
          type="warning"
          showIcon
          message="尚未對應承辦客服"
          description="請指定售後承辦客服，以便異常與退貨檢查結果交接給正確同仁。"
          style={{ marginTop: 16 }}
        />
      ) : null}
      {item.returnInspection ? (
        <Descriptions
          column={1}
          size="small"
          style={{ marginTop: 16 }}
          items={[
            {
              key: "packaging",
              label: "包裝",
              children:
                RETURN_PACKAGING[
                  item.returnInspection
                    .packaging as keyof typeof RETURN_PACKAGING
                ] || item.returnInspection.packaging,
            },
            {
              key: "product",
              label: "產品外觀",
              children:
                RETURN_PRODUCT[
                  item.returnInspection.product as keyof typeof RETURN_PRODUCT
                ] || item.returnInspection.product,
            },
            {
              key: "accessories",
              label: "配件",
              children:
                RETURN_ACCESSORIES[
                  item.returnInspection
                    .accessories as keyof typeof RETURN_ACCESSORIES
                ] || item.returnInspection.accessories,
            },
            {
              key: "review",
              label: "客服接手",
              children: item.returnInspection.reviewedAt
                ? `已接手 · ${date(item.returnInspection.reviewedAt)}`
                : "等待承辦客服確認",
            },
          ]}
        />
      ) : null}
      {item.conditionNote ? (
        <Paragraph style={{ marginTop: 16 }}>
          處理備註：{item.conditionNote}
        </Paragraph>
      ) : null}
      {item.evidence?.length ? (
        <Image.PreviewGroup>
          <Space wrap>
            {item.evidence.map((src, i) => (
              <Image
                key={i}
                width={96}
                height={96}
                style={{ objectFit: "cover" }}
                src={src}
                alt={`實收照片 ${i + 1}`}
              />
            ))}
          </Space>
        </Image.PreviewGroup>
      ) : null}
      <Divider orientation="left">更新進度</Divider>
      {actions.length || canTablet ? (
        <Space wrap>
          {canTablet ? (
            <Button
              type="primary"
              size="large"
              onClick={() => {
                setAction(undefined);
                setTablet(true);
              }}
            >
              平板交接簽收
            </Button>
          ) : null}
          {actions.map((value, index) => (
            <Button
              key={value}
              type={
                action === value || (!action && index === 0)
                  ? "primary"
                  : "default"
              }
              onClick={() => choose(value)}
            >
              {ACTIONS[value]}
            </Button>
          ))}
        </Space>
      ) : (
        <Text type="secondary">
          {item.status === "COLLECTED"
            ? "此物件已由本人簽領，可查看下方紀錄。"
            : "目前等待下一個流程；可從下方查看完整紀錄。"}
        </Text>
      )}
      <TabletAcceptance
        open={tablet}
        item={item}
        entityId={entityId}
        onClose={() => setTablet(false)}
        onSaved={onSaved}
      />
      {action ? (
        <Card size="small" title={ACTIONS[action]} className="mailroom-action">
          <Form
            form={form}
            layout="vertical"
            preserve={false}
            initialValues={{
              productName: item.productName,
              sku: item.sku || "",
              serialNumber: item.serialNumber || "",
              location: item.location,
            }}
          >
            {action === "identify" ? (
              <>
                <Form.Item
                  name="targetCategory"
                  label="確認收件類別"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={Object.entries(CATEGORIES)
                      .filter(([value]) => value !== "UNMATCHED")
                      .map(([value, label]) => ({ value, label }))}
                    onChange={() => {
                      form.setFieldsValue({
                        sourceCaseId: undefined,
                        sourceItemId: undefined,
                        nextUserId: undefined,
                      });
                      setIdentifySources([]);
                    }}
                  />
                </Form.Item>
                {["REPAIR", "RETURN"].includes(targetCategory) ? (
                  <>
                    <Input.Search
                      placeholder="搜尋售後案件編號"
                      onSearch={(value) => void findIdentifySources(value)}
                      loading={identifyLoading}
                    />
                    <Form.Item
                      name="sourceCaseId"
                      label="對應售後案件"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={identifySources
                          .filter((x) => x.type === targetCategory)
                          .map((x) => ({
                            value: x.id,
                            label: x.number + " · " + x.customerLabel,
                          }))}
                        onChange={() =>
                          form.setFieldValue("sourceItemId", undefined)
                        }
                      />
                    </Form.Item>
                    <Form.Item
                      name="sourceItemId"
                      label="對照申報品項"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={(
                          identifySources.find((x) => x.id === identifyCase)
                            ?.items || []
                        ).map((x) => ({ value: x.id, label: x.name }))}
                      />
                    </Form.Item>
                  </>
                ) : null}
              </>
            ) : null}
            {["inspect", "correct"].includes(action) ? (
              <>
                {field("實收產品", "productName", true)}
                <div className="mailroom-form-grid">
                  {field("實收 SKU", "sku")}
                  {field("實收 SN", "serialNumber")}
                </div>
              </>
            ) : null}
            {["inspect", "grade"].includes(action) ? (
              <Form.Item
                name="matchResult"
                label="與顧客申報是否一致"
                rules={[{ required: true, message: "請核對後選擇" }]}
              >
                <Select
                  options={[
                    {
                      value: "MATCH",
                      label:
                        action === "grade"
                          ? "一致，完成退貨檢查"
                          : "一致，通知維修簽收",
                    },
                    { value: "MISMATCH", label: "不一致，交客服重新確認" },
                  ]}
                />
              </Form.Item>
            ) : null}
            {action === "grade" ? (
              <>
                <Alert
                  type="info"
                  message="AA：重新入庫；A：瑕疵補寄／福利品；B、C：整理後福利品"
                  description="記錄包裝、產品外觀與配件狀況，實際庫存處理由後續入庫流程完成。"
                />
                <Form.Item
                  name={["returnInspection", "packaging"]}
                  label="包裝完整性"
                  rules={[
                    { required: true, message: "請實際檢查後選擇包裝狀況" },
                  ]}
                >
                  <Select
                    placeholder="請檢查後選擇"
                    options={options(RETURN_PACKAGING)}
                  />
                </Form.Item>
                <Form.Item
                  name={["returnInspection", "product"]}
                  label="產品外觀"
                  rules={[
                    { required: true, message: "請選擇產品實際外觀狀況" },
                  ]}
                >
                  <Select
                    placeholder="請檢查後選擇"
                    options={options(RETURN_PRODUCT)}
                  />
                </Form.Item>
                <Form.Item
                  name={["returnInspection", "accessories"]}
                  label="配件狀況"
                  rules={[{ required: true, message: "請確認配件狀況" }]}
                >
                  <Select
                    placeholder="請檢查後選擇"
                    options={options(RETURN_ACCESSORIES)}
                  />
                </Form.Item>
                <Form.Item
                  name="grade"
                  label="檢查分級"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={[
                      { value: "AA", label: "AA · 全新未使用，配件完整" },
                      { value: "A", label: "A · 輕微磨損，配件完整" },
                      { value: "B", label: "B · 明顯磨損" },
                      { value: "C", label: "C · 嚴重磨損" },
                    ]}
                  />
                </Form.Item>
                {grade === "A" ? (
                  <Form.Item
                    name="disposition"
                    label="A 級後續用途"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={[
                        { value: "DEFECT_REPLACEMENT", label: "瑕疵補寄" },
                        { value: "WELFARE_SALE", label: "福利品販售" },
                      ]}
                    />
                  </Form.Item>
                ) : null}
              </>
            ) : null}
            {needsNext ? (
              <Form.Item
                name="nextUserId"
                label={
                  identifyGeneral
                    ? "收件同仁"
                    : action === "assign"
                      ? "新接收人"
                      : "維修／整新人員"
                }
                rules={[{ required: true, message: "請指定接收人" }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={targetPeople.map((p) => ({
                    value: p.id,
                    label: `${p.department} · ${p.name}`,
                  }))}
                  notFoundContent="尚無具備權限的在職同仁"
                />
              </Form.Item>
            ) : null}
            {["accept", "accept_return", "move"].includes(action)
              ? field("簽收後／異動後位置", "location", true)
              : null}
            {["accept", "accept_return"].includes(action) ? (
              <Form.Item
                name="confirmedItems"
                valuePropName="checked"
                rules={[
                  {
                    validator: (_, value) =>
                      value
                        ? Promise.resolve()
                        : Promise.reject(new Error("請先核對實物並勾選確認")),
                  },
                ]}
              >
                <Checkbox>我已逐件確認物件，並由本人接收保管</Checkbox>
              </Form.Item>
            ) : null}
            {action === "start_repair" ? (
              <Alert
                type="info"
                message="開始前會再次確認售後案件的顧客同意與必要款項。"
              />
            ) : null}
            <Form.Item
              name="note"
              label={
                action === "resolve_mismatch"
                  ? "客服與顧客確認結果（含依據）"
                  : action === "acknowledge_inspection"
                    ? "客服接手紀錄"
                    : "原因／檢查與處理結果"
              }
              rules={
                [
                  "identify",
                  "acknowledge_inspection",
                  "inspect",
                  "grade",
                  "correct",
                  "move",
                  "assign",
                  "resolve_mismatch",
                  "resolve_customer",
                  "await_customer",
                  "complete_repair",
                  "complete_refurbish",
                ].includes(action)
                  ? [
                      {
                        required: true,
                        whitespace: true,
                        message: "請填寫處理結果",
                      },
                    ]
                  : []
              }
            >
              <Input.TextArea rows={3} maxLength={2000} showCount />
            </Form.Item>
            {[
              "inspect",
              "grade",
              "correct",
              "complete_repair",
              "complete_refurbish",
            ].includes(action) ? (
              <div>
                {action === "grade" ? (
                  <Paragraph>
                    退貨檢查須留存至少 1
                    張照片。請拍攝外包裝、產品與配件；有瑕疵時補拍清楚特寫。
                    {item.evidence?.length
                      ? `已留存 ${item.evidence.length} 張；未新增照片時沿用目前照片。`
                      : ""}
                  </Paragraph>
                ) : null}
                <Upload
                  accept="image/png,image/jpeg,image/webp"
                  capture="environment"
                  showUploadList={false}
                  beforeUpload={async (file) => {
                    if (photos.length >= 4 || file.size > 1024 * 1024) {
                      message.error("最多 4 張，每張 1 MB 以下");
                      return false;
                    }
                    if (
                      !["image/png", "image/jpeg", "image/webp"].includes(
                        file.type,
                      )
                    ) {
                      message.error("請選擇 PNG、JPEG 或 WebP 實物照片");
                      return false;
                    }
                    try {
                      const bitmap = await createImageBitmap(file);
                      bitmap.close();
                    } catch {
                      message.error("照片無法讀取，請重新拍攝或選擇有效照片");
                      return false;
                    }
                    const result = await new Promise<string>(
                      (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result));
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                      },
                    );
                    setPhotos((old) => [...old, result].slice(0, 4));
                    return false;
                  }}
                >
                  <Button icon={<UploadOutlined />}>附上實物照片</Button>
                </Upload>
                <Space wrap style={{ marginTop: 10 }}>
                  {photos.map((src, i) => (
                    <div key={i}>
                      <Image width={72} src={src} alt={`待上傳照片 ${i + 1}`} />
                      <Button
                        size="small"
                        onClick={() =>
                          setPhotos((old) => old.filter((_, j) => i !== j))
                        }
                      >
                        移除
                      </Button>
                    </div>
                  ))}
                </Space>
              </div>
            ) : null}
            {failure ? (
              <Alert type="error" message={failure} style={{ marginTop: 16 }} />
            ) : null}
            <Space style={{ marginTop: 20 }}>
              <Button type="primary" loading={busy} onClick={() => void save()}>
                確認儲存
              </Button>
              <Button disabled={busy} onClick={() => setAction(undefined)}>
                取消
              </Button>
            </Space>
          </Form>
        </Card>
      ) : null}
      {item.receipt.sourceCaseId ? (
        <>
          <Divider orientation="left">客服同步</Divider>
          <Space wrap>
            {["AFTER_SALES", "AI_CUSTOMER_SERVICE"].map((target) => {
              const deliveries = (
                item.deliverySummary ||
                item.deliveries ||
                []
              ).filter((x) => x.target === target);
              const pending = deliveries.some((x) => x.status !== "DELIVERED");
              return (
                <Tag key={target} color={pending ? "orange" : "green"}>
                  {target === "AFTER_SALES" ? "售後系統" : "AI 客服"}：
                  {pending
                    ? "待同步"
                    : deliveries.length
                      ? "已同步"
                      : "尚無紀錄"}
                </Tag>
              );
            })}
          </Space>
        </>
      ) : null}
      <Divider orientation="left">進度紀錄</Divider>
      <Timeline
        items={(item.history || []).map((event) => ({
          children: (
            <div>
              <strong>{ACTIONS[event.action] || event.action}</strong>
              <div>
                {STATUS[event.toStatus]} · {event.actorName}
              </div>
              {event.note ? <Paragraph>{event.note}</Paragraph> : null}
              {event.snapshot?.evidence?.length ? (
                <Image.PreviewGroup>
                  <Space>
                    {event.snapshot.evidence.map((src, i) => (
                      <Image
                        key={i}
                        src={src}
                        width={48}
                        alt={`歷程照片 ${i + 1}`}
                      />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              ) : null}
              <Text type="secondary">
                {date(event.createdAt)} · 第 {event.version} 次紀錄
              </Text>
            </div>
          ),
        }))}
      />
    </div>
  );
}
function sourcePhysicalRows(source: Source) {
  return source.items
    .flatMap((item) =>
      Array.from(
        { length: Math.min(item.remainingQuantity ?? item.quantity, 50) },
        () => ({
          productName: item.name,
          sku: item.sku || "",
          serialNumber: item.serialNumber || "",
          sourceItemId: item.id,
        }),
      ),
    )
    .slice(0, 50);
}
function ReceiptDrawer({
  initialSource,
  open,
  entityId,
  people,
  onClose,
  onCreated,
}: {
  initialSource?: Source;
  open: boolean;
  entityId: string;
  people: Person[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form] = Form.useForm(),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState<Source>(),
    [error, setError] = useState("");
  const category = Form.useWatch("category", form);
  const operation = useRef<{ body: string; id: string } | undefined>(undefined);
  const isCase = ["REPAIR", "RETURN"].includes(category);
  const isCorrespondence = ["LETTER", "PARCEL"].includes(category);
  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue(
        initialSource
          ? {
              category: initialSource.type,
              sourceCaseId: initialSource.id,
              items: sourcePhysicalRows(initialSource),
            }
          : { category: "REPAIR", items: [{ productName: "" }] },
      );
      setError("");
      setSource(initialSource);
      operation.current = undefined;
    }
  }, [open, form, initialSource]);
  async function submit() {
    try {
      const values = await form.validateFields();
      const caseCategory = ["REPAIR", "RETURN"].includes(values.category);
      const correspondence = ["LETTER", "PARCEL"].includes(values.category);
      const body = JSON.stringify({
        entityId,
        category: values.category,
        ...(caseCategory ? { sourceCaseId: values.sourceCaseId } : {}),
        ...(["LETTER", "PARCEL"].includes(values.category)
          ? { recipientId: values.recipientId }
          : {}),
        carrier: values.carrier,
        trackingNumber: values.trackingNumber,
        senderLabel: values.senderLabel,
        location: values.location,
        items: values.items.map(
          (row: {
            productName: string;
            sku?: string;
            serialNumber?: string;
            sourceItemId?: string;
          }) => ({
            productName: row.productName,
            ...(!correspondence
              ? { sku: row.sku, serialNumber: row.serialNumber }
              : {}),
            ...(caseCategory ? { sourceItemId: row.sourceItemId } : {}),
          }),
        ),
      });
      if (operation.current?.body !== body)
        operation.current = { body, id: requestId() };
      setBusy(true);
      setError("");
      const result = await api.post("/mailroom/receipts", {
        ...JSON.parse(body),
        requestId: operation.current.id,
      });
      message.success("已登記收件");
      onCreated(result.data.itemIds[0]);
    } catch (e) {
      if (!(e as { errorFields?: unknown }).errorFields) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="登記收件"
      width={700}
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      forceRender
      footer={
        <Space>
          <Button
            type="primary"
            size="large"
            loading={busy}
            onClick={() => void submit()}
          >
            登記並建立待辦
          </Button>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        preserve
        initialValues={
          initialSource
            ? {
                category: initialSource.type,
                sourceCaseId: initialSource.id,
                items: sourcePhysicalRows(initialSource),
              }
            : { category: "REPAIR", items: [{ productName: "" }] }
        }
      >
        <Form.Item
          name="category"
          label="所屬類別"
          rules={[{ required: true }]}
        >
          <Select
            options={Object.entries(CATEGORIES).map(([value, label]) => ({
              value,
              label,
            }))}
            onChange={() => {
              setSource(undefined);
              form.setFieldsValue({
                sourceCaseId: undefined,
                recipientId: undefined,
                items: [{ productName: "" }],
              });
            }}
          />
        </Form.Item>
        {isCase ? (
          <>
            <Form.Item
              name="sourceCaseId"
              label="對應售後案件"
              rules={[{ required: true, message: "請輸入並選擇售後案件" }]}
            >
              <SourceCasePicker
                entityId={entityId}
                active={open && isCase}
                selectedSource={source}
                onSelectSource={(selected) => {
                  setSource(selected);
                  form.setFieldsValue({
                    category: selected.type,
                    items: sourcePhysicalRows(selected),
                  });
                }}
              />
            </Form.Item>
            <Text type="secondary">
              每一列代表一件實物；預填尚未到貨數量，請移除這次未收到的物件。
            </Text>
          </>
        ) : ["LETTER", "PARCEL"].includes(category) ? (
          <Form.Item
            name="recipientId"
            label="收件部門／同仁"
            rules={[{ required: true, message: "請選擇收件人" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={people.map((p) => ({
                value: p.id,
                label: `${p.department} · ${p.name}（${p.employeeNo}）`,
              }))}
            />
          </Form.Item>
        ) : (
          <Alert
            type="info"
            message="先保存待辨識收件，確認來源後再由收發室補登歸屬。"
          />
        )}
        {source ? (
          <Paragraph type="secondary">
            案件 {source.number} · 已收到 {source.receivedQuantity ?? 0}／
            {source.expectedQuantity ??
              source.items.reduce((sum, item) => sum + item.quantity, 0)}{" "}
            件；本次收件仍須核對實物。
          </Paragraph>
        ) : null}
        <div className="mailroom-form-grid">
          {field("物流公司", "carrier")}
          {field("物流單號", "trackingNumber")}
        </div>
        {field(
          isCorrespondence ? "對方公司名稱／寄件人姓名" : "寄件人／單位",
          "senderLabel",
          isCorrespondence,
        )}
        {field("收件存放位置", "location", true)}
        <Divider orientation="left">實際收到的物件</Divider>
        <Form.List
          name="items"
          rules={[
            {
              validator: (_, items) =>
                items?.length
                  ? Promise.resolve()
                  : Promise.reject(new Error("至少登記一件物件")),
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <>
              {fields.map((item, index) => (
                <Card
                  key={item.key}
                  size="small"
                  title={`第 ${index + 1} 件`}
                  extra={
                    fields.length > 1 ? (
                      <Button
                        type="text"
                        danger
                        onClick={() => remove(item.name)}
                      >
                        移除
                      </Button>
                    ) : null
                  }
                  style={{ marginBottom: 12 }}
                >
                  {isCase ? (
                    <Form.Item
                      name={[item.name, "sourceItemId"]}
                      label="對照申報品項"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={(source?.items || []).map((x) => ({
                          value: x.id,
                          label: x.name,
                        }))}
                      />
                    </Form.Item>
                  ) : null}
                  <Form.Item
                    name={[item.name, "productName"]}
                    label={
                      category === "LETTER"
                        ? "信件名稱／內容"
                        : category === "PARCEL"
                          ? "包裹內容／名稱"
                          : "實收品項／信件名稱"
                    }
                    rules={[{ required: true, whitespace: true }]}
                  >
                    <Input maxLength={200} />
                  </Form.Item>
                  {!isCorrespondence && (
                    <div className="mailroom-form-grid">
                      <Form.Item name={[item.name, "sku"]} label="SKU">
                        <Input maxLength={100} />
                      </Form.Item>
                      <Form.Item name={[item.name, "serialNumber"]} label="SN">
                        <Input maxLength={100} />
                      </Form.Item>
                    </div>
                  )}
                </Card>
              ))}
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                disabled={fields.length >= 50 || category === "UNMATCHED"}
                onClick={() => add({ productName: "" })}
              >
                增加一件實物
              </Button>
              <Form.ErrorList errors={errors} />
            </>
          )}
        </Form.List>
        {error ? (
          <Alert style={{ marginTop: 16 }} type="error" message={error} />
        ) : null}
      </Form>
    </Drawer>
  );
}
