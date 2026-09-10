import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  message,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEntityContext } from "../hooks/useEntityContext";
import {
  preparation,
  preparationError,
  type Brand,
  type BrandSettings,
} from "../services/after-sales-preparation.service";
import "./AfterSalesPreparation.css";
const empty: BrandSettings = {
  code: "",
  name: "",
  active: true,
  lineOfficialId: "",
  channelId: "",
  liffId: "",
  invoiceLegalName: "",
  invoiceTaxId: "",
  invoiceMerchantLabel: "",
};
export default function AfterSalesBrandsPage() {
  const entityId = useEntityContext();
  const [result, setResult] = useState<{
    entity: string;
    rows: Brand[];
    error?: string;
  }>();
  const [refresh, setRefresh] = useState(0);
  const [edit, setEdit] = useState<{ entity: string; brand?: Brand }>();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<BrandSettings>();
  const current = result?.entity === entityId ? result : undefined;
  useEffect(() => {
    if (!entityId) return;
    const controller = new AbortController();
    preparation
      .brands(entityId, controller.signal)
      .then((rows) => setResult({ entity: entityId, rows }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            entity: entityId,
            rows: [],
            error: preparationError(error),
          });
      });
    return () => controller.abort();
  }, [entityId, refresh]);
  const open = (brand?: Brand) => {
    const {
      version: _version,
      lineStatus: _line,
      invoiceStatus: _invoice,
      ...values
    } = brand || { ...empty, version: 0, lineStatus: "", invoiceStatus: "" };
    form.setFieldsValue(values);
    setEdit({ entity: entityId, brand });
  };
  const save = async (values: BrandSettings) => {
    if (!edit || edit.entity !== entityId) return;
    setBusy(true);
    try {
      await preparation.saveBrand(entityId, edit.brand?.version || 0, values);
      message.success("品牌設定已儲存");
      setEdit(undefined);
      setRefresh((value) => value + 1);
    } catch (error) {
      message.error(preparationError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="after-sales-preparation">
      <header className="prep-heading">
        <Typography.Title level={2}>品牌與 LINE</Typography.Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!entityId}
          onClick={() => open()}
        >
          新增品牌
        </Button>
      </header>
      {!entityId ? (
        <Alert type="error" message="請先選擇公司" />
      ) : !current ? (
        <Spin />
      ) : current.error ? (
        <Alert
          type="error"
          message={current.error}
          action={
            <Button onClick={() => setRefresh((value) => value + 1)}>
              重試
            </Button>
          }
        />
      ) : (
        <div className="prep-panel">
          <Table
            rowKey="code"
            pagination={false}
            scroll={{ x: 780 }}
            dataSource={current.rows}
            locale={{ emptyText: <Empty description="尚未設定品牌" /> }}
            columns={[
              {
                title: "品牌",
                dataIndex: "name",
                render: (name, row) => (
                  <Button type="link" onClick={() => open(row)}>
                    {name}
                  </Button>
                ),
              },
              {
                title: "狀態",
                dataIndex: "active",
                render: (active) => <Tag>{active ? "使用中" : "已停用"}</Tag>,
              },
              {
                title: "LINE 帳號",
                dataIndex: "lineOfficialId",
                render: (value) => value || "未設定",
              },
              {
                title: "LINE 連線",
                render: () => <Tag color="gold">待串接</Tag>,
              },
              {
                title: "開票公司",
                dataIndex: "invoiceLegalName",
                render: (value) => value || "待指定",
              },
              { title: "開票驗證", render: () => <Tag>待核對</Tag> },
            ]}
          />
        </div>
      )}
      <Drawer
        title={edit?.brand ? edit.brand.name : "新增品牌"}
        width={560}
        open={Boolean(edit && edit.entity === entityId)}
        onClose={() => {
          if (!busy) setEdit(undefined);
        }}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={save}
          initialValues={empty}
        >
          <div className="prep-form-grid">
            <Form.Item
              name="code"
              label="品牌代號"
              rules={[
                { required: true },
                {
                  pattern: /^[A-Za-z][A-Za-z0-9_-]{1,39}$/,
                  message: "使用 2–40 碼英數字、底線或連字號",
                },
              ]}
            >
              <Input disabled={Boolean(edit?.brand)} maxLength={40} />
            </Form.Item>
            <Form.Item
              name="name"
              label="對客品牌名稱"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={80} />
            </Form.Item>
          </div>
          <Form.Item name="active" label="允許新增報價" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Typography.Title level={5}>LINE</Typography.Title>
          <Form.Item name="lineOfficialId" label="官方帳號 ID">
            <Input placeholder="@品牌帳號" maxLength={80} />
          </Form.Item>
          <div className="prep-form-grid">
            <Form.Item
              name="channelId"
              label="Messaging API Channel ID"
              rules={[{ pattern: /^\d*$/, message: "請填數字 ID" }]}
            >
              <Input maxLength={24} />
            </Form.Item>
            <Form.Item name="liffId" label="LIFF ID">
              <Input maxLength={80} />
            </Form.Item>
          </div>
          <Descriptions
            column={1}
            size="small"
            items={[
              {
                key: "secret",
                label: "Channel Secret / Token",
                children: "尚未安全綁定",
              },
              {
                key: "webhook",
                label: "Webhook",
                children: "待開通；保留原 LINE 設定",
              },
            ]}
          />
          <Typography.Title level={5} style={{ marginTop: 24 }}>
            發票
          </Typography.Title>
          <Form.Item name="invoiceLegalName" label="開票公司正式名稱">
            <Input maxLength={120} />
          </Form.Item>
          <div className="prep-form-grid">
            <Form.Item
              name="invoiceTaxId"
              label="統一編號"
              rules={[{ pattern: /^(\d{8})?$/, message: "請填 8 碼統編" }]}
            >
              <Input maxLength={8} placeholder="待核對可留空" />
            </Form.Item>
            <Form.Item name="invoiceMerchantLabel" label="綠界帳號名稱（內部）">
              <Input maxLength={120} />
            </Form.Item>
          </div>
          <Space>
            <Button onClick={() => setEdit(undefined)} disabled={busy}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              儲存設定
            </Button>
          </Space>
        </Form>
      </Drawer>
    </section>
  );
}
