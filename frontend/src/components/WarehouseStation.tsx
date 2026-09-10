import { useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Input, Pagination, Switch, Tag } from "antd";
import type { InputRef } from "antd";
import api from "../services/api";
import type {
  WarehouseDetail,
  WarehouseRow,
  WorkStage,
} from "../services/warehouse.types";
import {
  WarehouseFeedback,
  newReadyKeys,
  scanFeedback,
} from "../services/warehouse-feedback";

export default function WarehouseStation({
  entityId,
  stage,
  audio,
  onExit,
}: {
  entityId: string;
  stage: WorkStage;
  audio: WarehouseFeedback;
  onExit: () => void;
}) {
  const [rows, setRows] = useState<WarehouseRow[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [query, setQuery] = useState("");
  const [current, setCurrent] = useState<WarehouseDetail | null>(null),
    [error, setError] = useState(""),
    [queueError, setQueueError] = useState("");
  const [scan, setScan] = useState(""),
    [feedback, setFeedback] = useState(""),
    [tone, setTone] = useState(""),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [audioReady, setAudioReady] = useState(audio.ready);
  const input = useRef<InputRef>(null),
    flight = useRef(false),
    alive = useRef(true),
    seen = useRef<Set<string> | null>(null),
    opened = useRef(0);
  const [voice, setVoice] = useState(audio.voice);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      opened.current++;
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setRows([]);
    setTotal(0);
    async function poll() {
      try {
        const r = await api.get<{
          items: WarehouseRow[];
          total: number;
          readyKeys?: string[];
        }>("/wms/workbench/orders", {
          params: {
            entityId,
            area: stage,
            view: "all",
            page,
            pageSize: 25,
            search: query,
          },
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        const keys = r.data.readyKeys;
        const count = keys ? newReadyKeys(seen.current, keys) : 0;
        if (count) {
          audio.play(
            "new",
            `${count} 筆新${stage === "pick" ? "揀貨" : "裝箱"}任務`,
          );
          setFeedback(`${count} 筆新任務`);
        }
        if (keys) seen.current = new Set(keys);
        setRows(r.data.items);
        setTotal(r.data.total);
        setQueueError(keys ? "" : "工作清單已載入；新任務提示尚未接通");
      } catch (e) {
        if (!abort.signal.aborted) {
          if ((e as {response?:{status?:number}}).response?.status===403) {
            opened.current++;setRows([]);setTotal(0);setCurrent(null);setLocked(true);
            setQueueError("工作站權限已變更，請聯絡管理員");
          } else setQueueError("任務更新中斷，正在重新連線");
        }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [entityId, stage, page, query, audio]);
  async function open(id: string) {
    if (flight.current) return;
    const version = ++opened.current;
    setBusy(true);
    setError("");
    setLocked(true);
    setCurrent(null);
    setScan("");
    setFeedback("");
    try {
      const r = await api.get<WarehouseDetail>(
        `/wms/workbench/orders/${encodeURIComponent(id)}`,
        { params: { entityId, area: stage } },
      );
      if (alive.current && version === opened.current) {
        setCurrent(r.data);
        setLocked(false);
      }
    } catch {
      if (alive.current && version === opened.current)
        setError("無法載入工作內容，請從任務清單重試");
    } finally {
      if (alive.current && version === opened.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!busy && !locked && current?.allowedActions.includes(`${stage}:scan`))
      input.current?.focus();
  }, [current, busy, locked, stage]);
  const allowed = (action: string) =>
    !locked && current?.allowedActions.includes(`${stage}:${action}`);
  const completed =
    current &&
    (stage === "pick"
      ? ["picked", "packing", "completed"].includes(current.state)
      : current.state === "completed");
  async function submit(kind: "claim" | "scan") {
    if (
      !current ||
      flight.current ||
      !allowed(kind) ||
      (kind === "scan" && !scan.trim())
    )
      return;
    flight.current = true;
    setBusy(true);
    setError("");
    setTone("");
    const before = current,
      value = scan.trim();
    try {
      const r = await api.post<WarehouseDetail>(
        `/wms/workbench/orders/${encodeURIComponent(current.id)}/${stage}/${kind}`,
        {
          entityId,
          expectedRevision: current.revision,
          requestId: crypto.randomUUID(),
          ...(kind === "scan" ? { scanValue: value } : {}),
        },
      );
      if (!alive.current) return;
      setCurrent(r.data);
      setRows(rows=>rows.map(row=>row.id===r.data.id?{...row,...r.data}:row));
      setScan("");
      if (kind === "scan") {
        const result = scanFeedback(before, r.data, stage);
        if (!result.accepted) {
          setLocked(true);
          setError("核對回應不一致，請重新載入確認");
          audio.play("error", "核對結果待確認");
          return;
        }
        setFeedback(result.text);
        setTone(result.kind);
        audio.play(result.kind, result.text);
      } else {
        setFeedback(stage === "pick" ? "已開始揀貨" : "已開始裝箱");
        input.current?.focus();
      }
    } catch (e) {
      if (!alive.current) return;
      const status = (e as { response?: { status?: number } }).response?.status;
      const text =
        status === 400
          ? "條碼不符、需要掃 SN 或品項已足量"
          : status === 403
            ? "操作權限或任務歸屬已變更"
            : status === 409
              ? "訂單已變更或重複掃碼，請重新核對"
              : "結果尚未確認，請重新載入核對，勿直接重刷";
      setError(text);
      setLocked(true);
      setTone("error");
      audio.play("error", text);
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className={`warehouse-station station-${stage}`}>
      <header className="station-heading">
        <div>
          <span className="station-eyebrow">儲運管理中心</span>
          <h1>{stage === "pick" ? "揀貨工作站" : "裝箱工作站"}</h1>
        </div>
        <div className="station-controls">
          <Button
            onClick={async () => {
              const ok = await audio.enable();
              setAudioReady(ok);
              if (ok) audio.play("pack");
            }}
          >
            測試提示音
          </Button>
          <label>
            語音{" "}
            <Switch
              checked={voice}
              onChange={(v) => {
                audio.voice = v;
                setVoice(v);
              }}
            />
          </label>
          <Button disabled={busy} onClick={onExit}>
            切換工作站
          </Button>
        </div>
      </header>
      {!audioReady && (
        <Alert type="warning" message="音效尚未啟用，請按測試提示音" />
      )}
      {queueError && <Alert type="warning" message={queueError} />}
      <div className="station-layout">
        <aside className="station-queue">
          <div className="station-queue-heading">
            <h2>{stage === "pick" ? "揀貨任務" : "裝箱任務"}</h2>
            <strong>{total}</strong>
          </div>
          <Input.Search
            aria-label="搜尋工作站訂單"
            placeholder="搜尋訂單"
            allowClear
            onSearch={(q) => {
              setQuery(q);
              setPage(1);
            }}
          />
          <div className="station-tasks">
            {rows.map((row) => (
              <button
                key={row.id}
                className={`station-task ${current?.id === row.id ? "selected" : ""}`}
                disabled={busy}
                onClick={() => void open(row.id)}
              >
                <span className="station-task-top">
                  <b>{row.orderNumber}</b>
                  <span>{row.required} 件</span>
                </span>
                <span>{row.brand || "待對照"}</span>
                <span className="station-task-bottom">
                  <span>{row.warehouseLabel}</span>
                  <span>{row.assignee || "未認領"}</span>
                </span>
              </button>
            ))}
            {!rows.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={queueError ? "清單尚未更新" : "目前沒有待辦任務"}
              />
            )}
          </div>
          <Pagination
            simple
            current={page}
            total={total}
            pageSize={25}
            onChange={setPage}
          />
        </aside>
        <section aria-label="目前作業" className={`station-work tone-${tone}`}>
          {error && (
            <Alert
              type="error"
              message={error}
              action={
                current ? (
                  <Button disabled={busy} onClick={() => void open(current.id)}>
                    重新載入
                  </Button>
                ) : undefined
              }
            />
          )}
          {!current ? (
            <div className="station-idle">
              <span className="station-idle-symbol">
                {stage === "pick" ? "01" : "02"}
              </span>
              <h2>{busy ? "載入中" : "等待開始作業"}</h2>
              <p>選擇左側訂單</p>
            </div>
          ) : (
            <>
              {current.source === "fixture" && <Tag>測試資料</Tag>}
              <div className="station-order-heading">
                <div>
                  <span className="station-eyebrow">當前訂單</span>
                  <h2>{current.orderNumber}</h2>
                  <span>
                    {current.brand} · {current.warehouseLabel}
                  </span>
                </div>
                <div className="station-count">
                  <span>剩餘件數</span>
                  <strong>
                    {Math.max(
                      0,
                      current.required -
                        (stage === "pick" ? current.picked : current.packed),
                    )}
                  </strong>
                  <small>共 {current.required} 件</small>
                </div>
              </div>
              <div
                className="station-feedback"
                role="status"
                aria-live="polite"
              >
                {feedback || "等待核對"}
              </div>
              {current.blockers.length > 0 && (
                <Alert type="warning" message={current.blockers.join("；")} />
              )}
              {completed ? (
                <div className="station-complete">
                  <h2>{stage === "pick" ? "揀貨完成" : "裝箱核對完成"}</h2>
                  <p>
                    {stage === "pick" ? "已進入裝箱佇列" : "尚不代表已交付物流"}
                  </p>
                  <Button
                    type="primary"
                    onClick={() => {
                      setCurrent(null);
                      setFeedback("");
                      setTone("");
                    }}
                  >
                    下一筆任務
                  </Button>
                </div>
              ) : (
                <>
                  {allowed("claim") && (
                    <Button
                      type="primary"
                      loading={busy}
                      onClick={() => void submit("claim")}
                    >
                      {stage === "pick" ? "開始揀貨" : "開始裝箱"}
                    </Button>
                  )}
                  <form
                    className="station-scan"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submit("scan");
                    }}
                  >
                    <Input
                      ref={input}
                      aria-label="工作站條碼掃描"
                      placeholder="掃描商品條碼或 SN"
                      autoComplete="off"
                      value={scan}
                      onChange={(e) => setScan(e.target.value)}
                      disabled={busy || !allowed("scan")}
                    />
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={busy}
                      disabled={!allowed("scan") || !scan.trim()}
                    >
                      核對
                    </Button>
                  </form>
                  <div className="station-items">
                    {[...current.items]
                      .sort(
                        (a, b) =>
                          (stage === "pick" ? a.picked : a.packed) /
                            a.quantity -
                          (stage === "pick" ? b.picked : b.packed) / b.quantity,
                      )
                      .map((item) => {
                        const count =
                            stage === "pick" ? item.picked : item.packed,
                          done = count === item.quantity;
                        return (
                          <article
                            key={item.id}
                            className={`station-item ${done ? "verified" : ""}`}
                          >
                            <div>
                              <span className="station-eyebrow">
                                {item.sku}
                              </span>
                              <h3>{item.name}</h3>
                              <code>{item.barcode}</code>
                              {item.serials.length > 0 && (
                                <details>
                                  <summary>
                                    SN · {item.serials.length} 件
                                  </summary>
                                  {item.serials.map((s) => (
                                    <div key={s.value}>
                                      <code>{s.value}</code> ·{" "}
                                      {s.status === "packed"
                                        ? "已装箱"
                                        : s.status === "picked"
                                          ? "已揀貨"
                                          : "待揀貨"}
                                    </div>
                                  ))}
                                </details>
                              )}
                            </div>
                            <strong>
                              {done ? "✓" : count}
                              <small> / {item.quantity}</small>
                            </strong>
                          </article>
                        );
                      })}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
