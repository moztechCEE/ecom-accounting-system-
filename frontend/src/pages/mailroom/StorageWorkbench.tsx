import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Empty, Form, Input, InputNumber, Modal, Segmented, Select, Space, Spin, Switch, Tag } from "antd";
import { EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import api from "../../services/api";
import { STATUS } from "./model";
import { mailroomDraftFingerprint } from "./mailroom-draft";
import type { MailroomDraftState } from "./mailroom-draft";
import { STORAGE_ZONES, storageFailure, storageFloorBounds, storageItemMatches, storageLocationMatches, storageLocationOptions, storageOutcomeUnknown, storageRequestId } from "./storage-model";
import type { StorageItem, StorageLocation, StorageOperation, StorageRack, StorageSnapshot } from "./storage-model";
import "./storage.css";

function useStorage(entityId: string, refreshRevision = 0) {
  const [state, setState] = useState<{ entityId: string; loading: boolean; data?: StorageSnapshot; error?: string }>({ entityId, loading: true });
  const generation = useRef(0), currentEntity = useRef(entityId), mounted = useRef(true);
  currentEntity.current = entityId;
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    if (!entityId) { setState({ entityId, loading: false, error: "請選擇公司" }); return; }
    setState(previous => ({ entityId, loading: true, data: previous.entityId === entityId ? previous.data : undefined }));
    try {
      const response = await api.get<StorageSnapshot>("/mailroom/storage", { params: { entityId } });
      if (mounted.current && ticket === generation.current && currentEntity.current === entityId)
        setState({ entityId, loading: false, data: response.data });
    } catch (error) {
      if (mounted.current && ticket === generation.current && currentEntity.current === entityId)
        setState(previous => ({ entityId, loading: false, data: previous.entityId === entityId ? previous.data : undefined, error: storageFailure(error) }));
    }
  }, [entityId]);
  useEffect(() => {
    const requests = generation;
    mounted.current = true; void refresh();
    return () => { mounted.current = false; requests.current++; };
  }, [refresh, refreshRevision]);
  return { ...(state.entityId === entityId ? state : { entityId, loading: true }), refresh };
}

type Dialog = { entityId: string; kind: "createRack" | "editRack" | "createLocation" | "editLocation" | "move"; rack?: StorageRack; location?: StorageLocation; item?: StorageItem };
type Selection = { entityId: string; kind: "rack" | "location" | "unassigned"; id?: string };
const DIALOG_TITLES = { createRack: "新增貨架", editRack: "編輯貨架", createLocation: "新增儲位", editLocation: "編輯儲位", move: "移動物品" };

