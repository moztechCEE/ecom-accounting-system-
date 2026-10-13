import OperationsCompanySelector from "../components/OperationsCompanySelector";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  message,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useEntityContext } from "../hooks/useEntityContext";
import {
  adminError,
  operationsAdmin,
  type Connection,
  type IntegrationSummary,
} from "../services/operations-admin.service";
import { useAuth } from "../contexts/AuthContext";
import { hasAnyPermission, isAdminUser } from "../utils/access";
const labels: Record<string, string> = {
  LINE: "LINE",
  COMMERCE: "商城與 API",
  ADS: "廣告",
  INVOICE: "發票",
  AFTER_SALES: "售後連線",
};
const providers: Record<string, string[]> = {
  LINE: ["LINE"],
  COMMERCE: ["SHOPIFY", "SHOPLINE", "ONESHOP"],
  ADS: ["META", "GOOGLE_ADS", "GA4"],
  INVOICE: ["ECPAY"],
  AFTER_SALES: ["AFTER_SALES"],
};
const status: Record<string, string> = {
  VERIFIED: "驗證通過",
  UNVERIFIED: "待驗證",
  FAILED: "驗證失敗",
};
const codes: Record<string, string> = {
  DEV_STUB: "DEV 測試",
  CONFIGURED_NOT_VERIFIED: "已配置，待驗證",
  PROVIDER_NOT_CONFIGURED: "尚未配置",
  RUNTIME_MAPPING_MISMATCH: "帳號對應待確認",
  DEV_EXTERNAL_PROBE_DISABLED: "DEV 外部驗證未啟用",
  READ_ONLY_PROBE_NOT_AVAILABLE: "連線驗證待串接",
  READ_ONLY_PROBE_FAILED: "連線驗證失敗",
  CONTRACT_VERIFIED: "售後連線通過",
  READ_ONLY_PROBE_OK: "連線驗證通過",
};
export default function IntegrationSettingsPage() {
  const navigate = useNavigate();
  const entityId = useEntityContext();
  const { user } = useAuth();
  const [result, setResult] = useState<{
    entityId: string;
    data: IntegrationSummary;
  }>();
  const [error, setError] = useState("");
  const [tab, setTab] = useState("LINE");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Partial<Connection>>();
  const [form] = Form.useForm();
  useEffect(() => {
    setEdit(undefined);
  }, [entityId]);
  const current = result?.entityId === entityId ? result.data : undefined;
  const canEdit =
    isAdminUser(user) ||
    hasAnyPermission(user, [
      "integration_settings:update",
      "after_sales_settings:update",
    ]);
  useEffect(() => {
    if (!entityId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    operationsAdmin
      .integrations(entityId, controller.signal)
      .then((data) => {
        setResult({ entityId, data });
        if (!data.categories.includes(tab))
          setTab(data.categories[0] || "LINE");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(adminError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [entityId, refresh]);
  const open = (row?: Connection) => {
    const initial = row || {
      category: tab,
      provider: providers[tab][0],
      environment: window.__APP_CONFIG__?.devEnvironment ? "DEV" : "PRODUCTION",
      brand: tab === "LINE" ? "MOZTECH" : "",
      version: 0,
      enabled: true,
    };
    setEdit(initial);
    form.setFieldsValue(initial);
  };
  const save = async () => {
    try {
      const values = await form.validateFields();
      setBusy(true);
      await operationsAdmin.save(entityId, {
        id: edit?.id,
        category: edit?.category,
        version: edit?.version,
        ...values,
        metadata: values.metadata || {},
      });
      setEdit(undefined);
      setRefresh((value) => value + 1);
      message.success("串接設定已儲存");
    } catch (error) {
      if (!(error as any)?.errorFields) message.error(adminError(error));
    } finally {
      setBusy(false);
    }
  };
  const verify = async (row: Connection) => {
    setBusy(true);
    try {
      const result = await operationsAdmin.verify(entityId, row);
      message.info(codes[result.code] || "驗證已完成");
      setRefresh((value) => value + 1);
    } catch (error) {
      message.error(adminError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="operations-admin-page" style={{ padding: 24 }}>
      <Space
        wrap
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <Space wrap>
          <h1 style={{ margin: 0 }}>串接設定</h1>
          <OperationsCompanySelector entityId={entityId} />
        </Space>
        <Space>
          <Button
            data-operation-action="integration_settings.refresh"
            icon={<ReloadOutlined />}
            onClick={() => setRefresh((value) => value + 1)}
          >
            更新
          </Button>
          {canEdit &&
            (current?.canManage || ["LINE", "AFTER_SALES"].includes(tab)) && (
              <Button
                data-operation-action="integration_settings.create"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => open()}
              >
                新增串接
              </Button>
            )}
        </Space>
      </Space>
      {error && <Alert type="error" message={error} showIcon />}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={(current?.categories || Object.keys(labels)).map((key) => ({
          key,
          label: labels[key],
        }))}
      />
      {tab === "AFTER_SALES" && (
        <Button
          data-operation-action="integration_settings.source_preferences"
          style={{ marginBottom: 16 }}
          onClick={() =>
            navigate(
              "/operations/after-sales/settings/advanced?entityId=" +
                encodeURIComponent(entityId),
            )
          }
        >
          案件來源與通知模板
        </Button>
      )}
      <Table<Connection>
        loading={loading}
        rowKey="id"
        dataSource={
          current?.connections.filter((row) => row.category === tab) || []
        }
        pagination={false}
        scroll={{ x: 760 }}
        columns={[
          {
            title: "帳號",
            dataIndex: "displayName",
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <strong>{row.displayName}</strong>
                <span>
                  {row.provider} · {row.accountId}
                </span>
              </Space>
            ),
          },
          {
            title: "品牌",
            dataIndex: "brand",
            render: (value) => value || "共用",
          },
          {
            title: "環境",
            dataIndex: "environment",
            render: (value) => <Tag>{value}</Tag>,
          },
          {
            title: "狀態",
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <Tag
                  color={
                    row.verificationStatus === "VERIFIED"
                      ? "green"
                      : row.verificationStatus === "FAILED"
                        ? "red"
                        : undefined
                  }
                >
                  {row.enabled
                    ? codes[row.verificationCode || ""] ||
                      status[row.verificationStatus]
                    : "已停用"}
                </Tag>
                {row.verifiedAt && (
                  <small>
                    {new Date(row.verifiedAt).toLocaleString("zh-TW")}
                  </small>
                )}
              </Space>
            ),
          },
          {
            title: "操作",
            render: (_, row) => (
              <Space>
                {canEdit &&
                  (current?.canManage ||
                    ["LINE", "AFTER_SALES"].includes(row.category)) && (
                    <>
                      <Button
                        data-operation-action="integration_settings.edit"
                        size="small"
                        onClick={() => open(row)}
                      >
                        編輯
                      </Button>
                      <Button
                        data-operation-action="integration_settings.verify"
                        size="small"
                        disabled={!row.enabled}
                        loading={busy}
                        onClick={() => verify(row)}
                      >
                        驗證連線
                      </Button>
                    </>
                  )}
              </Space>
            ),
          },
        ]}
        locale={{ emptyText: "尚無串接帳號" }}
      />
      {(tab === "LINE" || tab === "INVOICE" || tab === "AFTER_SALES") && (
        <Table
          style={{ marginTop: 24 }}
          rowKey={(row) => row.brand + "-" + row.kind}
          pagination={false}
          dataSource={
            current?.source.items.filter(
              (row) => tab === "AFTER_SALES" || row.kind === tab,
            ) || []
          }
          columns={[
            { title: "售後品牌", dataIndex: "brand" },
            {
              title: "服務",
              dataIndex: "kind",
              render: (value) => (value === "INVOICE" ? "售後發票" : "LINE"),
            },
            {
              title: "公司",
              dataIndex: "issuerName",
              render: (value) => value || "—",
            },
            {
              title: "配置狀態",
              render: (_, row) => (
                <Tag color={row.verified ? "green" : undefined}>
                  {row.devStub
                    ? "DEV 測試"
                    : row.verified
                      ? "已驗證"
                      : row.configured
                        ? "已配置，待驗證"
                        : "尚未配置"}
                </Tag>
              ),
            },
          ]}
          locale={{
            emptyText: current?.source.available
              ? "目前沒有設定"
              : "售後來源暫時無法讀取",
          }}
        />
      )}
      {tab === "INVOICE" && (
        <Table
          style={{ marginTop: 24 }}
          rowKey="key"
          pagination={false}
          dataSource={current?.invoiceProfiles || []}
          columns={[
            { title: "銷售發票帳號", dataIndex: "key" },
            { title: "環境", dataIndex: "environment" },
            {
              title: "配置狀態",
              render: (_, row) => (
                <Tag>{row.ready ? "已配置，待驗證" : "尚未配置"}</Tag>
              ),
            },
          ]}
          locale={{ emptyText: "尚無銷售發票設定" }}
        />
      )}
      <Drawer
        open={!!edit}
        title={edit?.id ? "編輯串接" : "新增串接"}
        onClose={() => setEdit(undefined)}
        width="min(480px, 100vw)"
        footer={
          <Space>
            <Button
              data-operation-action="integration_settings.cancel"
              onClick={() => setEdit(undefined)}
            >
              取消
            </Button>
            <Button
              data-operation-action="integration_settings.save"
              type="primary"
              loading={busy}
              onClick={save}
            >
              儲存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="provider" label="服務" rules={[{ required: true }]}>
            <Select
              options={providers[edit?.category || tab]?.map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="displayName"
            label="名稱"
            rules={[{ required: true }]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="brand" label="品牌">
            <Select
              options={[
                ...((edit?.category || tab) === "LINE"
                  ? []
                  : [{ value: "", label: "共用" }]),
                { value: "MOZTECH", label: "MOZTECH" },
                { value: "BONSON", label: "BONSON" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="accountId"
            label="帳號／Channel ID"
            rules={[{ required: true }]}
          >
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item
            name="environment"
            label="環境"
            rules={[{ required: true }]}
          >
            <Select
              options={["DEV", "STAGE", "PRODUCTION"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="credentialRef" label="憑證參照">
            <Input placeholder="Secret Manager resource" />
          </Form.Item>
          <Form.Item name={["metadata", "runtimeOwner"]} label="設定來源">
            <Select
              allowClear
              options={[
                { value: "ERP", label: "營運系統" },
                { value: "AFTER_SALES", label: "售後系統" },
              ]}
            />
          </Form.Item>
          {tab === "LINE" && (
            <>
              <Form.Item name={["metadata", "officialId"]} label="官方帳號">
                <Input />
              </Form.Item>
              <Form.Item
                name={["metadata", "messagingChannelId"]}
                label="Messaging Channel"
              >
                <Input />
              </Form.Item>
              <Form.Item
                name={["metadata", "loginChannelId"]}
                label="Login Channel"
              >
                <Input />
              </Form.Item>
              <Form.Item name={["metadata", "liffId"]} label="LIFF ID">
                <Input />
              </Form.Item>
            </>
          )}
          <Form.Item name="enabled" label="啟用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
