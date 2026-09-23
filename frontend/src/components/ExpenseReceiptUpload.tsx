import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Space,
  Typography,
  Upload,
  message,
} from "antd";
import type { FormInstance, UploadFile } from "antd";
import { ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import {
  readReceiptFile,
  receiptRecognitionService,
  type ReceiptRecognition,
} from "../services/expense-receipt.service";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export default function ExpenseReceiptUpload({
  form,
  entityId,
  modelId,
  onRecognized,
}: {
  form: FormInstance;
  entityId: string;
  modelId?: string;
  onRecognized: (result: ReceiptRecognition | null) => void;
}) {
  const files = Form.useWatch<UploadFile[]>("files", form);
  const [result, setResult] = useState<ReceiptRecognition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const onResult = useRef(onRecognized);
  onResult.current = onRecognized;
  const previousValues = useRef<Record<string, unknown>>({});

  useEffect(() => {
    let cancelled = false;
    // A new file set must not retain untouched suggestions from an older receipt.
    const cleared: Record<string, unknown> = {};
    for (const [key, old] of Object.entries(previousValues.current)) {
      const current = form.getFieldValue(key);
      if (
        dayjs.isDayjs(current) && dayjs.isDayjs(old)
          ? current.isSame(old)
          : current === old
      )
        cleared[key] = undefined;
    }
    form.setFieldsValue(cleared);
    previousValues.current = {};
    setResult(null);
    setError("");
    form.setFieldValue("receiptConfirmed", false);
    onResult.current(null);
    if (!files?.length) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const originals = files
            .map((file) => file.originFileObj)
            .filter((file): file is NonNullable<typeof file> => Boolean(file));
          if (originals.length !== files.length)
            throw new Error("請重新選擇憑證檔案");
          if (
            originals.reduce((sum, file) => sum + file.size, 0) >
            10 * 1024 * 1024
          )
            throw new Error("憑證總大小上限 10 MB");
          const data = await receiptRecognitionService.recognize(
            entityId,
            await Promise.all(originals.map(readReceiptFile)),
            modelId,
          );
          if (cancelled) return;
          setResult(data);
          onResult.current(data);
          const fields = data.fields;
          const candidates: Record<string, unknown> = {
            description: fields.description,
            expenseDate: fields.expenseDate
              ? dayjs(fields.expenseDate)
              : undefined,
            invoiceNo: fields.invoiceNo,
            taxId: fields.sellerTaxId,
            receiptType: fields.receiptType,
            reimbursementItemId: fields.suggestedItemId,
            ...(fields.currency === "TWD"
              ? { amount: fields.amountOriginal, taxAmount: fields.taxAmount }
              : {}),
          };
          const updates: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(candidates)) {
            if (value === undefined || value === null) continue;
            const current = form.getFieldValue(key);
            // Preserve employee edits; a later recognition may only replace its own unchanged suggestions.
            const old = previousValues.current[key];
            const same =
              dayjs.isDayjs(current) && dayjs.isDayjs(old)
                ? current.isSame(old)
                : current === old;
            if (
              current === undefined ||
              current === null ||
              current === "" ||
              (key === "amount" && current === 0) ||
              same
            )
              updates[key] = value;
          }
          form.setFieldsValue(updates);
          previousValues.current = updates;
        } catch (cause) {
          if (cancelled) return;
          const failure = cause as {
            message?: string;
            response?: { data?: { message?: string } };
          };
          setError(
            failure.response?.data?.message ||
              failure.message ||
              "辨識暫時無法使用，請人工填寫",
          );
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, 650);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [files, entityId, modelId, retry, form]);

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Form.Item
        name="files"
        label="上傳憑證，自動帶入申請資料"
        valuePropName="fileList"
        rules={[
          {
            validator: (_, selected: UploadFile[] | undefined) => {
              if (
                selected &&
                (selected.length > 5 ||
                  selected.reduce(
                    (sum, file) => sum + (file.originFileObj?.size ?? 0),
                    0,
                  ) >
                    10 * 1024 * 1024)
              )
                return Promise.reject(
                  new Error("每次最多 5 個憑證，合計上限 10 MB"),
                );
              return Promise.resolve();
            },
          },
        ]}
        getValueFromEvent={(event) =>
          Array.isArray(event) ? event : event?.fileList
        }
        style={{ marginBottom: 0 }}
      >
        <Upload
          listType="picture"
          maxCount={5}
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          beforeUpload={(file) => {
            if (!ACCEPTED.includes(file.type) || file.size > 5 * 1024 * 1024) {
              message.error("請選擇 5 MB 以內的 JPG、PNG、WebP 或 PDF");
              return Upload.LIST_IGNORE;
            }
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>上傳照片或 PDF</Button>
        </Upload>
      </Form.Item>
      <Typography.Text type="secondary">
        每次一筆交易，最多 5 個檔案、合計 10 MB。辨識會使用系統設定的 AI 服務。
      </Typography.Text>
      {busy && <Alert type="info" showIcon message="AI 正在辨識憑證…" />}
      {error && (
        <Alert
          type="warning"
          showIcon
          message="尚未完成辨識"
          description={error}
          action={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => setRetry((value) => value + 1)}
            >
              重試
            </Button>
          }
        />
      )}
      {result && (
        <Alert
          type={result.warnings.length ? "warning" : "info"}
          showIcon
          message="AI 建議已帶入，請核對後送出"
          description={
            <Space direction="vertical" size={4}>
              <span>
                {result.fields.supplierName || "供應商待確認"} ·{" "}
                {result.fields.currency || "幣別待確認"}{" "}
                {result.fields.amountOriginal ?? "金額待確認"}
              </span>
              <span>
                辨識信心 {Math.round(result.confidence * 100)}% ·{" "}
                {dayjs(result.recognizedAt).format("HH:mm")}
              </span>
              {result.warnings.map((warning, index) => (
                <span key={index}>{warning}</span>
              ))}
            </Space>
          }
        />
      )}
      {Boolean(files?.length) && (
        <Form.Item
          name="receiptConfirmed"
          valuePropName="checked"
          rules={[
            {
              validator: (_, checked) =>
                checked
                  ? Promise.resolve()
                  : Promise.reject(new Error("請核對原始憑證後勾選確認")),
            },
          ]}
          style={{ marginBottom: 0 }}
        >
          <Checkbox disabled={busy}>
            我已核對原始憑證、金額、日期與申請用途
          </Checkbox>
        </Form.Item>
      )}
    </Space>
  );
}