export default function StorageWorkbench({ entityId, onOpenItem, onChanged, onDraftChange, resetDraftRevision = 0, refreshRevision = 0 }: {
  entityId: string; onOpenItem: (id: string) => void; onChanged?: () => void;
  onDraftChange?: (state: MailroomDraftState) => void; resetDraftRevision?: number; refreshRevision?: number;
}) {
  const { data, loading, error, refresh } = useStorage(entityId, refreshRevision);
  const [query, setQuery] = useState(""), [view, setView] = useState("立體貨架"), [showInactive, setShowInactive] = useState(false);
  const [selection, setSelection] = useState<Selection>(), [dialog, setDialog] = useState<Dialog>();
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [failure, setFailure] = useState("");
  const [notice, setNotice] = useState<{ entityId: string; text: string }>();
  const [form] = Form.useForm();
  const operation = useRef<StorageOperation | undefined>(undefined), working = useRef(false), currentEntity = useRef(entityId), mounted = useRef(true);
  const unknown = useRef(false), draftDialog = useRef(false), baseline = useRef("");
  const draftCallback = useRef(onDraftChange); draftCallback.current = onDraftChange;
  const publishDraft = useCallback(() => draftCallback.current?.({ dirty: unknown.current || (draftDialog.current && baseline.current !== mailroomDraftFingerprint(form.getFieldsValue(true))), busy: working.current, uncertain: unknown.current }), [form]);
  currentEntity.current = entityId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; draftCallback.current?.({ dirty: false, busy: false }); }; }, []);
  useEffect(() => {
    if (working.current || unknown.current) return;
    operation.current = undefined; draftDialog.current = false; setDialog(undefined); setFailure("");
    form.resetFields(); publishDraft();
  }, [resetDraftRevision, form, publishDraft]);
  const matchingRacks = (data?.racks || []).filter(rack => showInactive || rack.isActive);
  const binLocations = (data?.locations || []).filter(location => showInactive || location.isActive);
  const selected = selection?.entityId === entityId ? selection : undefined;
  const activeDialog = dialog?.entityId === entityId ? dialog : undefined;
  const selectedRack = selected?.kind === "rack" ? data?.racks.find(rack => rack.id === selected.id) : undefined;
  const selectedLocation = selected?.kind === "location" ? data?.locations.find(location => location.id === selected.id) : undefined;
  const canManage = Boolean(data?.canManage && !error && !loading);
  const locked = busy || uncertain;
  const visibleQuery = query.trim();
  const allSearchLocations = data?.locations.filter(location => storageLocationMatches(location, data.racks.find(rack => rack.id === location.rackId), visibleQuery)) || [];
  const unassigned = data?.unassigned.filter(item => storageItemMatches(item, visibleQuery)) || [];

  function openDialog(next: Omit<Dialog, "entityId">, initial: Record<string, unknown> = {}) {
    if (locked) return;
    operation.current = undefined; unknown.current = false; setFailure(""); setUncertain(false);
    form.resetFields();
    const nextX = Math.min(10000, Math.max(-320, ...(data?.racks || []).map(rack => rack.layoutX)) + 320);
    form.setFieldsValue(next.kind === "createRack" ? { zone: "RECEIVING", rows: 2, columns: 4, layoutX: nextX, layoutY: 0, ...initial }
      : next.kind === "editRack" ? { ...next.rack, ...initial }
      : next.kind === "editLocation" ? { ...next.location, ...initial }
      : next.kind === "move" ? { storageLocationId: undefined, ...initial }
      : { rackId: next.rack?.id, level: 1, slot: 1, ...initial });
    setDialog({ ...next, entityId });
    draftDialog.current = true; baseline.current = mailroomDraftFingerprint(form.getFieldsValue(true)); publishDraft();
  }
  function closeDialog() { if (!locked) { draftDialog.current = false; setDialog(undefined); operation.current = undefined; setFailure(""); form.resetFields(); publishDraft(); } }
  function buildOperation(values: Record<string, unknown>, target: Dialog): StorageOperation {
    const common = { entityId: target.entityId, requestId: storageRequestId() };
    if (target.kind === "createRack") return { path: "/mailroom/storage/racks", body: { ...common,
      code: String(values.code).trim(), name: String(values.name).trim(), zone: values.zone,
      rows: values.rows, columns: values.columns, layoutX: values.layoutX, layoutY: values.layoutY } };
    if (target.kind === "editRack") return { path: `/mailroom/storage/racks/${encodeURIComponent(target.rack!.id)}/update`, body: { ...common,
      expectedVersion: target.rack!.version, name: String(values.name).trim(), zone: values.zone,
      rows: values.rows, columns: values.columns, layoutX: values.layoutX, layoutY: values.layoutY, isActive: values.isActive } };
    if (target.kind === "createLocation") return { path: "/mailroom/storage/locations", body: { ...common,
      rackId: values.rackId, code: String(values.code).trim(), name: String(values.name).trim(), level: values.level, slot: values.slot } };
    if (target.kind === "editLocation") return { path: `/mailroom/storage/locations/${encodeURIComponent(target.location!.id)}/update`, body: { ...common,
      expectedVersion: target.location!.version, name: String(values.name).trim(), isActive: values.isActive } };
    return { path: `/mailroom/storage/items/${encodeURIComponent(target.item!.id)}/move`, body: { ...common,
      expectedVersion: target.item!.version, storageLocationId: values.storageLocationId || null,
      ...(!values.storageLocationId ? { location: String(values.location || "").trim() } : {}) } };
  }
  async function save() {
    if (working.current || !activeDialog) return;
    const target = activeDialog;
    working.current = true; setBusy(true); publishDraft();
    let committed = false;
    try {
      if (!operation.current) operation.current = buildOperation(await form.validateFields(), target);
      setFailure("");
      await api.post(operation.current.path, operation.current.body);
      committed = true;
      if (mounted.current && currentEntity.current === target.entityId) {
        operation.current = undefined; unknown.current = false; draftDialog.current = false; setUncertain(false); setDialog(undefined); publishDraft();
        setNotice({ entityId: target.entityId, text: target.kind === "move" ? "已更新物品儲位" : "已儲存儲位配置" });
        onChanged?.(); await refresh();
      } else { operation.current = undefined; unknown.current = false; draftDialog.current = false; if (mounted.current) { setUncertain(false); setDialog(undefined); publishDraft(); } }
    } catch (error) {
      if (mounted.current && !(error as { errorFields?: unknown }).errorFields) {
        const resultUnknown = !committed && Boolean(operation.current) && storageOutcomeUnknown(error);
        if (!resultUnknown) operation.current = undefined;
        unknown.current = resultUnknown; setUncertain(resultUnknown); setFailure(storageFailure(error)); publishDraft();
      }
    } finally { working.current = false; if (mounted.current) { setBusy(false); publishDraft(); } }
  }
  function bin(rack: StorageRack, level: number, slot: number) {
    const location = binLocations.find(location => location.rackId === rack.id && location.level === level && location.slot === slot);
    if (!location) return canManage && rack.isActive
      ? <button key={`${level}:${slot}`} className="mailroom-storage-empty-cell" aria-label={`${rack.code} 第 ${level} 層第 ${slot} 格新增儲位`} disabled={locked}
          onClick={() => openDialog({ kind: "createLocation", rack }, { level, slot })}><PlusOutlined /></button>
      : <div key={`${level}:${slot}`} className="mailroom-storage-empty-cell" aria-hidden="true" />;
    const match = visibleQuery && storageLocationMatches(location, rack, visibleQuery);
    return <button key={location.id} className={`mailroom-storage-bin${match ? " is-match" : ""}${!location.isActive ? " is-inactive" : ""}${selectedLocation?.id === location.id ? " is-selected" : ""}`}
      aria-label={`${location.code}，${location.name}，${location.items.length} 件${!location.isActive ? "，已停用" : ""}`}
      onClick={() => setSelection({ entityId, kind: "location", id: location.id })}>
      <strong>{location.code}</strong><span>{location.items.length ? `${location.items.length} 件` : "空位"}</span>
      <small>{location.name}</small>{location.items[0] && <small>{location.items[0].productName}{location.items.length > 1 ? ` 等 ${location.items.length} 件` : ""}</small>}
      {!location.isActive && <small>已停用</small>}
    </button>;
  }
  function rackGrid(rack: StorageRack) {
    return <div className="mailroom-storage-rack-grid" style={{ gridTemplateColumns: `repeat(${rack.columns}, minmax(64px, 1fr))` }}>
      {Array.from({ length: rack.rows }, (_, index) => rack.rows - index).flatMap(level => Array.from({ length: rack.columns }, (_, slot) => bin(rack, level, slot + 1)))}
    </div>;
  }
  function items(itemsToShow: StorageItem[]) {
    return <div className="mailroom-storage-items">{itemsToShow.length ? itemsToShow.map(item => <div className="mailroom-storage-item" key={item.id}>
      <div className="mailroom-storage-item-main"><button className="mailroom-storage-item-name" onClick={() => onOpenItem(item.id)}>{item.productName}</button>
        <div className="mailroom-storage-item-meta">{item.sourceNumber || item.receiptNumber} · {STATUS[item.status] || item.status}</div>
        <div className="mailroom-storage-item-meta">{[item.sku, item.serialNumber].filter(Boolean).join(" · ")}</div>
        <div className="mailroom-storage-item-meta">{item.location} · {item.custodianName}</div>
      </div>{item.canMove && <Button size="small" disabled={locked || loading || !!error} onClick={() => openDialog({ kind: "move", item })}>移動儲位</Button>}
    </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="沒有物品" />}</div>;
  }
  const bounds = storageFloorBounds(matchingRacks);
  const moveDestination = Form.useWatch("storageLocationId", form);
  return <section className="mailroom-storage" aria-label="儲位管理">
    <div className="mailroom-storage-toolbar">
      <Input className="mailroom-storage-search" aria-label="搜尋儲位或物品" prefix={<SearchOutlined />} allowClear value={query} maxLength={100}
        placeholder="儲位、產品、案件或 SN" onChange={event => setQuery(event.target.value)} />
      <div className="mailroom-storage-tools"><Segmented aria-label="儲位視圖" value={view} options={["立體貨架", "平面區域"]} onChange={setView} />
        <Button aria-label="重新整理儲位" icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()} />
        {data?.canManage && <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} disabled={!canManage || locked} onClick={() => openDialog({ kind: "createRack" })}>新增貨架</Button>}
      </div>
    </div>
    {notice?.entityId === entityId && <Alert type="success" message={notice.text} closable onClose={() => setNotice(undefined)} style={{ marginBottom: 12 }} />}
    {dialog && dialog.entityId !== entityId && locked && <Alert type="warning" message="另一公司的操作尚未確認，請返回該公司完成。" style={{ marginBottom: 12 }} />}
    {error && <Alert type="error" message={error} action={<Button onClick={() => void refresh()} loading={loading}>重試</Button>} style={{ marginBottom: 12 }} />}
    <Spin spinning={loading}>
      {data ? <>
        <Space wrap style={{ marginBottom: 12 }}><Tag>已放儲位 {data.counts.stored} 件</Tag><Button onClick={() => setSelection({ entityId, kind: "unassigned" })}>未配儲位 {data.counts.unassigned} 件</Button>
          {data.canManage && <Switch size="small" checked={showInactive} onChange={setShowInactive} checkedChildren="含停用" unCheckedChildren="僅啟用" aria-label="顯示停用儲位" />}
          {data.canManage && <Button disabled={!canManage || locked || !data.racks.some(rack => rack.isActive)} onClick={() => openDialog({ kind: "createLocation" })}>新增儲位</Button>}
        </Space>
        {!matchingRacks.length ? <Empty description="尚無貨架" /> : view === "立體貨架" ? <>
          {(["RECEIVING", "OUTBOUND"] as const).map(zone => {
            const racks = matchingRacks.filter(rack => rack.zone === zone).sort((a, b) => a.layoutY - b.layoutY || a.layoutX - b.layoutX || a.code.localeCompare(b.code));
            return racks.length ? <div className="mailroom-storage-zone" key={zone}><h3>{STORAGE_ZONES[zone]}</h3><div className="mailroom-storage-racks">
              {racks.map(rack => <article className="mailroom-storage-rack" key={rack.id} aria-label={`${rack.code} ${rack.name}`}>
                <div className="mailroom-storage-rack-heading"><strong>{rack.code} · {rack.name}</strong><Space size={4}>{!rack.isActive && <Tag>已停用</Tag>}
                  {data.canManage && <Button size="small" icon={<EditOutlined />} aria-label={`編輯貨架 ${rack.code}`} disabled={!canManage || locked} onClick={() => openDialog({ kind: "editRack", rack })} />}</Space></div>{rackGrid(rack)}
              </article>)}</div></div> : null;
          })}
        </> : <div className="mailroom-storage-floor-scroll" tabIndex={0} aria-label="平面儲位區域"><div className="mailroom-storage-floor" style={{ width: bounds.width, height: bounds.height }}>
          {matchingRacks.map(rack => {
            const locations = data.locations.filter(location => location.rackId === rack.id);
            const highlighted = visibleQuery && locations.some(location => storageLocationMatches(location, rack, visibleQuery));
            return <button key={rack.id} className={`mailroom-storage-floor-rack${rack.zone === "OUTBOUND" ? " is-outbound" : ""}${highlighted ? " is-match" : ""}`}
              style={{ left: rack.layoutX - bounds.minX + 24, top: rack.layoutY - bounds.minY + 24 }} onClick={() => setSelection({ entityId, kind: "rack", id: rack.id })}>
              <strong>{rack.code} · {rack.name}</strong><span>{STORAGE_ZONES[rack.zone]} · {locations.reduce((sum, location) => sum + location.items.length, 0)} 件</span><span>{locations.filter(location => location.isActive).length} 個儲位</span>
            </button>;
          })}
        </div></div>}
        {visibleQuery && <div className="mailroom-storage-list" aria-label="搜尋結果">
          {allSearchLocations.map(location => <Button key={location.id} onClick={() => setSelection({ entityId, kind: "location", id: location.id })}>{location.code} · {location.name} · {location.items.length} 件</Button>)}
          {unassigned.length > 0 && <Button onClick={() => setSelection({ entityId, kind: "unassigned" })}>未配儲位 · {unassigned.length} 件符合</Button>}
          {!allSearchLocations.length && !unassigned.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="沒有符合的儲位或物品" />}
        </div>}
      </> : !loading && !error ? <Empty description="尚無儲位資料" /> : null}
    </Spin>
    <Drawer title={selectedLocation ? `${selectedLocation.code} · ${selectedLocation.name}` : selectedRack ? `${selectedRack.code} · ${selectedRack.name}` : "未配儲位"}
      width="min(600px, 100vw)" open={Boolean(selected)} onClose={() => setSelection(undefined)}>
      {selectedLocation ? <><div className="mailroom-storage-location-summary"><Tag>{selectedLocation.items.length} 件</Tag>{!selectedLocation.isActive && <Tag>已停用</Tag>}
        {data?.canManage && <Button icon={<EditOutlined aria-hidden="true" />} disabled={!canManage || locked} onClick={() => openDialog({ kind: "editLocation", location: selectedLocation })}>編輯儲位</Button>}</div>{items(selectedLocation.items)}</>
        : selectedRack ? <><div className="mailroom-storage-location-summary"><Tag>{STORAGE_ZONES[selectedRack.zone]}</Tag>{data?.canManage && <Button disabled={!canManage || locked} onClick={() => openDialog({ kind: "editRack", rack: selectedRack })}>編輯貨架</Button>}</div>{rackGrid(selectedRack)}</>
        : selected?.kind === "unassigned" ? items(visibleQuery ? unassigned : data?.unassigned || []) : <Empty description="儲位已更新，請重新選擇" />}
    </Drawer>
    <Modal title={activeDialog ? DIALOG_TITLES[activeDialog.kind] : "儲位"} open={Boolean(activeDialog)} destroyOnHidden={false} forceRender zIndex={1200}
      onCancel={closeDialog} maskClosable={!locked} closable={!locked} keyboard={!locked} confirmLoading={busy} onOk={() => void save()}
      okText={uncertain ? "重試原操作" : activeDialog?.kind === "move" ? "確認移位" : "儲存"}
      okButtonProps={{ "aria-label": uncertain ? "重試原操作" : activeDialog?.kind === "move" ? "確認移位" : "儲存" }} cancelButtonProps={{ disabled: locked, "aria-label": "取消" }}>
      <Form form={form} layout="vertical" disabled={locked} preserve={false} onValuesChange={publishDraft}>
        {activeDialog && ["createRack", "editRack"].includes(activeDialog.kind) ? <>
          {activeDialog.kind === "createRack" ? <Form.Item name="code" label="貨架編碼" rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/, message: "請使用英文、數字、底線或連字號" }]}><Input aria-label="貨架編碼" maxLength={16} placeholder="例如 A" /></Form.Item> : <Tag>{activeDialog.rack?.code}</Tag>}
          <Form.Item name="name" label="貨架名稱" rules={[{ required: true, whitespace: true }]}><Input aria-label="貨架名稱" maxLength={80} /></Form.Item>
          <Form.Item name="zone" label="區域" rules={[{ required: true }]}><Select aria-label="區域" options={Object.entries(STORAGE_ZONES).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <div className="mailroom-storage-form-grid"><Form.Item name="rows" label="層數" rules={[{ required: true }]}><InputNumber aria-label="層數" min={1} max={8} precision={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="columns" label="每層格數" rules={[{ required: true }]}><InputNumber aria-label="每層格數" min={1} max={8} precision={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="layoutX" label="平面位置 X" rules={[{ required: true }]}><InputNumber aria-label="平面位置 X" min={-10000} max={10000} precision={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="layoutY" label="平面位置 Y" rules={[{ required: true }]}><InputNumber aria-label="平面位置 Y" min={-10000} max={10000} precision={0} style={{ width: "100%" }} /></Form.Item></div>
          {activeDialog.kind === "editRack" && <Form.Item name="isActive" label="啟用" valuePropName="checked"><Switch /></Form.Item>}
        </> : activeDialog && ["createLocation", "editLocation"].includes(activeDialog.kind) ? <>
          {activeDialog.kind === "createLocation" ? <><Form.Item name="rackId" label="貨架" rules={[{ required: true }]}><Select options={data?.racks.filter(rack => rack.isActive).map(rack => ({ value: rack.id, label: `${rack.code} · ${rack.name}` }))} /></Form.Item>
            <Form.Item name="code" label="儲位編碼" rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/, message: "請使用英文、數字、底線或連字號" }]}><Input maxLength={24} placeholder="例如 A5" /></Form.Item></> : <Tag>{activeDialog.location?.code}</Tag>}
          <Form.Item name="name" label="儲位名稱" rules={[{ required: true, whitespace: true }]}><Input maxLength={80} /></Form.Item>
          {activeDialog.kind === "createLocation" ? <div className="mailroom-storage-form-grid"><Form.Item name="level" label="層" rules={[{ required: true }]}><InputNumber min={1} max={8} precision={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="slot" label="格" rules={[{ required: true }]}><InputNumber min={1} max={8} precision={0} style={{ width: "100%" }} /></Form.Item></div> : <Form.Item name="isActive" label="啟用" valuePropName="checked"><Switch /></Form.Item>}
        </> : activeDialog?.kind === "move" ? <>
          <div className="mailroom-storage-item-meta" style={{ marginBottom: 16 }}>{activeDialog.item?.productName} · {activeDialog.item?.location}</div>
          <Form.Item name="storageLocationId" label="移往儲位"><Select aria-label="移往儲位" allowClear showSearch optionFilterProp="label" placeholder="選擇儲位" options={data ? storageLocationOptions(data) : []} /></Form.Item>
          {!moveDestination && <Form.Item name="location" label="儲位以外的位置" rules={[{ required: true, whitespace: true }]}><Input maxLength={160} /></Form.Item>}
        </> : null}
        {failure && <Alert type="error" message={failure} style={{ marginTop: 8 }} />}
        {uncertain && <Alert type="warning" message="結果未確認，請重試原操作。" style={{ marginTop: 8 }} />}
      </Form>
    </Modal>
  </section>;
}
