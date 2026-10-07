import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  INTAKE_STATUS,
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
import RecipientPicker from "./RecipientPicker";
import { MAILROOM_QUEUES, mailroomNextStep, needsInspectionPhoto, matchesMailroomSearch, canDispatch, matchesDispatchReceipt } from "./mailroom-workflow";
import SourceCasePicker from "./SourceCasePicker";
import RepairDocuments from "../repair/RepairDocuments";
import { useRepairFeedback } from "../repair/repair-feedback";
import { createRepairNavigationGate, useRepairNavigationGuard } from "../repair/repair-navigation";
import { createMailroomDiscardConfirmation, mailroomDraftFingerprint, type MailroomDraftState } from "./mailroom-draft";
import { loadPendingDispatch, savePendingDispatch, clearPendingDispatch, type PendingDispatch } from "./mailroom-dispatch-pending";
import type { RepairMessage } from "../repair/repair-feedback";
import type { RepairItem } from "../repair/repair-model";
import { currentItemCustody } from "./item-custody";
import { hasIntakeAction, matchesIntakeReceipt } from "./intake-actions";
import { mailroomIntake } from "../../services/mailroom-intake";
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
    <Input maxLength={["location", "senderLabel"].includes(name) ? 160 : ["carrier", "trackingNumber", "sku", "serialNumber"].includes(name) ? 100 : 200} />
  </Form.Item>
);
export default function MailroomPage({
  mode = "mailroom",
}: {
  mode?: "mailroom" | "repair" | "mine";
}) {
  const { modal, message, contextHolder } = useRepairFeedback();
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
    [listTab, setListTab] = useState("received"),
    [createCategory, setCreateCategory] = useState("REPAIR"),
    [arrivalRevision, setArrivalRevision] = useState(0);
  const selectedId = params.get("itemId");
  const drafts = useRef({ receipt: { dirty: false, busy: false } as MailroomDraftState, detail: { dirty: false, busy: false } as MailroomDraftState });
  const dirty = useRef(false);
  const updateDraft = useCallback((scope: "receipt" | "detail", state: MailroomDraftState) => {
    drafts.current[scope] = state;
    dirty.current = Object.values(drafts.current).some(value => value.dirty || value.busy);
  }, []);
  const updateReceiptDraft = useCallback((state: MailroomDraftState) => updateDraft("receipt", state), [updateDraft]);
  const updateDetailDraft = useCallback((state: MailroomDraftState) => updateDraft("detail", state), [updateDraft]);
  const confirmDiscard = useMemo(() => createMailroomDiscardConfirmation(
    () => ({ dirty: dirty.current, busy: Object.values(drafts.current).some(value => value.busy) }),
    () => new Promise<boolean>(resolve => modal.confirm({
      title: "目前收發工作有未保存的修改",
      content: Object.values(drafts.current).some(value => value.persistedDispatch)
        ? "寄出結果尚未確認，原請求已保留。離開後請先核對結果，勿重複寄出。"
        : Object.values(drafts.current).some(value => value.uncertain)
          ? "送出結果尚未確認。離開後請先核對原操作，勿重複登記。"
          : "未保存的欄位及照片將被放棄。",
      okText: "放棄草稿", cancelText: "繼續編輯", maskClosable: false,
      onOk: () => { resolve(true); }, onCancel: () => { resolve(false); },
    })),
    () => message.info("正在保存或讀取照片，請稍候。"),
  ), [modal, message]);
  useRepairNavigationGuard(dirty, confirmDiscard);
  const navigationGate = useMemo(() => createRepairNavigationGate(dirty, confirmDiscard), [confirmDiscard]);
  const guardChange = useCallback((change: () => void) => {
    if (Object.values(drafts.current).some(value => value.busy)) { void confirmDiscard(); return; }
    navigationGate(() => {
      drafts.current = { receipt: { dirty: false, busy: false }, detail: { dirty: false, busy: false } };
      dirty.current = false;
      change();
    });
  }, [navigationGate, confirmDiscard]);
  function startReceipt(category: string, source?: Source) {
    guardChange(() => {
      const next = new URLSearchParams(params); next.delete("itemId"); setParams(next);
      setCreateSource(source); setCreateCategory(category); setCreate(true);
    });
  }
  useEffect(() => { if (selectedId) setCreate(false); }, [selectedId]);
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
  }, [selectedId, entityId, message]);
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
    if (id === (selectedId || undefined) && !create) return;
    guardChange(() => {
      setCreate(false);
      const next = new URLSearchParams(params);
      if (id) next.set("itemId", id);
      else next.delete("itemId");
      setParams(next);
    });
  }
  if (!enabled)
    return (
      <>
        {contextHolder}
        <Alert
          type="info"
          message="收發室工作台尚未啟用"
        />
      </>
    );
  const visible =
    mode === "mine"
      ? rows.filter(
          (x) =>
            (!status || x.status === status) &&
            matchesMailroomSearch(x, search),
        )
      : rows;
  return (
    <div className="mailroom-page">
      {contextHolder}
      <div className="mailroom-heading">
        <div>
          <Title level={2}>
            {mode === "mailroom"
              ? "收發室工作台"
              : mode === "repair"
                ? "維修工作台"
                : "我的待辦與收件"}
          </Title>
        </div>
        <Space wrap>
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
            <Space wrap>
            <Button onClick={() => startReceipt("LETTER")}>登記信件／包裹</Button>
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              onClick={() => startReceipt("REPAIR")}
            >
              登記售後收件
            </Button>
            </Space>
          ) : null}
        </Space>
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
            { key: "received", label: "收件與交接工作" },
            { key: "awaiting", label: "售後待到貨案件" },
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
            startReceipt(source.type, source);
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
          {mode === "mailroom" && <div className="mailroom-queues" aria-label="收發工作佇列">
            {MAILROOM_QUEUES.map(queue => <Button key={queue.status || "all"} type={status === queue.status ? "primary" : "default"}
              onClick={() => { setStatus(queue.status); setPage(1); }}>{queue.label}</Button>)}
          </div>}
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
                    <Text className="mailroom-meta">{item.label} · 照片 {item.evidenceCount} 張</Text>
                  </div>
                ),
              },
              {
                title: "目前進度",
                dataIndex: "status",
                width: 230,
                render: (s: string, item) => (
                  <>
                    <Tag color={statusColor(s)}>{item.statusLabel || STATUS[s] || s}</Tag>
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
                render: (_, item) => {
                  const custody = currentItemCustody(item);
                  return <>
                    <div>{custody.location}</div>
                    <Text type="secondary">{custody.holder}</Text>
                    {custody.notice && <div><Text type="secondary">{custody.notice}</Text></div>}
                  </>;
                },
              },
              {
                title: "下一步／接收人",
                width: 230,
                key: "next",
                render: (_, item) => <>
                  <div>{mailroomNextStep(item).title}</div>
                  <Text type="secondary">{item.nextUserName || item.recipientName || "待後續安排"}</Text>
                </>,
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
        width="min(720px, 100vw)"
        open={!!selectedId}
        onClose={() => openItem()}
        destroyOnHidden
      >
        <Spin spinning={detailLoading}>
          {detail ? (
            <ItemDetail
              feedback={message}
              guardChange={guardChange}
              onDraftChange={updateDetailDraft}
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
        key={entityId + ":" + mode}
        feedback={message}
        guardChange={guardChange}
        onDraftChange={updateReceiptDraft}
        initialSource={createSource}
        initialCategory={createCategory}
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
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    items: Source[];
    cursor: string | null;
  }>();
  const [requestFailure, setRequestFailure] = useState<{
    scope: string;
    kind: "refresh" | "more";
    message: string;
  }>();
  const [search, setSearch] = useState(""),
    [loading, setLoading] = useState(false),
    [moreBusy, setMoreBusy] = useState(false);
  const scope = JSON.stringify([entityId, search]);
  const currentSnapshot = snapshot?.scope === scope ? snapshot : undefined;
  const hasLoaded = !!currentSnapshot;
  const cases = currentSnapshot?.items || [];
  const cursor = currentSnapshot?.cursor || null;
  const failure = requestFailure?.scope === scope ? requestFailure.message : "";
  const pages = useRef(1),
    generation = useRef(0),
    requestedScope = useRef<string | undefined>(undefined);
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
          setSnapshot({
            scope,
            items: [...new Map(items.map((item) => [item.id, item])).values()],
            cursor: next,
          });
          setRequestFailure(undefined);
        }
      } catch (error) {
        if (generation.current === id)
          setRequestFailure({ scope, kind: "refresh", message: errorText(error) });
      } finally {
        if (generation.current === id) setLoading(false);
      }
    },
    [entityId, search, scope],
  );
  useEffect(() => {
    if (requestedScope.current !== scope) {
      requestedScope.current = scope;
      pages.current = 1;
    }
    setMoreBusy(false);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, revision, scope]);
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
        setSnapshot((old) => old?.scope === scope ? {
          scope,
          items: [...new Map(
            [...old.items, ...result.data.items].map((item) => [item.id, item]),
          ).values()],
          cursor: result.data.nextCursor || null,
        } : old);
        setRequestFailure((old) => old?.scope === scope && old.kind === "more" ? undefined : old);
      }
    } catch (error) {
      if (generation.current === id)
        setRequestFailure((old) => ({
          scope,
          kind: old?.scope === scope && old.kind === "refresh" ? "refresh" : "more",
          message: errorText(error),
        }));
    } finally {
      if (generation.current === id) setMoreBusy(false);
    }
  }
  return (
    <Card
      className="mailroom-list"
      title={
        <Space>
          <InboxOutlined />
          <span>售後待到貨</span>
          <Tag>{hasLoaded ? `${cases.length} 筆已載入` : "清單未載入"}</Tag>
          {hasLoaded && failure ? <Tag color="warning">未更新</Tag> : null}
        </Space>
      }
    >
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
          message={hasLoaded ? "待到貨清單暫時無法更新" : "待到貨清單未能載入"}
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
                !hasLoaded
                  ? "待到貨清單尚未載入"
                  : failure
                    ? "上次查詢沒有待到貨案件"
                    : cursor
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
  feedback,
  guardChange,
  onDraftChange,
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
  feedback: RepairMessage;
  guardChange: (change: () => void) => void;
  onDraftChange: (state: MailroomDraftState) => void;
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
  const message = feedback;
  const [action, setAction] = useState<string>(),
    [busy, setBusy] = useState(false),
    [photos, setPhotos] = useState<string[]>([]),
    [failure, setFailure] = useState("");
  const [tablet, setTablet] = useState(false);
  const [form] = Form.useForm();
  const operation = useRef<{ body: string; id: string } | undefined>(undefined);
  const baseline = useRef("");
  const mounted = useRef(true);
  const draftAction = useRef<string | undefined>(undefined);
  const photoDraft = useRef<string[]>([]);
  const working = useRef(false);
  const unknown = useRef(false);
  const persistedDispatch = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [pendingConflict, setPendingConflict] = useState(false);
  const scope = { entityId, userId, itemId: item.id };
  function publishDraft() {
    onDraftChange({ dirty: unknown.current || photoDraft.current.length > 0 || (!!draftAction.current && baseline.current !== mailroomDraftFingerprint(form.getFieldsValue(true))), busy: working.current, uncertain: unknown.current, persistedDispatch: persistedDispatch.current });
  }
  function setWorking(value: boolean) { working.current = value; if (mounted.current) { setBusy(value); publishDraft(); } }
  function clearDraft() {
    operation.current = undefined; unknown.current = false; draftAction.current = undefined; persistedDispatch.current = false; setUncertain(false); setPendingConflict(false);
    photoDraft.current = []; setPhotos([]);
    baseline.current = mailroomDraftFingerprint(form.getFieldsValue(true));
    onDraftChange({ dirty: false, busy: working.current });
  }
  function clearDispatchReceipt() {
    try { clearPendingDispatch(sessionStorage, scope); }
    catch { message.warning("寄出回執已核對，但本機待核對紀錄清理失敗；回來時仍須核對此原回執。"); }
  }
  function restoreDispatch() {
    if (item.receipt.category !== "REPAIR") return false;
    try {
      const pending = loadPendingDispatch(sessionStorage, scope);
      if (!pending) return false;
      if (matchesDispatchReceipt(item, pending, userId)) { clearDispatchReceipt(); return false; }
      const { requestId: id, ...body } = pending;
      operation.current = { body: JSON.stringify(body), id };
      unknown.current = true; persistedDispatch.current = true; draftAction.current = "dispatch"; setUncertain(true); setAction("dispatch");
      form.setFieldsValue(body);
      baseline.current = mailroomDraftFingerprint(form.getFieldsValue(true));
      setPendingConflict(item.version !== pending.expectedVersion || !canDispatch(item, userId, canMail));
      onDraftChange({ dirty: true, busy: false, uncertain: true, persistedDispatch: true });
      return true;
    } catch {
      setFailure("無法讀取本機待核對寄出紀錄；請人工核對原操作，暫停新的寄出。");
      setPendingConflict(true); unknown.current = true; draftAction.current = "dispatch"; setUncertain(true); setAction("dispatch");
      onDraftChange({ dirty: true, busy: false, uncertain: true });
      return true;
    }
  }
  const restoreAtMount = useRef(restoreDispatch);
  useEffect(() => {
    mounted.current = true;
    restoreAtMount.current();
    return () => { mounted.current = false; onDraftChange({ dirty: false, busy: false }); };
  }, [onDraftChange]);
  const mine = item.nextUserId === userId,
    ownRepair =
      canRepair && item.repairOwnerId === userId && item.custodianId === userId;
  const actions: string[] = [];
  if (canMail && hasIntakeAction(item, "send_intake", userId)) actions.push("send_intake");
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
    !item.caseIntake &&
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
  if (canMail && item.custodianId === userId && !["COLLECTED", "DISPATCHED"].includes(item.status))
    actions.push("move");
  if (canDispatch(item, userId, canMail)) actions.unshift("dispatch");
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
  function choose(value?: string) {
    if (value === action) return;
    guardChange(() => {
    clearDraft();
    if (value === "dispatch" && restoreDispatch()) return;
    draftAction.current = value;
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
    baseline.current = mailroomDraftFingerprint(form.getFieldsValue(true));
    });
  }
  async function save() {
    if (working.current || (action === "dispatch" && pendingConflict)) return;
    setWorking(true);
    try {
      const values = await form.validateFields();
      if (needsInspectionPhoto(action, item.evidence, photos)) {
        setFailure("請附上至少一張實物照片。");
        return;
      }
      const body = JSON.stringify({
        ...(action === "send_intake" ? { csrUserId: values.csrUserId, note: values.note } : action === "dispatch" ? { carrier: values.carrier.trim(), trackingNumber: values.trackingNumber.trim(), confirmedItems: values.confirmedItems, note: values.note?.trim() } : values),
        entityId,
        action,
        expectedVersion: item.version,
        ...(photos.length ? { evidence: photos } : {}),
      });
      if (!unknown.current && operation.current?.body !== body)
        operation.current = { body, id: requestId() };
      setFailure("");
      if (action === "dispatch") {
        try {
          savePendingDispatch(sessionStorage, scope, { ...JSON.parse(operation.current!.body), requestId: operation.current!.id } as PendingDispatch);
          persistedDispatch.current = true;
        } catch {
          unknown.current = true; setUncertain(true); publishDraft();
          setFailure("無法安全保存本次寄出操作識別碼，尚未送出。請保留操作識別碼：" + operation.current!.id);
          return;
        }
      }
      await api.post("/mailroom/items/" + item.id + "/actions", {
        ...JSON.parse(operation.current!.body),
        requestId: operation.current!.id,
      });
      if (action === "dispatch") {
        const latest = await api.get<Item>("/mailroom/items/" + encodeURIComponent(item.id), { params: { entityId } });
        const request = { ...JSON.parse(operation.current!.body), requestId: operation.current!.id };
        if (!matchesDispatchReceipt(latest.data, request, userId))
          throw new Error("伺服器回應後仍未取得本次精確寄出回執，請核對原操作");
        clearDispatchReceipt();
      }
      message.success(action === "dispatch" ? "已登記寄出" : "已更新進度");
      clearDraft(); setWorking(false);
      setAction(undefined);
      await onSaved();
    } catch (e) {
      if (action === "dispatch" && operation.current && !(e as { errorFields?: unknown }).errorFields) {
        try {
          const latest = await api.get<Item>("/mailroom/items/" + encodeURIComponent(item.id), { params: { entityId } });
          const request = { ...JSON.parse(operation.current.body), requestId: operation.current.id };
          if (matchesDispatchReceipt(latest.data, request, userId)) {
            clearDispatchReceipt(); clearDraft(); setWorking(false);
            setAction(undefined);
            message.success("已核對寄出紀錄");
            await onSaved();
            return;
          }
          setPendingConflict(latest.data.version !== request.expectedVersion || !canDispatch(latest.data, userId, canMail));
        } catch { /* Preserve the exact request ID for explicit safe retry. */ }
      }
      if (action === "send_intake" && operation.current && !(e as { errorFields?: unknown }).errorFields) {
        try { const latest = await mailroomIntake.item(entityId, item.id); const request = { ...JSON.parse(operation.current.body), requestId: operation.current.id }; if (matchesIntakeReceipt(latest, request, userId)) { clearDraft(); setWorking(false); setAction(undefined); message.success("已從本次交辦回執核對操作成功"); await onSaved(); return; } } catch { /* Keep the same command/request for explicit reconciliation or exact retry. */ }
      }
      if (!(e as { errorFields?: unknown }).errorFields) {
        const rejected = (e as { response?: { status?: number } }).response?.status;
        if (operation.current && (action === "dispatch" || !rejected || rejected >= 500)) { unknown.current = true; setUncertain(true); publishDraft(); }
        setFailure(action === "dispatch" && rejected && rejected < 500 ? "伺服器拒絕本次寄出：" + errorText(e) + "。原操作已保留，請核對回執或處理阻擋原因。" : errorText(e));
      }
    } finally {
      setWorking(false);
    }
  }
  async function reconcileDispatch() {
    if (!operation.current || working.current) return;
    setWorking(true);
    try {
      const latest = await api.get<Item>("/mailroom/items/" + encodeURIComponent(item.id), { params: { entityId } });
      const request = { ...JSON.parse(operation.current.body), requestId: operation.current.id };
      if (!matchesDispatchReceipt(latest.data, request, userId)) {
        setPendingConflict(latest.data.version !== request.expectedVersion || !canDispatch(latest.data, userId, canMail));
        setFailure("尚未找到本次寄出回執；版本或保管不符時請人工核對，勿建立新的寄出。");
        return;
      }
      clearDispatchReceipt(); clearDraft(); setWorking(false); setAction(undefined);
      message.success("已核對寄出紀錄");
      await onSaved();
    } catch (error) { setFailure(errorText(error)); }
    finally { setWorking(false); }
  }
  const custody = currentItemCustody(item);
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
          feedback={message}
          item={{ ...(item as RepairItem), editable: false }}
          entityId={entityId}
          onSaved={onSaved}
        />
      ) : null}
      <Space wrap>
        <Tag>{CATEGORIES[item.receipt.category]}</Tag>
        <Tag color={statusColor(item.status)}>{item.statusLabel || STATUS[item.status]}</Tag>
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
            key: "sender",
            label: "寄件人／公司",
            children: item.receipt.senderLabel || "未提供",
          },
          { key: "incoming", label: "入件物流／單號", children: [item.receipt.carrier, item.receipt.trackingNumber].filter(Boolean).join(" · ") || "未提供" },
          ...(item.receipt.category === "LETTER" || item.receipt.category === "PARCEL" ? [
            { key: "actual-name", label: "信件／包裹內容", children: item.productName },
            { key: "recipient", label: "指定收件同仁", children: item.recipientName || item.nextUserName || "待指定" },
          ] : [{
            key: "declared",
            label: "售後來源品項",
            children: item.declared
              ? `${item.declared.name} · SKU ${item.declared.sku || "未提供"} · SN ${item.declared.serialNumber || "未提供"}`
              : "無售後申報",
          },
          { key: "actual", label: "實收品項", children: item.productName },
          { key: "sku", label: "實收 SKU", children: item.sku || "未提供" },
          { key: "sn", label: "實收 SN", children: item.serialNumber || "未提供" }]),
          { key: "location", label: "目前實物位置", children: custody.location },
          { key: "owner", label: "目前保管", children: custody.holder },
          ...(custody.transferred ? [
            { key: "linked", label: "換機出庫", children: [custody.notice, custody.reference, custody.status].filter(Boolean).join(" · ") },
            { key: "in-history", label: "原退貨入庫紀錄", children: `${item.custodianName} / ${item.location}` },
          ] : []),
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
      {item.outboundShipment && <Card className="mailroom-dispatch-record" size="small" title="寄出紀錄" style={{ marginTop: 16 }}>
        <Descriptions column={1} size="small" items={[
          { key: "carrier", label: "寄出物流／單號", children: `${item.outboundShipment.carrier} · ${item.outboundShipment.trackingNumber}` },
          { key: "time", label: "交運時間／人員", children: `${date(item.outboundShipment.dispatchedAt)} · ${item.outboundShipment.dispatchedByName}` },
          { key: "actual", label: item.outboundShipment.physicalItem.kind === "REPLACEMENT" ? "實際寄出的替換品" : "實際寄出的原件", children: `${item.outboundShipment.physicalItem.productName} · SKU ${item.outboundShipment.physicalItem.sku || "未提供"} · SN ${item.outboundShipment.physicalItem.serialNumber || "未提供"}` },
          { key: "sync", label: "寄出同步", children: <Tag>待串接</Tag> },
        ]} />
      </Card>}
      {item.caseIntake && <Descriptions size="small" column={1} style={{ marginTop: 16 }} items={[
        { key: "intake-status", label: "客服補建", children: INTAKE_STATUS[item.caseIntake.status] },
        { key: "intake-owner", label: "接手客服", children: item.caseIntake.ownerName || item.caseIntake.sentToUserName },
        ...(item.caseIntake.sourceNumber ? [{ key: "intake-source", label: "綁定案件", children: item.caseIntake.sourceNumber }] : []),
      ]} />}
      {missingCustomerService ? (
        <Alert
          type="warning"
          showIcon
          message="尚未對應承辦客服"
          description="請指定承辦客服。"
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
      {(actions.length || canTablet) ? <Divider orientation="left">更新進度</Divider> : null}
      {actions.length || canTablet ? (
        <Space wrap>
          {canTablet ? (
            <Button
              type="primary"
              size="large"
              disabled={busy}
              onClick={() => guardChange(() => {
                clearDraft(); setAction(undefined); setTablet(true);
                onDraftChange({ dirty: false, busy: true });
              })}
            >
              平板交接簽收
            </Button>
          ) : null}
          {actions.map((value, index) => (
            <Button
              key={value}
              disabled={busy}
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
      ) : null}
      <TabletAcceptance
        open={tablet}
        item={item}
        entityId={entityId}
        onClose={() => { setTablet(false); onDraftChange({ dirty: false, busy: false }); }}
        onSaved={onSaved}
      />
      {action ? (
        <Card size="small" title={ACTIONS[action]} className="mailroom-action">
          <Form
            form={form}
            disabled={busy || uncertain}
            onValuesChange={publishDraft}
            layout="vertical"
            preserve={false}
            initialValues={{
              productName: item.productName,
              sku: item.sku || "",
              serialNumber: item.serialNumber || "",
              location: item.location,
            }}
          >
            {action === "dispatch" && <>
              {uncertain && <Alert type="warning" showIcon message={pendingConflict ? "原寄出請求需人工核對，不能重新送出" : "已保留原寄出請求；只可核對回執或以原請求重試"} description={"操作識別碼：" + (operation.current?.id || "本機紀錄待核對")} action={<Button disabled={busy} onClick={() => void reconcileDispatch()}>核對本次寄出回執</Button>} />}
              <div className="mailroom-form-grid">
                {field("寄出物流公司", "carrier", true)}
                {field("寄出物流單號", "trackingNumber", true)}
              </div>
              <Form.Item name="confirmedItems" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("請逐件核對並確認實物已交給物流")) }]}>
                <Checkbox>我已核對實際寄出的產品與 SN，並將實物交給物流</Checkbox>
              </Form.Item>
            </>}
            {action === "send_intake" && <>
              <Form.Item name="csrUserId" label="指定補建客服" rules={[{ required: true, message: "請指定具補建與受理權限的客服" }]}><Select showSearch optionFilterProp="label" options={people.filter(person => person.intakeCustomerService === true).map(person => ({ value: person.id, label: `${person.department} · ${person.name}` }))} notFoundContent="目前沒有本公司具補建與受理權限的同仁" /></Form.Item>
            </>}
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
                label="與售後來源品項是否一致"
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
                rules={[{ required: true, message: "請指定接收人" }, { validator: (_, value) => !value || targetPeople.some(person => person.id === value) ? Promise.resolve() : Promise.reject(new Error("請重新選擇目前可指派的同仁")) }]}
              >
                <RecipientPicker disabled={busy || uncertain} key={action} people={targetPeople} label={identifyGeneral ? "收件同仁" : "接收人"} />
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
                  "send_intake",
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
                <Divider orientation="left">實物照片</Divider>
                <Upload
                  accept="image/png,image/jpeg,image/webp"
                  capture="environment"
                  showUploadList={false}
                  disabled={busy || uncertain}
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
                    if (working.current) return false;
                    setWorking(true);
                    try {
                      const bitmap = await createImageBitmap(file);
                      bitmap.close();
                    } catch {
                      message.error("照片無法讀取，請重新拍攝或選擇有效照片");
                      setWorking(false);
                      return false;
                    }
                    try {
                    const result = await new Promise<string>(
                      (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result));
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                      },
                    );
                    photoDraft.current = [...photoDraft.current, result].slice(0, 4);
                    setPhotos(photoDraft.current); publishDraft();
                    } catch { message.error("照片讀取失敗，請重新選擇。"); }
                    finally { setWorking(false); }
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
                        disabled={busy || uncertain}
                        onClick={() => {
                          photoDraft.current = photoDraft.current.filter((_, j) => i !== j);
                          setPhotos(photoDraft.current); publishDraft();
                        }}
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
              <Button type="primary" loading={busy} disabled={action === "dispatch" && pendingConflict} onClick={() => void save()}>
                確認儲存
              </Button>
              <Button disabled={busy} onClick={() => choose(undefined)}>
                取消
              </Button>
            </Space>
          </Form>
        </Card>
      ) : null}
      {item.receipt.sourceCaseId ? (
        <>
          <Divider orientation="left">既有進度同步</Divider>
          <Space wrap>
            {["AFTER_SALES", "AI_CUSTOMER_SERVICE"].map((target) => {
              const deliveries = (
                item.deliverySummary ||
                item.deliveries ||
                []
              ).filter((x) => x.target === target);
              const pending = deliveries.some((x) => x.status !== "DELIVERED");
              return (
                <Tag key={target} color={pending ? "orange" : deliveries.length ? "green" : undefined}>
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
                {STATUS[event.toStatus] || event.toStatus} · {event.actorName}
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
  feedback,
  guardChange,
  onDraftChange,
  initialSource,
  initialCategory,
  open,
  entityId,
  people,
  onClose,
  onCreated,
}: {
  feedback: RepairMessage;
  guardChange: (change: () => void) => void;
  onDraftChange: (state: MailroomDraftState) => void;
  initialSource?: Source;
  initialCategory: string;
  open: boolean;
  entityId: string;
  people: Person[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const message = feedback;
  const [form] = Form.useForm(),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState<Source>(),
    [error, setError] = useState("");
  const category = Form.useWatch("category", form);
  const operation = useRef<{ body: string; id: string } | undefined>(undefined);
  const baseline = useRef("");
  const working = useRef(false);
  const unknown = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  function publishDraft() { onDraftChange({ dirty: open && (unknown.current || baseline.current !== mailroomDraftFingerprint(form.getFieldsValue(true))), busy: working.current, uncertain: unknown.current }); }
  function setWorking(value: boolean) { working.current = value; setBusy(value); publishDraft(); }
  const clearDraft = useCallback(() => { operation.current = undefined; unknown.current = false; setUncertain(false); baseline.current = mailroomDraftFingerprint(form.getFieldsValue(true)); onDraftChange({ dirty: false, busy: false }); }, [form, onDraftChange]);
  function close() { guardChange(() => { clearDraft(); onClose(); }); }
  useEffect(() => () => onDraftChange({ dirty: false, busy: false }), [onDraftChange]);
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
          : { category: initialCategory, items: [{ productName: "" }] },
      );
      setError("");
      setSource(initialSource);
      clearDraft();
    } else {
      clearDraft();
    }
  }, [open, form, initialSource, initialCategory, clearDraft]);
  async function submit() {
    if (working.current) return;
    setWorking(true);
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
      if (!unknown.current && operation.current?.body !== body)
        operation.current = { body, id: requestId() };
      setError("");
      const result = await api.post("/mailroom/receipts", {
        ...JSON.parse(operation.current!.body),
        requestId: operation.current!.id,
      });
      message.success("已登記收件");
      clearDraft(); setWorking(false);
      onCreated(result.data.itemIds[0]);
    } catch (e) {
      if (!(e as { errorFields?: unknown }).errorFields) {
        const rejected = (e as { response?: { status?: number } }).response?.status;
        if (operation.current && (!rejected || rejected >= 500)) { unknown.current = true; setUncertain(true); publishDraft(); }
        setError(errorText(e));
      }
    } finally {
      setWorking(false);
    }
  }
  return (
    <Drawer
      title="登記收件"
      width="min(700px, 100vw)"
      open={open}
      onClose={close}
      forceRender
      footer={
        <Space>
          <Button
            type="primary"
            size="large"
            loading={busy}
            onClick={() => void submit()}
          >
            登記收件
          </Button>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        disabled={busy || uncertain}
        onValuesChange={publishDraft}
        preserve
        initialValues={
          initialSource
            ? {
                category: initialSource.type,
                sourceCaseId: initialSource.id,
                items: sourcePhysicalRows(initialSource),
              }
            : { category: initialCategory, items: [{ productName: "" }] }
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
                  publishDraft();
                }}
              />
            </Form.Item>
          </>
        ) : ["LETTER", "PARCEL"].includes(category) ? (
          <Form.Item
            name="recipientId"
            label="收件部門／同仁"
            rules={[{ required: true, message: "請選擇收件人" }, { validator: (_, value) => !value || people.some(person => person.id === value) ? Promise.resolve() : Promise.reject(new Error("請重新選擇目前可指派的同仁")) }]}
          >
            <RecipientPicker disabled={busy || uncertain} key={category} people={people} label="收件同仁" />
          </Form.Item>
        ) : null}
        {source ? (
          <Paragraph type="secondary">
            案件 {source.number} · 已收到 {source.receivedQuantity ?? 0}／
            {source.expectedQuantity ??
              source.items.reduce((sum, item) => sum + item.quantity, 0)}{" "}
            件
          </Paragraph>
        ) : null}
        <div className="mailroom-form-grid">
          {field("入件物流公司", "carrier")}
          {field("入件物流單號", "trackingNumber")}
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
                        disabled={busy || uncertain}
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
                disabled={busy || uncertain || fields.length >= 50 || category === "UNMATCHED"}
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
