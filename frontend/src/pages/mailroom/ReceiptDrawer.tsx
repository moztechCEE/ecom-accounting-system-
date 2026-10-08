import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Descriptions, Divider, Drawer, Form, Image, Input, Radio, Select, Space, Steps, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import api from "../../services/api";
import { CATEGORIES, errorText, type Person, type Source } from "./model";
import { mailroomDraftFingerprint, type MailroomDraftState } from "./mailroom-draft";
import type { RepairMessage } from "../repair/repair-feedback";
import SourceCasePicker from "./SourceCasePicker";
import SourceCasePhotos from "./SourceCasePhotos";
import RecipientPicker from "./RecipientPicker";
import ReceivedProductPicker, { type ReceivedProduct } from "./ReceivedProductPicker";
import ReceiptPhotoInput from "./ReceiptPhotoInput";
import { photoBytes, RECEIPT_PHOTO_LIMIT } from "./receipt-photos";
import ReceiptLocationPicker from "./ReceiptLocationPicker";

const { Text } = Typography;
class ReceiptValidationError extends Error {}
type Row = { productId?: string; productName: string; sku?: string; barcode?: string; serialNumber?: string; sourceItemId?: string; evidence?: string[]; manual?: boolean };
function sourcePhysicalRows(source: Source): Row[] {
  return source.items.flatMap(item => Array.from({ length: Math.min(item.remainingQuantity ?? item.quantity, 50) }, () => ({ productName: "", sourceItemId: item.id }))).slice(0, 50);
}
export default function ReceiptDrawer({ feedback, guardChange, onDraftChange, initialSource, initialCategory, open, entityId, people, onClose, onCreated }: {
  feedback: RepairMessage; guardChange: (change: () => void) => void; onDraftChange: (state: MailroomDraftState) => void;
  initialSource?: Source; initialCategory: string; open: boolean; entityId: string; people: Person[]; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false), [source, setSource] = useState<Source>(), [error, setError] = useState(""), [step, setStep] = useState(0), [uncertain, setUncertain] = useState(false), [freeLocation, setFreeLocation] = useState(false), [photoReading, setPhotoReading] = useState(false);
  const category = Form.useWatch("category", form), watchedRows: Row[] = Form.useWatch("items", form) || [];
  const operation = useRef<{ body: string; id: string } | undefined>(undefined), baseline = useRef(""), working = useRef(false), unknown = useRef(false), photoBusy = useRef(new Set<number>()), scope = useRef(0);
  const products = useRef(new Map<string, ReceivedProduct>());
  const isCase = ["REPAIR", "RETURN"].includes(category), isCorrespondence = ["LETTER", "PARCEL"].includes(category);
  const publishDraft = useCallback(() => onDraftChange({ dirty: open && (unknown.current || baseline.current !== mailroomDraftFingerprint(form.getFieldsValue(true))), busy: working.current || photoBusy.current.size > 0, uncertain: unknown.current }), [form, onDraftChange, open]);
  function setWorking(value: boolean) { working.current = value; setBusy(value); publishDraft(); }
  const clearDraft = useCallback(() => { operation.current = undefined; unknown.current = false; setUncertain(false); baseline.current = mailroomDraftFingerprint(form.getFieldsValue(true)); onDraftChange({ dirty: false, busy: false }); }, [form, onDraftChange]);
  useEffect(() => {
    scope.current++;
    if (open) {
      form.resetFields(); form.setFieldsValue(initialSource ? { category: initialSource.type, sourceCaseId: initialSource.id, items: sourcePhysicalRows(initialSource) } : { category: initialCategory || undefined, items: [{ productName: "" }] });
      setSource(initialSource); setError(""); setStep(0); setFreeLocation(false); setPhotoReading(false); products.current.clear(); photoBusy.current.clear(); clearDraft();
    } else clearDraft();
  }, [open, entityId, initialCategory, initialSource, form, clearDraft]);
  useEffect(() => () => onDraftChange({ dirty: false, busy: false }), [onDraftChange]);
  function close() { guardChange(() => { clearDraft(); onClose(); }); }
  function validatePhotos() {
    const rows = form.getFieldValue("items") as Row[];
    if (!isCorrespondence && rows.some(row => !row.evidence?.length)) throw new ReceiptValidationError("請為每件實收產品拍照留底");
    if (rows.reduce((sum, row) => sum + (row.evidence || []).reduce((bytes, photo) => bytes + photoBytes(photo), 0), 0) > RECEIPT_PHOTO_LIMIT) throw new ReceiptValidationError("本次收件照片合計不可超過 12 MB，請分批登記");
  }
  async function next() {
    setError("");
    try {
      if (step === 0) { await form.validateFields(); setStep(1); }
      else { validatePhotos(); setStep(2); }
    } catch (e) { if (!(e as { errorFields?: unknown }).errorFields) setError(e instanceof ReceiptValidationError ? e.message : errorText(e)); }
  }
  async function submit() {
    if (working.current || photoBusy.current.size) return;
    const requestScope = scope.current;
    setWorking(true); setError("");
    try {
      if (!unknown.current) {
        const values = await form.validateFields(); validatePhotos();
        const correspondence = ["LETTER", "PARCEL"].includes(values.category), caseCategory = ["REPAIR", "RETURN"].includes(values.category);
        const body = JSON.stringify({ entityId, category: values.category,
          ...(caseCategory ? { sourceCaseId: values.sourceCaseId, sourceVersion: source?.version } : {}),
          ...(correspondence ? { recipientId: values.recipientId } : {}),
          carrier: values.carrier, trackingNumber: values.trackingNumber, senderLabel: values.senderLabel,
          location: values.location, storageLocationId: values.storageLocationId,
          items: (values.items as Row[]).map(row => ({ productName: row.productName,
            ...(!correspondence ? { productId: row.productId, sku: row.sku, barcode: row.barcode, serialNumber: row.serialNumber, evidence: row.evidence } : { evidence: row.evidence }),
            ...(caseCategory ? { sourceItemId: row.sourceItemId } : {}) })) });
        if (operation.current?.body !== body) operation.current = { body, id: crypto.randomUUID() };
      }
      const result = await api.post<{ itemIds: string[] }>("/mailroom/receipts", { ...JSON.parse(operation.current!.body), requestId: operation.current!.id });
      if (scope.current !== requestScope) return;
      feedback.success("已登記收件"); clearDraft(); setWorking(false); onCreated(result.data.itemIds[0]);
    } catch (e) {
      if (scope.current !== requestScope) return;
      if (!(e as { errorFields?: unknown }).errorFields) {
        const status = (e as { response?: { status?: number } }).response?.status;
        if (operation.current && (!status || status >= 500)) { unknown.current = true; setUncertain(true); publishDraft(); }
        setError(e instanceof ReceiptValidationError ? e.message : errorText(e));
      }
    } finally { if (scope.current === requestScope) setWorking(false); }
  }
  const locked = busy || uncertain || photoReading;
  return <Drawer title="登記收件" width="min(820px, 100vw)" open={open} onClose={close} forceRender footer={<Space>
    {step > 0 && <Button disabled={locked} onClick={() => setStep(value => value - 1)}>上一步</Button>}
    <Button type="primary" size="large" loading={busy} disabled={!busy && photoReading} onClick={() => void (step === 2 ? submit() : next())}>{uncertain ? "重試原登記" : step === 2 ? "確認並登記收件" : "下一步"}</Button>
    <Button disabled={busy || photoReading} onClick={close}>取消</Button>
  </Space>}>
    <Steps current={step} size="small" className="mailroom-receipt-steps" items={[{ title: "選擇" }, { title: "拍照" }, { title: "核對資料" }]} />
    <Form form={form} layout="vertical" disabled={busy || uncertain} onValuesChange={publishDraft} preserve>
      <div hidden={step !== 0}>
        <Form.Item name="category" label="收到什麼？" rules={[{ required: true, message: "請選擇收件類型" }]}><Radio.Group className="mailroom-category-options" options={Object.entries(CATEGORIES).map(([value, label]) => ({ value, label: value === "UNMATCHED" ? "找不到售後案件" : label }))} optionType="button" buttonStyle="solid"
          onChange={() => { setSource(undefined); products.current.clear(); form.setFieldsValue({ sourceCaseId: undefined, recipientId: undefined, items: [{ productName: "" }] }); publishDraft(); }} /></Form.Item>
        {isCase && <Form.Item name="sourceCaseId" label="對應售後案件" rules={[{ required: true, message: "請選擇售後案件；找不到時改選「找不到售後案件」" }]}>
          <SourceCasePicker entityId={entityId} active={open && isCase} selectedSource={source} onSelectSource={selected => { setSource(selected); products.current.clear(); form.setFieldsValue({ category: selected.type, items: sourcePhysicalRows(selected) }); publishDraft(); }} />
        </Form.Item>}
        {source && <div><Text type="secondary">{source.customerLabel}{source.customerPhone ? ` · ${source.customerPhone}` : ""}</Text></div>}
        {source && <SourceCasePhotos key={`${entityId}:${source.id}`} entityId={entityId} caseId={source.id} active={open} />}
        {isCorrespondence && <Form.Item name="recipientId" label="收件部門／同仁" rules={[{ required: true, message: "請選擇收件人" }, { validator: (_, value) => !value || people.some(person => person.id === value) ? Promise.resolve() : Promise.reject(new Error("請重新選擇收件同仁")) }]}><RecipientPicker key={category} people={people} label="收件同仁" disabled={locked} /></Form.Item>}
        {category === "UNMATCHED" && <Text type="secondary">先記錄實收物件與儲位，登記後可交客服補配對。</Text>}
        <div className="mailroom-form-grid"><Form.Item name="carrier" label="入件物流公司"><Input maxLength={100} /></Form.Item><Form.Item name="trackingNumber" label="入件物流單號"><Input maxLength={100} /></Form.Item></div>
        <Form.Item name="senderLabel" label={isCorrespondence ? "對方公司名稱／寄件人姓名" : "寄件人／單位"} rules={isCorrespondence ? [{ required: true, whitespace: true, message: "請填寫對方公司名稱／寄件人姓名" }] : []}><Input maxLength={160} /></Form.Item>
        <Form.Item label="收件儲位" name="storageLocationId" rules={!freeLocation ? [{ required: true, message: "請選擇儲位，或登記臨時存放位置" }] : []}>
          <ReceiptLocationPicker entityId={entityId} active={open} disabled={locked || freeLocation} onChange={(id, code) => { form.setFieldsValue({ storageLocationId: id, location: code }); publishDraft(); }} />
        </Form.Item>
        <Checkbox checked={freeLocation} disabled={locked} onChange={event => { setFreeLocation(event.target.checked); form.setFieldsValue({ storageLocationId: undefined, location: undefined }); publishDraft(); }}>使用臨時存放位置</Checkbox>
        <Form.Item name="location" label={freeLocation ? "臨時存放位置" : undefined} hidden={!freeLocation} rules={[{ required: true, whitespace: true, message: "請填寫存放位置" }]}><Input maxLength={160} placeholder="例如收件桌旁暫存箱" /></Form.Item>
      </div>
      <Form.List name="items" rules={[{ validator: (_, rows) => rows?.length ? Promise.resolve() : Promise.reject(new Error("至少登記一件物件")) }]}>{(fields, { add, remove }, { errors }) => <>
        {fields.map((item, index) => { const row = watchedRows[item.name] || {} as Row; const declared = source?.items.find(line => line.id === row.sourceItemId); return <Card key={item.key} className="mailroom-receipt-item" size="small" title={`第 ${index + 1} 件${step === 1 ? ` · ${row.productName || "實收物件"}` : ""}`} extra={step === 0 && fields.length > 1 && <Button type="text" danger disabled={locked} onClick={() => { remove(item.name); publishDraft(); }}>移除</Button>}>
          <div hidden={step !== 0}>
            {isCase && <Form.Item name={[item.name, "sourceItemId"]} label="原售後申報品項" rules={[{ required: true }]}><Select options={(source?.items || []).map(line => ({ value: line.id, label: `${line.name} · 尚待 ${line.remainingQuantity ?? line.quantity} 件` }))} /></Form.Item>}
            {declared && <div className="mailroom-declared-product"><Text type="secondary">申報：{declared.name}{declared.sku ? ` · SKU ${declared.sku}` : ""}{declared.serialNumber ? ` · SN ${declared.serialNumber}` : ""}</Text></div>}
            {!isCorrespondence && <><Form.Item name={[item.name, "productId"]} label="選擇實收產品" getValueFromEvent={(product: ReceivedProduct) => product.id} rules={!row.manual ? [{ required: true, message: "請選擇實收產品，或改為手動登記" }] : []}>
              <ReceivedProductPicker entityId={entityId} active={open && !isCorrespondence} disabled={locked || row.manual} selected={row.productId ? products.current.get(row.productId) : undefined} onChange={product => { products.current.set(product.id, product); form.setFieldValue(["items", item.name, "productId"], product.id); form.setFieldValue(["items", item.name, "productName"], product.name); form.setFieldValue(["items", item.name, "sku"], product.sku || undefined); form.setFieldValue(["items", item.name, "barcode"], product.barcode || undefined); publishDraft(); }} />
            </Form.Item><Form.Item name={[item.name, "manual"]} valuePropName="checked"><Checkbox disabled={locked} onChange={() => { ["productId", "productName", "sku", "barcode"].forEach(key => form.setFieldValue(["items", item.name, key], undefined)); publishDraft(); }}>找不到產品，手動登記</Checkbox></Form.Item></>}
            <Form.Item name={[item.name, "productName"]} label={category === "LETTER" ? "信件名稱／內容" : category === "PARCEL" ? "包裹內容／名稱" : "實收產品名稱"} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} readOnly={!isCorrespondence && !row.manual} /></Form.Item>
            {!isCorrespondence && <><div className="mailroom-form-grid"><Form.Item name={[item.name, "sku"]} label="實收 SKU"><Input maxLength={100} readOnly={!row.manual} /></Form.Item><Form.Item name={[item.name, "barcode"]} label="產品條碼"><Input maxLength={100} readOnly={!row.manual} /></Form.Item></div><Form.Item name={[item.name, "serialNumber"]} label="實物 SN"><Input maxLength={100} placeholder="掃描或輸入實物上的序號" /></Form.Item></>}
          </div>
          <div hidden={step !== 1}><Form.Item name={[item.name, "evidence"]} label={isCorrespondence ? "收件照片（選填）" : "實收產品與外包裝照片"}><ReceiptPhotoInput disabled={busy || uncertain} onBusyChange={value => { if (value) photoBusy.current.add(item.key); else photoBusy.current.delete(item.key); setPhotoReading(photoBusy.current.size > 0); publishDraft(); }} /></Form.Item></div>
          {step === 2 && <><Descriptions size="small" column={1} items={[
            ...(declared ? [{ key: "declared", label: "原申報品項", children: `${declared.name}${declared.sku ? ` · ${declared.sku}` : ""}${declared.serialNumber ? ` · SN ${declared.serialNumber}` : ""}` }] : []),
            { key: "actual", label: "實際收到", children: row.productName },
            ...(!isCorrespondence ? [{ key: "sku", label: "SKU／條碼", children: [row.sku, row.barcode].filter(Boolean).join(" · ") || "未填" }, { key: "sn", label: "實物 SN", children: row.serialNumber || "未提供" }] : []),
          ]} /><Image.PreviewGroup><Space wrap>{row.evidence?.map((photo, i) => <Image key={photo} src={photo} width={70} height={70} style={{ objectFit: "cover" }} alt={`第 ${index + 1} 件實收照片 ${i + 1}`} />)}</Space></Image.PreviewGroup></>}
        </Card>; })}
        {step === 0 && <Button block type="dashed" icon={<PlusOutlined />} disabled={locked || fields.length >= 50 || !category || category === "UNMATCHED"} onClick={() => { add({ productName: "" }); publishDraft(); }}>增加一件實物</Button>}
        <Form.ErrorList errors={errors} />
      </>}</Form.List>
      {step === 2 && <><Divider /><Descriptions column={1} size="small" items={[{ key: "case", label: isCorrespondence ? "收件人" : "對應案件", children: isCorrespondence ? people.find(person => person.id === form.getFieldValue("recipientId"))?.name : source?.number || "待客服配對" }, { key: "place", label: "存放位置", children: form.getFieldValue("location") }, { key: "tracking", label: "入件單號", children: form.getFieldValue("trackingNumber") || "未提供" }]} />{!isCorrespondence && <Text type="secondary">登記後進入品項核對{category === "RETURN" ? "與退貨分級" : ""}，再交接給下一位處理人員。</Text>}</>}
      {uncertain && <Alert type="warning" message="登記結果尚未確認" description="請重試原登記；照片與請求內容已鎖定，重試不會新增第二筆。" style={{ marginTop: 16 }} />}
      {error && <Alert type="error" message={error} style={{ marginTop: 16 }} />}
    </Form>
  </Drawer>;
}
