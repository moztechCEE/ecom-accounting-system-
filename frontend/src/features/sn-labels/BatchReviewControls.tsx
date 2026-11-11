import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
} from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { errorText } from "./api";
import type { BatchReview, Detail, snApi } from "./api";

const required = [{ required: true, message: "此欄必填" }];
type Decision = "approve" | "reject" | "received" | "used" | "physically-used";
type ReviewValues = {
  reason: string;
  decision: Decision;
  receipt?: {
    checkedAt: Dayjs;
    from: Dayjs;
    to?: Dayjs;
    receivedQuantity: number;
    fullScope?: boolean;
  };
  usage?: { checkedAt: Dayjs; confirmedUseReference?: string };
};
export default function BatchReviewControls({
  active,
  api,
  actorId,
  canWrite,
  canReview,
  disabled,
  onChange,
}: {
  active: Detail;
  api: ReturnType<typeof snApi>;
  actorId: string;
  canWrite: boolean;
  canReview: boolean;
  disabled: boolean;
  onChange: (review: BatchReview) => void;
}) {
  const [form] = Form.useForm<ReviewValues>();
  const decision = Form.useWatch("decision", form);
  const [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const review = active.review;
  const isReview = review?.state === "pending";
  if (!canWrite || !active.batchRevision || active.status === "retired" ||
      review?.state === "blocked" || review?.state === "approved" ||
      (isReview && (!canReview || review.requestedBy === actorId))) return null;
  const receiptRequired = decision === "approve" || decision === "received";
  const usageRequired = decision === "approve" || decision === "used" || decision === "physically-used";
  const openModal = () => {
    form.resetFields();
    setError("");
    setOpen(true);
  };
  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    let values: ReviewValues;
    try {
      values = await form.validateFields();
    } catch {
      submitting.current = false;
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        decision: values.decision === "physically-used" ? "used" : values.decision,
        reason: values.reason,
      };
      if ((values.decision === "approve" || values.decision === "received") && values.receipt) body.receipt = {
        ...values.receipt,
        checkedAt: values.receipt.checkedAt.toISOString(),
        from: values.receipt.from.format("YYYY-MM-DD"),
        to: (values.receipt.to || values.receipt.from).format("YYYY-MM-DD"),
      };
      if (values.decision === "physically-used" && values.usage) body.usage = {
        usageSource: "physical",
        physicalReference: values.usage.confirmedUseReference,
        checkedAt: values.usage.checkedAt.toISOString(),
      };
      else if ((values.decision === "approve" || values.decision === "used") && values.usage) body.usage = {
        ...values.usage,
        checkedAt: values.usage.checkedAt.toISOString(),
        ...(values.decision === "used" ? { usageSource: "wms", wmsState: "used" } : {}),
      };
      const result = isReview
        ? await api.decideReversion(active.id, review.id, body)
        : await api.requestReversion(active.id, active.batchRevision!, values.reason);
      onChange(result);
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  const labels = [
    ["company", "ECOUNT 公司"],
    ["warehouses", "查詢倉庫"],
    ["purchaseSource", "採購來源單號"],
    ["itemCode", "ECOUNT 品號"],
    ["bindingReference", "批次與採購來源對照紀錄"],
    ["reportReference", "進貨查詢結果紀錄"],
  ];
  return (
    <>
      <Button onClick={openModal} disabled={disabled}>
        {isReview ? "覆核退回" : "申請退回草稿"}
      </Button>
      <Modal
        title={isReview ? "覆核退回" : "申請退回草稿"}
        open={open}
        onCancel={() => { if (!saving) setOpen(false); }}
        onOk={() => void submit()}
        okText={isReview ? "提交覆核" : "送出申請"}
        cancelText="取消"
        confirmLoading={saving}
        styles={{ body: { maxHeight: "65vh", overflowY: "auto" } }}
        forceRender
      >
        <p>{active.data.name} · {active.cartons} 箱 · {active.data.quantity} 件</p>
        {isReview && <p>申請原因：{review.reason}</p>}
        {error && <Alert type="error" message={error} showIcon />}
        <Form form={form} layout="vertical" disabled={saving} preserve={false}>
          {isReview && (
            <Form.Item name="decision" label="覆核結果" rules={required}>
              <Select options={[
                { value: "approve", label: "核准退回" },
                { value: "received", label: "已有 ECOUNT 進貨紀錄" },
                { value: "used", label: "已有 WMS 使用紀錄" },
                { value: "physically-used", label: "已有實物使用紀錄" },
                { value: "reject", label: "駁回申請" },
              ]} />
            </Form.Item>
          )}
          <Form.Item name="reason" label={isReview ? "覆核說明" : "退回原因"} rules={required}>
            <Input.TextArea rows={2} maxLength={400} />
          </Form.Item>
          {isReview && receiptRequired && (
            <>
              <h3>ECOUNT 進貨人工查證</h3>
              {labels.map(([name, label]) => (
                <Form.Item key={name} name={["receipt", name]} label={label} rules={required}>
                  <Input maxLength={200} />
                </Form.Item>
              ))}
              <Form.Item
                key={decision}
                name={["receipt", "from"]}
                label={decision === "approve" ? "查詢起日（涵蓋最早採購日）" : "進貨日期"}
                rules={required}
              >
                <DatePicker />
              </Form.Item>
              {decision === "approve" && (
                <Form.Item
                  name={["receipt", "to"]}
                  label="查詢迄日"
                  initialValue={dayjs(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))}
                  rules={required}
                >
                  <DatePicker />
                </Form.Item>
              )}
              <Form.Item name={["receipt", "checkedAt"]} label="ECOUNT 查詢時間" rules={required}>
                <DatePicker showTime />
              </Form.Item>
              <Form.Item name={["receipt", "receivedQuantity"]} label="ECOUNT 已收數量" rules={required}>
                <InputNumber min={0} />
              </Form.Item>
              {decision === "received" && (
                <Form.Item name={["receipt", "receiptReference"]} label="已入庫進貨單號" rules={required}>
                  <Input maxLength={200} />
                </Form.Item>
              )}
              {decision === "approve" && (
                <Form.Item name={["receipt", "fullScope"]} valuePropName="checked">
                  <Checkbox>查詢包含本批所有關聯採購及倉庫</Checkbox>
                </Form.Item>
              )}
            </>
          )}
          {isReview && usageRequired && (
            <>
              <h3>使用查證</h3>
              {decision === "approve" && (
                <Form.Item name={["usage", "wmsState"]} label="WMS 核對結果" rules={required}>
                  <Select options={[
                    { value: "not-found", label: "無匯入或使用紀錄" },
                    { value: "draft-cleared", label: "未使用，WMS 草稿箱已作廢" },
                  ]} />
                </Form.Item>
              )}
              {decision === "physically-used" ? (
                <Form.Item name={["usage", "confirmedUseReference"]} label="實物使用紀錄" rules={required}>
                  <Input maxLength={200} />
                </Form.Item>
              ) : (
                <Form.Item name={["usage", "wmsReference"]} label="WMS 箱號核對紀錄" rules={required}>
                  <Input maxLength={200} />
                </Form.Item>
              )}
              <Form.Item name={["usage", "checkedAt"]} label={decision === "physically-used" ? "實物核對時間" : "WMS 核對時間"} rules={required}>
                <DatePicker showTime />
              </Form.Item>
              {decision === "approve" && (
                <>
                  <Form.Item name={["usage", "labelsState"]} label="貼紙與匯出檔" rules={required}>
                    <Select options={[
                      { value: "not-issued", label: "未發出" },
                      { value: "verified-unused", label: "已確認未使用／已收回或作廢" },
                    ]} />
                  </Form.Item>
                  <Form.Item name={["usage", "physicalReference"]} label="貼紙與匯出檔處理紀錄" rules={required}>
                    <Input maxLength={200} />
                  </Form.Item>
                  <Form.Item name={["usage", "holdConfirmed"]} valuePropName="checked">
                    <Checkbox>確認本批未使用，覆核期間已暫停收貨及使用</Checkbox>
                  </Form.Item>
                  <p>退回後原箱號及 SN 留存，新草稿不沿用舊號。</p>
                </>
              )}
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
