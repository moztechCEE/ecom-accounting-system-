import { useRef, useState } from "react";
import { Alert, Button, Form, Input, Modal } from "antd";
import { errorText } from "./api";
import type { BatchReview, Detail, snApi } from "./api";

export default function BatchReviewControls({
  active,
  api,
  canWrite,
  disabled,
  initialOpen,
  onChange,
}: {
  active: Detail;
  api: ReturnType<typeof snApi>;
  canWrite: boolean;
  disabled: boolean;
  initialOpen: boolean;
  onChange: (review: BatchReview) => void;
}) {
  const [form] = Form.useForm<{ reason: string }>();
  const [open, setOpen] = useState(initialOpen),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  if (!canWrite || !active.batchRevision || active.status === "retired") return null;
  const received = active.receivingStatus === "received";
  const openModal = () => {
    form.resetFields();
    setError("");
    setOpen(true);
  };
  const submit = async () => {
    if (submitting.current || received) return;
    submitting.current = true;
    let values: { reason: string };
    try {
      values = await form.validateFields();
    } catch {
      submitting.current = false;
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await api.requestReversion(active.id, active.batchRevision!, values.reason.trim());
      if (result.state !== "approved") throw new Error("退回尚未完成，請重新載入批次");
      onChange(result);
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return (
    <>
      <Button onClick={openModal} disabled={disabled || received}>
        {received ? "已入庫，不可退回" : "退回修改"}
      </Button>
      <Modal
        title="退回修改"
        open={open && !received}
        onCancel={() => { if (!saving) setOpen(false); }}
        onOk={() => void submit()}
        okText="確認退回"
        cancelText="取消"
        confirmLoading={saving}
        forceRender
      >
        <p>{active.data.name} · {active.cartons} 箱 · {active.data.quantity} 件</p>
        {active.receivingStatus === "unconfirmed" && <p>入庫狀態待確認</p>}
        {error && <Alert type="error" message={error} showIcon />}
        <Form form={form} layout="vertical" disabled={saving}
          initialValues={{ reason: active.review?.state === "pending" ? active.review.reason : "" }}>
          <Form.Item name="reason" label="退回原因"
            rules={[{ required: true, whitespace: true, message: "請填寫退回原因" }]}>
            <Input.TextArea rows={3} maxLength={400} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
