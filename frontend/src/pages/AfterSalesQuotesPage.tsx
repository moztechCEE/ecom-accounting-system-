import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useAuth } from "../contexts/AuthContext";
import { hasPermission } from "../utils/access";
import { useEntityContext } from "../hooks/useEntityContext";
import {
  afterSalesWorkbench,
  type WorkbenchCase,
} from "../services/after-sales-workbench.service";
import {
  preparation,
  preparationError,
  type Brand,
  type CustomerQuote,
  type QuoteDraft,
  type QuoteLine,
} from "../services/after-sales-preparation.service";
import "./AfterSalesPreparation.css";

function QuotePreview({ value }: { value: CustomerQuote }) {
  return (
    <article className="prep-preview">
      <h2>{value.brandName}</h2>
      <Typography.Text>維修報價 · {value.caseNumber}</Typography.Text>
      <table>
        <thead>
          <tr>
            <th>項目</th>
            <th>數量</th>
            <th>單價</th>
          </tr>
        </thead>
        <tbody>
          {value.lines.map((line, index) => (
            <tr key={index}>
              <td>{line.description}</td>
              <td>{line.quantity}</td>
              <td>{line.unitPrice}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="prep-total">
        <span>報價金額 {value.currency}</span>
        <strong>{value.total}</strong>
      </div>
      {value.customerNote && <p>{value.customerNote}</p>}
    </article>
  );
}
export default function AfterSalesQuotesPage() {
  const entityId = useEntityContext();
  return entityId ? (
    <QuoteWorkspace key={entityId} entityId={entityId} />
  ) : (
    <Alert type="error" message="請先選擇公司" />
  );
}
type Values = {
  sourceCaseId: string;
  brandCode: string;
  lines: QuoteLine[];
  customerNote: string;
};
function QuoteWorkspace({ entityId }: { entityId: string }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [drafts, setDrafts] = useState<QuoteDraft[]>([]);
  const [cases, setCases] = useState<WorkbenchCase[]>([]);
  const [caseQuery, setCaseQuery] = useState("");
  const [error, setError] = useState("");
  const [caseError, setCaseError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CustomerQuote>();
  const [form] = Form.useForm<Values>();
  const brandCode = Form.useWatch("brandCode", form);
  const selectedCaseId = Form.useWatch("sourceCaseId", form);
  const [binding, setBinding] = useState<{
    sourceCaseId: string;
    brandCode: string | null;
    error?: string;
  }>();
  const currentBinding =
    binding?.sourceCaseId === selectedCaseId ? binding : undefined;
  const brand = brands.find((item) => item.code === brandCode);
  const lines = Form.useWatch("lines", form) || [];
  const request = useRef<{ payload: string; key: string } | undefined>(
    undefined,
  );
  const canCreate = hasPermission(user, "after_sales_cases:create");
  const editing = params.get("new") === "1";
  const sourceId = params.get("sourceCase") || "";
  const [sourceOption, setSourceOption] = useState<{
    value: string;
    label: string;
  }>();
  useEffect(() => {
    if (!selectedCaseId) return;
    const controller = new AbortController();
    preparation
      .caseBrand(entityId, selectedCaseId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setBinding(result);
          form.setFieldValue("brandCode", result.brandCode || undefined);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setBinding({
            sourceCaseId: selectedCaseId,
            brandCode: null,
            error: preparationError(error),
          });
      });
    return () => controller.abort();
  }, [entityId, selectedCaseId, form]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      preparation.brands(entityId, controller.signal),
      preparation.drafts(entityId, controller.signal),
    ])
      .then(([b, d]) => {
        if (!controller.signal.aborted) {
          setBrands(b);
          setDrafts(d);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(preparationError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [entityId, refresh]);
  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      afterSalesWorkbench
        .list(
          entityId,
          {
            page: 1,
            pageSize: 50,
            view: "active",
            type: "REPAIR",
            search: caseQuery || undefined,
          },
          controller.signal,
        )
        .then((result) => {
          setCases(result.items);
          setCaseError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setCaseError(preparationError(e));
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [entityId, editing, caseQuery]);
  useEffect(() => {
    if (!sourceId || !editing) return;
    const controller = new AbortController();
    afterSalesWorkbench
      .detail(entityId, sourceId, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setSourceOption({ value: detail.id, label: detail.caseNumber });
        form.setFieldValue("sourceCaseId", detail.id);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setCaseError(preparationError(e));
      });
    return () => controller.abort();
  }, [entityId, sourceId, editing, form]);
  const total =
    lines.reduce(
      (sum: number, line: QuoteLine) =>
        sum +
        Math.round(Number(line?.unitPrice || 0) * 100) *
          Number(line?.quantity || 0),
      0,
    ) / 100;
  const begin = () => {
    form.resetFields();
    setSourceOption(undefined);
    request.current = undefined;
    setParams({ new: "1" });
  };
  const save = async (values: Values) => {
    if (!brand || !canCreate || !currentBinding || currentBinding.error) return;
    const data = {
      ...values,
      customerNote: values.customerNote || "",
      brandVersion: brand.version,
      lines: values.lines.map((line) => ({
        ...line,
        unitPrice: String(line.unitPrice),
      })),
    };
    const payload = JSON.stringify(data);
    if (request.current?.payload !== payload)
      request.current = { payload, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const draft = await preparation.saveDraft(
        entityId,
        request.current.key,
        data,
      );
      message.success("報價草稿已儲存，尚未通知顧客");
      setPreview(draft.customerPreview);
      setParams({});
      setRefresh((value) => value + 1);
    } catch (e) {
      message.error(preparationError(e));
    } finally {
      setBusy(false);
    }
  };
  const options = cases.map((item) => ({
    value: item.id,
    label: item.caseNumber + " · " + (item.contactName || ""),
  }));
  if (
    sourceOption &&
    !options.some((item) => item.value === sourceOption.value)
  )
    options.unshift(sourceOption);
  return (
    <section className="after-sales-preparation">
      <header className="prep-heading">
        <Typography.Title level={2}>
          {editing ? "新增案件報價" : "案件報價"}
        </Typography.Title>
        {!editing && canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={begin}>
            新增報價
          </Button>
        )}
        {editing && (
          <Button onClick={() => setParams({})} disabled={busy}>
            返回報價清單
          </Button>
        )}
      </header>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button onClick={() => setRefresh((value) => value + 1)}>
              重試
            </Button>
          }
        />
      )}
      {editing && !canCreate ? (
        <Alert type="warning" message="目前帳號沒有建立售後報價的權限" />
      ) : editing ? (
        <div className="prep-layout">
          <div className="prep-panel">
            <Form
              form={form}
              layout="vertical"
              onFinish={save}
              initialValues={{
                sourceCaseId: sourceId || undefined,
                lines: [{ description: "", quantity: 1, unitPrice: "0.00" }],
                customerNote: "",
              }}
            >
              <div className="prep-form-grid">
                <Form.Item
                  name="sourceCaseId"
                  label="維修案件"
                  rules={[{ required: true, message: "請選擇案件" }]}
                >
                  <Select
                    showSearch
                    filterOption={false}
                    onSearch={setCaseQuery}
                    options={options}
                    placeholder="搜尋案件編號、姓名或電話"
                    onChange={(value) => {
                      const bound = drafts.find(
                        (d) => d.sourceCaseId === value,
                      );
                      form.setFieldValue("brandCode", bound?.brandCode);
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="brandCode"
                  label="品牌"
                  rules={[{ required: true, message: "請選擇品牌" }]}
                >
                  <Select
                    loading={
                      loading || Boolean(selectedCaseId && !currentBinding)
                    }
                    disabled={Boolean(currentBinding?.brandCode)}
                    options={brands
                      .filter((item) => item.active)
                      .map((item) => ({ value: item.code, label: item.name }))}
                    placeholder="選擇案件品牌"
                  />
                </Form.Item>
              </div>
              {caseError && <Alert type="error" message={caseError} />}
              {currentBinding?.error && (
                <Alert type="error" message={currentBinding.error} />
              )}
              {!loading && !error && !brands.some((item) => item.active) && (
                <Alert type="warning" message="請管理員先新增可使用的品牌" />
              )}
              <Typography.Title level={5}>報價項目</Typography.Title>
              <Form.List name="lines">
                {(fields, { add, remove }) => (
                  <>
                    <div className="prep-lines">
                      <span>項目</span>
                      <span>數量</span>
                      <span>單價 TWD</span>
                      <span />
                    </div>
                    {fields.map((field) => (
                      <div className="prep-lines" key={field.key}>
                        <Form.Item
                          name={[field.name, "description"]}
                          rules={[
                            {
                              required: true,
                              whitespace: true,
                              message: "請填項目",
                            },
                          ]}
                        >
                          <Input
                            aria-label={"報價項目 " + (field.name + 1)}
                            maxLength={200}
                          />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, "quantity"]}
                          rules={[
                            {
                              required: true,
                              type: "integer",
                              min: 1,
                              max: 1000,
                            },
                          ]}
                        >
                          <InputNumber
                            aria-label={"數量 " + (field.name + 1)}
                            min={1}
                            max={1000}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, "unitPrice"]}
                          rules={[
                            { required: true },
                            {
                              pattern: /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/,
                              message: "最多兩位小數",
                            },
                          ]}
                        >
                          <Input
                            aria-label={"單價 " + (field.name + 1)}
                            inputMode="decimal"
                            maxLength={11}
                          />
                        </Form.Item>
                        <Button
                          type="text"
                          aria-label={"移除項目 " + (field.name + 1)}
                          icon={<DeleteOutlined />}
                          disabled={fields.length === 1}
                          onClick={() => remove(field.name)}
                        />
                      </div>
                    ))}
                    <Button
                      icon={<PlusOutlined />}
                      disabled={fields.length >= 50}
                      onClick={() =>
                        add({ description: "", quantity: 1, unitPrice: "0.00" })
                      }
                    >
                      新增項目
                    </Button>
                  </>
                )}
              </Form.List>
              <div className="prep-total">
                <span>報價金額 TWD</span>
                <strong>
                  {Number.isFinite(total)
                    ? total.toLocaleString("zh-TW", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </strong>
              </div>
              <Form.Item
                name="customerNote"
                label="顧客備註"
                style={{ marginTop: 24 }}
              >
                <Input.TextArea rows={3} maxLength={1000} />
              </Form.Item>
              <Space wrap>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={busy}
                  disabled={
                    loading ||
                    Boolean(error) ||
                    !brand?.active ||
                    !currentBinding ||
                    Boolean(currentBinding.error)
                  }
                >
                  儲存報價草稿
                </Button>
                <Button
                  disabled={
                    !brand?.active ||
                    !currentBinding ||
                    Boolean(currentBinding.error)
                  }
                  onClick={async () => {
                    try {
                      const v = await form.validateFields();
                      setPreview({
                        brandName: brand!.name,
                        caseNumber:
                          options
                            .find((item) => item.value === v.sourceCaseId)
                            ?.label.split(" · ")[0] || v.sourceCaseId,
                        currency: "TWD",
                        lines: v.lines,
                        total: total.toFixed(2),
                        customerNote: v.customerNote || "",
                      });
                    } catch {
                      /* Form shows field errors. */
                    }
                  }}
                >
                  顧客版預覽
                </Button>
              </Space>
            </Form>
          </div>
          <aside className="prep-sidebar">
            <div className="prep-panel">
              <Typography.Title level={5}>品牌設定</Typography.Title>
              {brand ? (
                <Descriptions
                  column={1}
                  size="small"
                  items={[
                    { key: "brand", label: "品牌", children: brand.name },
                    {
                      key: "line",
                      label: "LINE",
                      children: brand.lineOfficialId || "未設定",
                    },
                    {
                      key: "invoice",
                      label: "開票公司",
                      children: brand.invoiceLegalName || "待指定",
                    },
                    {
                      key: "taxId",
                      label: "統編",
                      children: brand.invoiceTaxId || "待核對",
                    },
                  ]}
                />
              ) : (
                <Typography.Text type="secondary">
                  選擇品牌後自動帶入
                </Typography.Text>
              )}
            </div>
            <Alert
              type="info"
              showIcon
              message="草稿模式"
              description="不發送 LINE、不開票，也不變更原案件狀態。"
            />
          </aside>
        </div>
      ) : (
        <div className="prep-panel">
          <Table
            rowKey="id"
            loading={loading}
            dataSource={error ? [] : drafts}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 740 }}
            locale={{ emptyText: <Empty description="尚無報價草稿" /> }}
            columns={[
              { title: "案件", dataIndex: "sourceCaseNumber" },
              { title: "品牌", render: (_, row) => row.brandSnapshot.name },
              {
                title: "金額 TWD",
                render: (_, row) => row.customerPreview.total,
              },
              { title: "狀態", render: () => <Tag>草稿 · 未發送</Tag> },
              {
                title: "建立時間",
                dataIndex: "createdAt",
                render: (value) => new Date(value).toLocaleString("zh-TW"),
              },
              {
                title: "操作",
                render: (_, row) => (
                  <Space>
                    <Button onClick={() => setPreview(row.customerPreview)}>
                      顧客版預覽
                    </Button>
                    {canCreate && (
                      <Button
                        onClick={() => {
                          request.current = undefined;
                          form.setFieldsValue({
                            sourceCaseId: row.sourceCaseId,
                            brandCode: row.brandCode,
                            lines: row.customerPreview.lines.map((line) => ({
                              ...line,
                            })),
                            customerNote: row.customerPreview.customerNote,
                          });
                          setParams({ new: "1", sourceCase: row.sourceCaseId });
                        }}
                      >
                        建立新版
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          <Typography.Text type="secondary">最近 100 份草稿</Typography.Text>
        </div>
      )}
      <Modal
        title="顧客版預覽（未發送）"
        open={Boolean(preview)}
        onCancel={() => setPreview(undefined)}
        footer={<Button onClick={() => setPreview(undefined)}>關閉</Button>}
        width={680}
      >
        {preview && <QuotePreview value={preview} />}
      </Modal>
    </section>
  );
}
