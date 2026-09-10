import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
} from "antd";
import dayjs from "dayjs";
import api from "../services/api";
import WarehouseDispatch from "./WarehouseDispatch";
import { useAuth } from "../contexts/AuthContext";
import { hasPermission } from "../utils/access";
type Options = {
  channels: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  products: { id: string; name: string; sku: string; salesPrice?: number }[];
};
export default function SalesOrderCreate({
  entityId,
  onClose,
  onCreated,
}: {
  entityId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user } = useAuth(),
    [form] = Form.useForm(),
    [options, setOptions] = useState<Options | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState("");
  const flight = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    api
      .get<Options>("/sales/order-options", {
        params: { entityId },
        signal: abort.signal,
      })
      .then((r) => {
        if (!abort.signal.aborted) setOptions(r.data);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("無法載入此公司的訂單選項");
      });
    return () => abort.abort();
  }, [entityId]);
  async function save(values: {
    externalOrderId: string;
    channelId: string;
    customerId?: string;
    orderDate: dayjs.Dayjs;
    items: { productId: string; qty: number; unitPrice: number }[];
  }) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ id: string }>("/sales/orders", {
        ...values,
        externalOrderId: values.externalOrderId.trim(),
        entityId,
        orderDate: values.orderDate.toISOString(),
        currency: "TWD",
        fxRate: 1,
      });
      setCreated(r.data.id);
      onCreated();
    } catch (e) {
      const res = (
        e as { response?: { status: number; data?: { message?: string } } }
      ).response;
      setError(
        res && res.status < 500
          ? res.data?.message || "訂單內容或權限不符"
          : "建立結果尚未確認。請先用原訂單編號查詢，不要改編號重建。",
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={created ? "訂單已建立" : "新增業務訂單"}
      open
      onCancel={() => {
        if (!busy) onClose();
      }}
      footer={null}
      width={800}
      maskClosable={!busy}
      closable={!busy}
    >
      {error && <Alert type="warning" message={error} />}
      {created ? (
        <>
          {hasPermission(user, "wms_tasks:read") &&
          hasPermission(user, "wms_orders:create") ? (
            <WarehouseDispatch
              entityId={entityId}
              orderId={created}
              onDispatched={onCreated}
            />
          ) : (
            <Alert type="success" message="訂單已保存，待調度人員拋轉" />
          )}
          <Button onClick={onClose}>完成</Button>
        </>
      ) : (
        <Form
          form={form}
          layout="vertical"
          onFinish={save}
          initialValues={{
            orderDate: dayjs(),
            items: [{ qty: 1, unitPrice: 0 }],
          }}
          disabled={busy || !options}
        >
          <Space align="start" wrap>
            <Form.Item
              name="externalOrderId"
              label="訂單編號"
              rules={[{ required: true, whitespace: true, max: 200 }]}
            >
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="channelId"
              label="銷售通路"
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 180 }}
                options={options?.channels.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="orderDate"
              label="訂單日期"
              rules={[{ required: true }]}
            >
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.Item name="customerId" label="客戶">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={options?.customers.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
            />
          </Form.Item>
          <Form.List
            name="items"
            rules={[
              {
                validator: async (_, v) => {
                  if (!v?.length) throw Error("請新增品項");
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="start" wrap>
                    <Form.Item
                      name={[field.name, "productId"]}
                      label="商品"
                      rules={[{ required: true }]}
                    >
                      <Select
                        aria-label={`商品 ${field.name + 1}`}
                        style={{ width: 300 }}
                        showSearch
                        optionFilterProp="label"
                        options={options?.products.map((p) => ({
                          value: p.id,
                          label: `${p.sku} · ${p.name}`,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "qty"]}
                      label="數量"
                      rules={[{ required: true, type: "number", min: 1 }]}
                    >
                      <InputNumber min={1} precision={0} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "unitPrice"]}
                      label="單價（TWD）"
                      rules={[{ required: true, type: "number", min: 0 }]}
                    >
                      <InputNumber min={0} precision={2} />
                    </Form.Item>
                    <Button
                      style={{ marginTop: 30 }}
                      onClick={() => remove(field.name)}
                    >
                      移除
                    </Button>
                  </Space>
                ))}
                <Form.ErrorList errors={errors} />
                <Button
                  disabled={fields.length >= 1000}
                  onClick={() => add({ qty: 1, unitPrice: 0 })}
                >
                  新增品項
                </Button>
              </>
            )}
          </Form.List>
          <div style={{ marginTop: 24, textAlign: "right" }}>
            <Button type="primary" htmlType="submit" loading={busy}>
              建立訂單
            </Button>
          </div>
        </Form>
      )}
    </Modal>
  );
}
