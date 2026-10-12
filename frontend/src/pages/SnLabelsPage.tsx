import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from "antd";
import dayjs from "dayjs";
import { useAuth } from "../contexts/AuthContext";
import { useEntityContext } from "../hooks/useEntityContext";
import { productService } from "../services/product.service";
import type { Product } from "../services/product.service";
import LabelDesigner from "../features/sn-labels/LabelDesigner";
import CartonPreview from "../features/sn-labels/CartonPreview";
import {
  CONFIRMED_RULES,
  draftStorageKey,
  newDraft,
  isNoSerial,
  parseDrafts,
  sampleSerial,
  splitExistingSerials,
  validateExistingSerials,
  defaultInternalScanCode,
} from "../features/sn-labels/model";
import type { SnDraft } from "../features/sn-labels/model";
import { errorText, productDefaults, snApi } from "../features/sn-labels/api";
import type { Detail, Entry } from "../features/sn-labels/api";
import "./SnLabelsPage.css";
import { readExistingSerialWorkbook } from "../features/sn-labels/existing-serials-file";

export default function SnLabelsPage() {
  const { user } = useAuth(),
    entityId = useEntityContext();
  if (!user || !entityId)
    return <Alert type="warning" message="請先確認登入公司" />;
  const canWrite =
    user.roles.some((r) => ["ADMIN", "SUPER_ADMIN"].includes(r)) ||
    user.permissions.includes("inventory:update");
  return (
    <Workspace
      key={`${entityId}:${user.id}`}
      entityId={entityId}
      storageKey={draftStorageKey(entityId, user.id)}
      canWrite={canWrite}
    />
  );
}
function Workspace({
  entityId,
  storageKey,
  canWrite,
}: {
  entityId: string;
  storageKey: string;
  canWrite: boolean;
}) {
  const api = useMemo(() => snApi(entityId), [entityId]);
  const [draft, setDraft] = useState(() => newDraft(crypto.randomUUID())),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false);
  const noSerial = isNoSerial(draft);
  const existingSerials = draft.serialSource === "existing";
  const [snText, setSnText] = useState("");
  const [manifestOpen, setManifestOpen] = useState(false),
    [manifestForm] = Form.useForm();
  const [active, setActive] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("batch"),
    [products, setProducts] = useState<Product[]>([]);
  const busyRef = useRef(false);
  const [entries, setEntries] = useState<Entry[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [sort, setSort] = useState("desc"),
    [dates, setDates] = useState<string[]>([]),
    [manufactureDates, setManufactureDates] = useState<string[]>([]),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""),
    [productError, setProductError] = useState(""),
    [cartonPage, setCartonPage] = useState(1);
  const [from, setFrom] = useState(1),
    [to, setTo] = useState(100),
    [reason, setReason] = useState("initial");
  const [columns, setColumns] = useState([
    "一般序號",
    "國際條碼",
    "箱號",
    "箱內順序",
    "產品名稱",
    "型號",
    "款式",
    "顏色",
    "下單日期",
    "製造日期",
  ]);
  const [masterOpen, setMasterOpen] = useState(false),
    [masterForm] = Form.useForm();
  const [msg, context] = message.useMessage(),
    [modal, modalContext] = Modal.useModal();
  const [localDrafts] = useState(() => {
    try {
      return parseDrafts(localStorage.getItem(storageKey));
    } catch {
      return [];
    }
  });
  useEffect(() => {
    let live = true;
    productService
      .findAll()
      .then((p) => {
        if (live) {
          setProducts(p.filter((p) => p.type !== "SERVICE"));
          setProductError("");
        }
      })
      .catch((e) => {
        if (live) setProductError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .list({
          page,
          search,
          status,
          sort,
          start: dates[0],
          end: dates[1],
          manufactureStart: manufactureDates[0],
          manufactureEnd: manufactureDates[1],
        })
        .then((v) => {
          if (live) {
            setEntries(v.rows);
            setTotal(v.total);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, page, search, status, sort, dates, manufactureDates, refresh]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const update = (v: Partial<SnDraft>) => {
    if (active) return;
    setDraft((d) => ({ ...d, ...v }));
    setDirty(true);
  };
  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      msg.error(errorText(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = async () => {
    const v = await api.save(draft, revision);
    setRevision(v.revision);
    setDirty(false);
    setRefresh((n) => n + 1);
    return v.revision;
  };
  const showActive = async (id: string) => {
    const v = await api.detail(id);
    setActive(v);
    setDraft({ ...v.data, id, version: 2, updatedAt: "" });
    setSnText((v.data.actualSN || []).join("\n"));
    setDirty(false);
    setCartonPage(1);
    setFrom(isNoSerial(v.data) ? 1 : v.first!);
    setTo(
      isNoSerial(v.data)
        ? Math.min(v.cartons, 10000)
        : Math.min(v.last!, v.first! + 9999),
    );
    setTab("output");
  };
  const replace = (fn: () => void) => {
    if (dirty)
      modal.confirm({
        title: "捨棄尚未儲存的變更？",
        okText: "捨棄",
        cancelText: "取消",
        onOk: fn,
      });
    else fn();
  };
  const open = (e: Entry) =>
    replace(() => {
      void run(async () => {
        if (e.status === "active") await showActive(e.id);
        else {
          setActive(null);
          setDraft({
            ...e.data,
            id: e.id,
            version: 2,
            updatedAt: e.updated_at,
          });
          setRevision(e.revision);
          setSnText((e.data.actualSN || []).join("\n"));
          setDirty(false);
          setTab("batch");
        }
      });
    });
  const create = () =>
    replace(() => {
      setDraft(newDraft(crypto.randomUUID()));
      setSnText("");
      setRevision(0);
      setActive(null);
      setDirty(false);
      setTab("batch");
    });
  const removeDraft = (entry: Entry) =>
    modal.confirm({
      title: `刪除草稿「${entry.data.name}」？`,
      content: "只刪除尚未啟用的草稿，不影響已配發序號與箱號。",
      okText: "刪除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () =>
        run(async () => {
          await api.remove(entry.id, entry.revision);
          if (!active && draft.id === entry.id) {
            setDraft(newDraft(crypto.randomUUID()));
            setRevision(0);
            setDirty(false);
          }
          setRefresh((n) => n + 1);
          msg.success("草稿已刪除");
        }),
    });
  const activate = () =>
    void run(async () => {
      if (!draft.name.trim()) throw new Error("請填寫批次名稱");
      const preview = await api.preview(draft);
      modal.confirm({
        title: existingSerials
          ? "確認登記既有 SN 箱號？"
          : noSerial
            ? "確認啟用無 SN 裝箱？"
            : "確認啟用並配發 SN？",
        content: existingSerials
          ? `本次 ${draft.quantity} 個既有 SN，共 ${preview.total} 箱；沿用原序號，不重新配號。`
          : noSerial
            ? `本次 ${draft.quantity} 件，共 ${preview.total} 箱；不產生單品 SN。`
            : `本次 ${draft.quantity} 個 SN，接續流水號 ${preview.first}～${preview.last}，共 ${preview.total} 箱。啟用後箱內 SN 固定。`,
        okText: existingSerials || noSerial ? "確認建立箱號" : "確認配號",
        cancelText: "取消",
        onOk: () =>
          run(async () => {
            const r = dirty || !revision ? await save() : revision;
            try {
              const v = await api.activate(draft.id, r, preview.token);
              await showActive(v.batchId);
              msg.success("已建立箱號");
            } finally {
              setRefresh((n) => n + 1);
            }
          }),
      });
    });
  const append = () => {
    if (!active) return;
    setDraft({
      ...active.data,
      id: crypto.randomUUID(),
      version: 2,
      updatedAt: "",
      quantity: 1,
      ...(active.data.serialSource === "existing"
        ? { actualSN: [], quantity: 0 }
        : {}),
    });
    setSnText("");
    setRevision(0);
    setActive(null);
    setDirty(true);
    setTab("batch");
    msg.info(
      existingSerials ? "請輸入另一份既有 SN 清單" : "請輸入本次追加數量",
    );
  };
  const output = (kind: string) =>
    void run(async () => {
      if (!active) return;
      await api.export(active.id, { kind, from, to, reason, columns });
      setActive(await api.detail(active.id, cartonPage));
      msg.success("已產生檔案；實際列印結果請核對");
    });
  const importLegacy = () =>
    void run(async () => {
      let count = 0;
      for (const d of localDrafts) {
        try {
          await api.save(d, 0);
          count++;
        } catch (e) {
          if (
            (e as { response?: { status?: number } }).response?.status !== 409
          )
            throw e;
        }
      }
      setRefresh((n) => n + 1);
      msg.success(`已匯入 ${count} 筆；既有伺服器草稿不覆寫，本機副本保留`);
    });
  const masterSave = () =>
    void run(async () => {
      const p = products.find((p) => p.id === draft.productId);
      if (!p) return;
      const values = await masterForm.validateFields();
      const updated = await productService.updateSnProfile(p.id, values);
      setProducts((rows) =>
        rows.map((row) => (row.id === p.id ? updated : row)),
      );
      update(productDefaults(updated));
      setMasterOpen(false);
      msg.success("產品 SN 建檔資料已儲存");
    });
  const importSerialFile = (file: File) =>
    void run(async () => {
      if (file.size > 2 * 1024 * 1024) throw new Error("SN 檔案不可超過 2 MB");
      if (!/\.(txt|csv|xlsx)$/i.test(file.name))
        throw new Error("請使用 TXT、CSV 或 XLSX 的 SN 清單");
      let serials: string[];
      if (/\.txt$/i.test(file.name))
        serials = splitExistingSerials(await file.text());
      else serials = readExistingSerialWorkbook(await file.arrayBuffer());
      serials = validateExistingSerials(serials);
      setSnText(serials.join("\n"));
      update({ actualSN: serials, quantity: serials.length });
      msg.success(`已載入 ${serials.length} 個 SN`);
    });
  const openManifest = () => {
    if (!active) return;
    manifestForm.setFieldsValue({
      from: 1,
      to: Math.min(active.cartons, 100),
      itemCode: active.data.wmsItemCode || active.data.sku,
      internalScanCode:
        active.data.internalScanCode ??
        (active.data.barcode ? "" : defaultInternalScanCode(active.data.sku)),
      confirmed: false,
    });
    setManifestOpen(true);
  };
  const exportManifest = async () => {
    if (!active || busyRef.current) return;
    let values;
    try {
      values = await manifestForm.validateFields();
    } catch {
      return;
    }
    await run(async () => {
      await api.manifest(active.id, {
        from: values.from,
        to: values.to,
        mapping: {
          itemCode: values.itemCode,
          internalScanCode: values.internalScanCode || "",
          confirmed: values.confirmed,
        },
      });
      setActive(await api.detail(active.id, cartonPage));
      setManifestOpen(false);
      msg.success("已匯出箱號清單");
    });
  };
  const dateField = (key: "orderDate" | "manufactureDate", label: string) => (
    <Form.Item
      label={label}
      required={key === "orderDate" || (!existingSerials && !noSerial)}
    >
      <DatePicker
        aria-label={label}
        value={draft[key] ? dayjs(draft[key]) : null}
        onChange={(v) => update({ [key]: v?.format("YYYY-MM-DD") || "" })}
      />
    </Form.Item>
  );
  let sample = "",
    sampleError = "";
  try {
    sample = sampleSerial(draft);
  } catch (e) {
    sampleError = errorText(e);
  }
  const texts = (
    keys: (
      | "model"
      | "style"
      | "color"
      | "modelCode"
      | "styleCode"
      | "colorCode"
    )[],
    labels: string[],
  ) => (
    <div className="sn-field-triple">
      {keys.map((k, i) => (
        <Form.Item
          key={k}
          label={labels[i]}
          extra={k === "modelCode" ? "無SN.產品，請填入NSI" : undefined}
        >
          <Input
            aria-label={labels[i]}
            value={draft[k]}
            maxLength={k.endsWith("Code") ? 6 : 50}
            onChange={(e) =>
              update({
                [k]: k.endsWith("Code")
                  ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                  : e.target.value,
              })
            }
          />
        </Form.Item>
      ))}
    </div>
  );
  return (
    <div className="sn-workspace">
      {context}
      {modalContext}
      <header className="sn-heading">
        <div>
          <h1>SN 與標籤</h1>
          <p>生產配號、標籤與裝箱。</p>
        </div>
        <Space wrap>
          <Tag color={active ? "green" : undefined}>
            {active ? "已啟用" : dirty ? "尚未儲存" : "草稿"}
          </Tag>
          <Button onClick={create} disabled={busy}>
            新增草稿
          </Button>
          {active ? (
            <Button onClick={append} disabled={!canWrite || busy}>
              {existingSerials ? "新增同產品草稿" : "追加數量"}
            </Button>
          ) : (
            <>
              <Button
                onClick={() =>
                  void run(async () => {
                    await save();
                    msg.success("已儲存至伺服器");
                  })
                }
                disabled={!canWrite || busy}
              >
                儲存草稿
              </Button>
              <Button
                type="primary"
                aria-label={
                  existingSerials || noSerial ? "建立箱號" : "啟用配號"
                }
                onClick={activate}
                loading={busy}
                disabled={!canWrite}
              >
                {existingSerials || noSerial ? "建立箱號" : "啟用配號"}
              </Button>
            </>
          )}
        </Space>
      </header>
      {!canWrite && (
        <Alert
          type="info"
          message="目前為唯讀權限；配號、建檔與匯出需庫存編輯權限。"
        />
      )}
      {active && (
        <Alert
          type="success"
          showIcon
          message={
            existingSerials
              ? `已登記 ${active.data.quantity} 個既有 SN／${active.cartons} 箱。`
              : noSerial
                ? `已建立 ${active.data.quantity} 件／${active.cartons} 箱，無單品 SN。`
                : `已配發 ${active.data.quantity} 個 SN／${active.cartons} 箱。漏印與破損補印沿用原 SN。`
          }
        />
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "batch",
            label: "批次資料",
            children: (
              <section className="sn-panel">
                <Form
                  layout="vertical"
                  disabled={!!active || busy || !canWrite}
                >
                  <Form.Item label="批次名稱" required>
                    <Input
                      aria-label="批次名稱"
                      value={draft.name}
                      maxLength={100}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="產品" required>
                    <Select
                      aria-label="產品"
                      showSearch
                      optionFilterProp="label"
                      value={draft.productId || undefined}
                      placeholder="搜尋商品、國際條碼、SKU 或型號"
                      options={products.map((p) => ({
                        value: p.id,
                        label: `${p.name} · ${p.barcode || ""} · ${p.sku} · ${p.modelNumber || ""}`,
                      }))}
                      onChange={(id) =>
                        void run(async () => {
                          const p = await productService.findOne(id);
                          setProducts((rows) =>
                            rows.map((row) => (row.id === p.id ? p : row)),
                          );
                          update(productDefaults(p));
                        })
                      }
                    />
                  </Form.Item>
                  <Form.Item label="序號來源">
                    <Select
                      aria-label="序號來源"
                      value={draft.serialSource || "generated"}
                      options={[
                        { value: "generated", label: "生產配號／無 SN" },
                        { value: "existing", label: "既有 SN" },
                      ]}
                      onChange={(serialSource: "generated" | "existing") => {
                        setSnText("");
                        update({
                          serialSource,
                          actualSN: [],
                          quantity: serialSource === "existing" ? 0 : 100,
                        });
                      }}
                    />
                  </Form.Item>
                  {existingSerials && (
                    <Form.Item label="既有 SN 清單" required>
                      <Input.TextArea
                        aria-label="既有 SN 清單"
                        value={snText}
                        rows={6}
                        onChange={(e) => {
                          setSnText(e.target.value);
                          const actualSN = splitExistingSerials(e.target.value);
                          update({ actualSN, quantity: actualSN.length });
                        }}
                      />
                      <label>
                        <span>匯入 SN 檔案</span>
                        <input
                          aria-label="匯入 SN 檔案"
                          type="file"
                          accept=".txt,.csv,.xlsx"
                          disabled={!!active || busy || !canWrite}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) importSerialFile(file);
                          }}
                        />
                      </label>
                    </Form.Item>
                  )}
                  {productError && (
                    <Alert
                      type="error"
                      message={`產品讀取失敗：${productError}`}
                    />
                  )}
                  <Space wrap>
                    <Tag>ERP SKU：{draft.sku || "—"}</Tag>
                    <Tag>國際條碼：{draft.barcode || "—"}</Tag>
                    <Button
                      disabled={!draft.productId}
                      onClick={() => {
                        masterForm.setFieldsValue({
                          modelNumber: draft.model,
                          barcode: draft.barcode,
                          style: draft.style,
                          color: draft.color,
                          modelCode: draft.modelCode,
                          styleCode: draft.styleCode,
                          colorCode: draft.colorCode,
                        });
                        setMasterOpen(true);
                      }}
                    >
                      產品 SN 建檔
                    </Button>
                  </Space>
                  <Form.Item label="WMS／ECOUNT 品號">
                    <Input
                      aria-label="WMS／ECOUNT 品號"
                      value={draft.wmsItemCode ?? draft.sku}
                      maxLength={100}
                      onChange={(e) => update({ wmsItemCode: e.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="內部掃描碼">
                    <Input
                      aria-label="內部掃描碼"
                      value={
                        draft.internalScanCode ??
                        (draft.barcode
                          ? ""
                          : defaultInternalScanCode(draft.sku))
                      }
                      maxLength={100}
                      onChange={(e) =>
                        update({ internalScanCode: e.target.value })
                      }
                    />
                  </Form.Item>
                  {texts(["model", "style", "color"], ["型號", "款式", "顏色"])}
                  <div className="sn-field-pair">
                    {dateField("orderDate", "下單日期")}
                    {dateField("manufactureDate", "製造日期")}
                  </div>
                  <div className="sn-field-pair">
                    <Form.Item
                      label={noSerial ? "本次產品數量" : "本次 SN 數量"}
                      required
                    >
                      <InputNumber
                        aria-label="SN 數量"
                        min={1}
                        max={10000}
                        value={draft.quantity}
                        disabled={
                          existingSerials || !!active || busy || !canWrite
                        }
                        onChange={(v) => v !== null && update({ quantity: v })}
                      />
                    </Form.Item>
                    <Form.Item label="每箱容量" required>
                      <InputNumber
                        aria-label="每箱容量"
                        min={1}
                        max={100}
                        value={draft.capacity}
                        onChange={(v) => update({ capacity: v })}
                      />
                    </Form.Item>
                  </div>
                </Form>
                <p className="sn-muted">
                  同日、同產品與同編碼組合會併入同一批次；追加另建箱號，已配箱內清單保持固定。
                </p>
              </section>
            ),
          },
          {
            key: "rules",
            label: "編碼規則",
            children: (
              <section className="sn-panel">
                <Form
                  layout="vertical"
                  disabled={!!active || busy || !canWrite}
                >
                  {!existingSerials &&
                    texts(
                      ["modelCode", "styleCode", "colorCode"],
                      ["型號代碼", "款式代碼（選填）", "顏色代碼"],
                    )}
                </Form>
                <output className="sn-code-preview">
                  {existingSerials
                    ? draft.actualSN?.[0] || "—"
                    : sample || sampleError}
                </output>
                <p className="sn-muted">
                  上方為格式樣張。實際起號由伺服器交易決定。
                </p>
                <div className="sn-pending-list">
                  {CONFIRMED_RULES.map(([name, description]) => (
                    <div key={name}>
                      <strong>{name}</strong>
                      <span>{description}</span>
                    </div>
                  ))}
                </div>
              </section>
            ),
          },
          {
            key: "design",
            label: "標籤設計",
            children: (
              <section className="sn-panel">
                {active && (
                  <Alert
                    type="info"
                    message="此為啟用時的版面；正式檔案請從「配號與匯出」下載。"
                  />
                )}
                {noSerial ? (
                  <Alert
                    type="info"
                    message="NSI 無 SN 產品使用規格箱標籤，不產生單品序號標籤。"
                  />
                ) : (
                  <LabelDesigner
                    draft={draft}
                    onChange={(label) => update({ label })}
                  />
                )}
              </section>
            ),
          },
          {
            key: "cartons",
            label: "裝箱規劃",
            children: (
              <section className="sn-panel">
                <Form
                  layout="vertical"
                  disabled={!!active || busy || !canWrite}
                >
                  <Form.Item label="規格箱貼紙寬度 mm（60 × 75 等比縮放）">
                    <InputNumber
                      min={60}
                      max={120}
                      value={draft.cartonWidth || 60}
                      onChange={(v) =>
                        v && update({ cartonWidth: v, cartonHeight: v * 1.25 })
                      }
                    />
                  </Form.Item>
                </Form>
                {active ? (
                  <Button onClick={() => setTab("output")}>
                    查看實際箱號與箱內 SN
                  </Button>
                ) : (
                  <CartonPreview
                    key={`${JSON.stringify(draft)}:${refresh}`}
                    draft={draft}
                    entityId={entityId}
                  />
                )}
                <p className="sn-muted">
                  啟用後產生
                  CTN－下單日期－型號－箱序；正式箱內明細請見配號與匯出。
                </p>
              </section>
            ),
          },
          ...(active
            ? [
                {
                  key: "output",
                  label: "配號與匯出",
                  children: (
                    <section className="sn-panel">
                      <h2>
                        共 {active.data.quantity} {noSerial ? "件" : "個 SN"}／
                        {active.cartons} 箱
                      </h2>
                      <Space wrap>
                        <span>{noSerial ? "箱序範圍" : "流水號範圍"}</span>
                        <InputNumber
                          aria-label="匯出起號"
                          min={noSerial ? 1 : active.first!}
                          max={noSerial ? active.cartons : active.last!}
                          value={from}
                          onChange={(v) => v !== null && setFrom(v)}
                        />
                        <span>～</span>
                        <InputNumber
                          aria-label="匯出迄號"
                          min={from}
                          max={noSerial ? active.cartons : active.last!}
                          value={to}
                          onChange={(v) => v !== null && setTo(v)}
                        />
                        <Select
                          aria-label="輸出原因"
                          value={reason}
                          onChange={setReason}
                          options={[
                            { value: "initial", label: "首次輸出" },
                            { value: "missed", label: "漏印補印" },
                            { value: "damaged", label: "破損重印" },
                            { value: "copy", label: "另存副本" },
                          ]}
                        />
                      </Space>
                      <p className="sn-muted">
                        {noSerial
                          ? "依箱序選擇需要列印的箱號。"
                          : "每次最多輸出 10,000 個既有 SN；外箱 PDF 保留所選序號涉及之整箱內容。"}
                      </p>
                      <Space wrap>
                        <Button
                          disabled={!canWrite || busy}
                          onClick={openManifest}
                        >
                          匯出 WMS 箱號
                        </Button>
                        {[
                          ["labels", "產品／彩盒 PDF"],
                          ["cartons", "規格箱 PDF"],
                          ["cartons-no-sn", "規格箱 PDF（無 SN）"],
                          ["warranty", "保固匯入 XLSX"],
                          ["warehouse", "倉儲 SN 明細 XLSX"],
                        ]
                          .filter(([k]) => !noSerial || k === "cartons-no-sn")
                          .map(([k, label]) => (
                            <Button
                              key={k}
                              disabled={
                                !canWrite ||
                                busy ||
                                (k === "warranty" && !active.data.barcode)
                              }
                              onClick={() => output(k)}
                            >
                              {label}
                            </Button>
                          ))}
                      </Space>
                      <Form
                        layout="vertical"
                        style={{
                          marginTop: 16,
                          display: noSerial ? "none" : undefined,
                        }}
                      >
                        <Form.Item label="倉儲明細欄位">
                          <Select
                            mode="multiple"
                            value={columns}
                            onChange={setColumns}
                            options={[
                              "一般序號",
                              "SKU",
                              "國際條碼",
                              "ERP SKU",
                              "箱號",
                              "箱內順序",
                              "產品名稱",
                              "型號",
                              "款式",
                              "顏色",
                              "下單日期",
                              "製造日期",
                            ].map((value) => ({ value, label: value }))}
                          />
                        </Form.Item>
                      </Form>
                      <Alert
                        type="info"
                        message={
                          noSerial
                            ? "無 SN 產品只提供規格箱標籤，依所選箱序輸出；重印沿用原箱號。"
                            : "保固欄位為「一般序號、SKU」，SKU 使用國際條碼。倉儲檔為可設定的 SN 明細；不會自動入庫或建立出貨單。"
                        }
                      />
                      <Table
                        rowKey="id"
                        size="small"
                        pagination={false}
                        dataSource={active.boxes}
                        scroll={{ x: 650 }}
                        expandable={{
                          rowExpandable: (b) => b.serials.length > 0,
                          expandedRowRender: (b) => (
                            <div style={{ overflowWrap: "anywhere" }}>
                              {b.serials.join(" · ")}
                            </div>
                          ),
                        }}
                        columns={[
                          { title: "箱號", dataIndex: "id" },
                          { title: "數量", dataIndex: "quantity" },
                          {
                            title: "起號",
                            render: (_, b) => b.serials[0] || "—",
                          },
                          {
                            title: "迄號",
                            render: (_, b) => b.serials.at(-1) || "—",
                          },
                        ]}
                      />
                      <Pagination
                        current={cartonPage}
                        pageSize={20}
                        total={active.cartons}
                        showSizeChanger={false}
                        onChange={(p) =>
                          void run(async () => {
                            setActive(await api.detail(active.id, p));
                            setCartonPage(p);
                          })
                        }
                      />
                      <h2 className="sn-section-title">配號與輸出紀錄</h2>
                      <Table
                        rowKey={(_, i) => String(i)}
                        size="small"
                        dataSource={active.events}
                        pagination={{ pageSize: 5 }}
                        columns={[
                          {
                            title: "時間",
                            dataIndex: "created_at",
                            render: (v) => new Date(v).toLocaleString("zh-TW"),
                          },
                          {
                            title: "操作",
                            dataIndex: "action",
                            render: (v) =>
                              v === "ALLOCATE"
                                ? "配號"
                                : v === "REGISTER_EXISTING"
                                  ? "登記既有 SN"
                                  : "輸出",
                          },
                          {
                            title: "明細",
                            dataIndex: "data",
                            render: (v) =>
                              v.kind === "manifest"
                                ? `箱序 ${v.from}～${v.to} · ${v.mapping?.itemCode || ""}`
                                : v.kind
                                  ? `${({ labels: "產品標籤", cartons: "規格箱標籤", "cartons-no-sn": "規格箱（無 SN）", warranty: "保固匯入", warehouse: "倉儲明細" } as Record<string, string>)[String(v.kind)] || v.kind} · ${v.from}～${v.to} · ${v.reason === "missed" ? "漏印補印" : v.reason === "damaged" ? "破損重印" : v.reason === "copy" ? "副本" : "首次輸出"}`
                                  : v.serialSource === "existing"
                                    ? `既有 SN，共 ${v.quantity} 個`
                                    : v.first === null
                                      ? `無 SN 裝箱，共 ${v.quantity} 件`
                                      : `${v.first}～${v.last}，共 ${v.quantity} 個`,
                          },
                        ]}
                      />
                    </section>
                  ),
                },
              ]
            : []),
        ]}
      />
      <section className="sn-panel sn-saved">
        <h2>批次查詢</h2>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            aria-label="搜尋批次"
            placeholder="商品、國際條碼、型號或批次名稱"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            aria-label="批次狀態"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: "", label: "全部狀態" },
              { value: "draft", label: "草稿" },
              { value: "active", label: "已啟用" },
            ]}
          />
          <DatePicker.RangePicker
            aria-label="下單日期篩選"
            placeholder={["下單日期起", "下單日期迄"]}
            onChange={(v) => {
              setDates(v?.map((d) => d?.format("YYYY-MM-DD") || "") || []);
              setPage(1);
            }}
          />
          <DatePicker.RangePicker
            aria-label="製造日期篩選"
            placeholder={["製造日期起", "製造日期迄"]}
            onChange={(v) => {
              setManufactureDates(
                v?.map((d) => d?.format("YYYY-MM-DD") || "") || [],
              );
              setPage(1);
            }}
          />
          <Select
            aria-label="日期排序"
            value={sort}
            onChange={setSort}
            options={[
              { value: "desc", label: "下單日期新到舊" },
              { value: "asc", label: "下單日期舊到新" },
            ]}
          />
          <Button onClick={() => setRefresh((n) => n + 1)}>重新整理</Button>
        </Space>
        {error && <Alert type="error" message={error} />}
        <Table
          rowKey="id"
          size="small"
          dataSource={entries}
          scroll={{ x: 650 }}
          pagination={{
            current: page,
            total,
            pageSize: 30,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            { title: "批次", render: (_, e) => e.data.name },
            { title: "商品", render: (_, e) => e.data.productName },
            { title: "國際條碼", render: (_, e) => e.data.barcode },
            { title: "下單日期", render: (_, e) => e.data.orderDate },
            { title: "製造日期", render: (_, e) => e.data.manufactureDate },
            { title: "數量", render: (_, e) => e.data.quantity },
            {
              title: "狀態",
              render: (_, e) => (
                <Tag color={e.status === "active" ? "green" : undefined}>
                  {e.status === "active" ? "已啟用" : "草稿"}
                </Tag>
              ),
            },
            {
              title: "操作",
              render: (_, e) => (
                <Space>
                  <Button size="small" disabled={busy} onClick={() => open(e)}>
                    開啟
                  </Button>
                  {e.status === "draft" && canWrite && (
                    <Button
                      danger
                      size="small"
                      disabled={busy}
                      onClick={() => removeDraft(e)}
                    >
                      刪除草稿
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
        {!!localDrafts.length && (
          <Button disabled={busy || !canWrite} onClick={importLegacy}>
            匯入此瀏覽器舊草稿（{localDrafts.length}）
          </Button>
        )}
      </section>
      <Modal
        title="產品 SN 建檔"
        open={masterOpen}
        onCancel={() => setMasterOpen(false)}
        onOk={masterSave}
        confirmLoading={busy}
      >
        <Form form={masterForm} layout="vertical">
          <Form.Item
            name="barcode"
            label="國際條碼"
            rules={[{ pattern: /^\d{8,14}$/, message: "請填寫 8～14 碼數字" }]}
          >
            <Input maxLength={14} />
          </Form.Item>
          {[
            ["modelNumber", "型號"],
            ["style", "款式"],
            ["color", "顏色"],
            ["modelCode", "型號代碼"],
            ["styleCode", "款式代碼（選填）"],
            ["colorCode", "顏色代碼"],
          ].map(([key, label]) => (
            <Form.Item
              key={key}
              name={key}
              label={label}
              extra={key === "modelCode" ? "無SN.產品，請填入NSI" : undefined}
            >
              <Input maxLength={key.endsWith("Code") ? 6 : 50} />
            </Form.Item>
          ))}
        </Form>
        <p>儲存在產品資料，之後選取產品會自動帶入。</p>
      </Modal>
      <Modal
        title="匯出 WMS 箱號"
        open={manifestOpen}
        onCancel={() => {
          if (!busyRef.current) setManifestOpen(false);
        }}
        maskClosable={!busy}
        keyboard={!busy}
        closable={!busy}
        onOk={exportManifest}
        confirmLoading={busy}
        okText="下載清單"
      >
        <Form
          name="carton-manifest"
          form={manifestForm}
          layout="vertical"
          disabled={busy}
        >
          <Space>
            <Form.Item
              name="from"
              label="起始箱序"
              rules={[{ required: true }]}
            >
              <InputNumber
                aria-label="匯出起始箱序"
                min={1}
                max={active?.cartons}
              />
            </Form.Item>
            <Form.Item name="to" label="結束箱序" rules={[{ required: true }]}>
              <InputNumber
                aria-label="匯出結束箱序"
                min={1}
                max={active?.cartons}
              />
            </Form.Item>
          </Space>
          <Form.Item
            name="itemCode"
            label="WMS／ECOUNT 品號"
            rules={[
              { required: true, whitespace: true, message: "請填寫對應品號" },
            ]}
          >
            <Input aria-label="WMS／ECOUNT 品號" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="internalScanCode"
            label="內部掃描碼"
            rules={[
              {
                required: !active?.data.barcode,
                whitespace: true,
                message: "沒有國條時請填寫內部掃描碼",
              },
              {
                pattern: /^ITM-[A-Za-z0-9._-]{1,96}$/,
                message: "請填寫 ITM- 開頭的有效內碼",
              },
            ]}
          >
            <Input aria-label="內部掃描碼" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="confirmed"
            valuePropName="checked"
            rules={[
              {
                validator: (_, value) =>
                  value === true
                    ? Promise.resolve()
                    : Promise.reject(new Error("請先核對品號與掃描碼")),
              },
            ]}
          >
            <Checkbox>品號與掃描碼已核對</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
