import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Checkbox,
  Descriptions,
  Form,
  Input,
  Modal,
} from "antd";
import axios from "axios";
import { API_URL } from "../../services/api";
import { errorText, type Item } from "./model";

// Credential errors belong to this handoff; they must not trigger global logout.
const tabletApi = axios.create({ baseURL: API_URL, timeout: 30000 });

export default function TabletAcceptance({
  open,
  item,
  entityId,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: Item;
  entityId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    form.resetFields();
    setFailure("");
    if (open) requestId.current = crypto.randomUUID();
    return () => form.resetFields();
  }, [open, item.id, item.version, form]);
  function close() {
    if (busy) return;
    form.resetFields();
    setFailure("");
    onClose();
  }
  async function accept() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      setFailure("");
      await tabletApi.post(
        "/mailroom/tablet/items/" + encodeURIComponent(item.id) + "/accept",
        {
          entityId,
          requestId: requestId.current,
          expectedVersion: item.version,
          employeeNo: values.employeeNo.trim(),
          password: values.password,
          ...(values.twoFactorToken
            ? { twoFactorToken: values.twoFactorToken }
            : {}),
          confirmedItems: values.confirmedItems === true,
          location: values.location,
        },
        {
          headers: {
            Authorization:
              "Bearer " + (localStorage.getItem("access_token") || ""),
          },
        },
      );
      form.resetFields();
      onClose();
      await onSaved();
    } catch (error) {
      if (!(error as { errorFields?: unknown }).errorFields)
        setFailure(errorText(error));
    } finally {
      form.setFieldsValue({ password: "", twoFactorToken: undefined });
      setBusy(false);
    }
  }
  return (
    <Modal
      className="mailroom-tablet-modal"
      title="維修人員本人簽收"
      open={open}
      width={640}
      onCancel={close}
      onOk={() => void accept()}
      okText="確認簽收"
      cancelText="返回收發室"
      confirmLoading={busy}
      cancelButtonProps={{ disabled: busy }}
      closable={!busy}
      maskClosable={!busy}
      destroyOnHidden
    >
      <Descriptions
        column={1}
        size="small"
        bordered
        items={[
          {
            key: "case",
            label: "售後案件",
            children: item.receipt.sourceNumber || item.receipt.number,
          },
          {
            key: "item",
            label: "本次實物",
            children: `${item.productName} · ${item.label}`,
          },
          {
            key: "sku",
            label: "SKU／SN",
            children: `${item.sku || "未提供 SKU"}／${item.serialNumber || "未提供 SN"}`,
          },
          {
            key: "assignee",
            label: "指定接收人",
            children: item.nextUserName || "尚未指定，請返回指派接收人",
          },
        ]}
      />
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
        preserve={false}
        style={{ marginTop: 20 }}
      >
        <Form.Item
          name="employeeNo"
          label="維修人員員工編號"
          rules={[
            { required: true, whitespace: true, message: "請填寫本人員工編號" },
          ]}
        >
          <Input autoComplete="off" maxLength={100} />
        </Form.Item>
        <Form.Item
          name="password"
          label="本人登入密碼"
          rules={[{ required: true, message: "請由維修人員輸入本人密碼" }]}
        >
          <Input.Password autoComplete="new-password" maxLength={200} />
        </Form.Item>
        <Form.Item
          name="twoFactorToken"
          label="兩步驟驗證碼"
          rules={[{ pattern: /^\d{6}$/, message: "請填寫六位數驗證碼" }]}
        >
          <Input autoComplete="off" inputMode="numeric" maxLength={6} />
        </Form.Item>
        <Form.Item
          name="location"
          label="簽收後存放位置"
          rules={[
            {
              required: true,
              whitespace: true,
              message: "請填寫簽收後存放位置",
            },
          ]}
        >
          <Input maxLength={160} placeholder="例如：維修部 · 檢測區 A" />
        </Form.Item>
        <Form.Item
          name="confirmedItems"
          valuePropName="checked"
          rules={[
            {
              validator: (_, value) =>
                value === true
                  ? Promise.resolve()
                  : Promise.reject(new Error("請先核對本次實物並勾選確認")),
            },
          ]}
        >
          <Checkbox>我已核對上述物件，並由本人接收保管</Checkbox>
        </Form.Item>
      </Form>
      {failure ? <Alert type="error" showIcon message={failure} /> : null}
    </Modal>
  );
}
