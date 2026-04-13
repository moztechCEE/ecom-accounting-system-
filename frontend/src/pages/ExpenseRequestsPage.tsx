import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Card,
  Button,
  Table,
  Tag,
  Drawer,
  Form,
  Input,
  InputNumber,
  DatePicker,
  Radio,
  Select,
  Space,
  message,
  Typography,
  Divider,
  Timeline,
  Descriptions,
  Segmented,
  Upload,
  Tooltip,
  Modal,
  Checkbox,
  Alert,
} from "antd";
import {
  PlusOutlined,
  UploadOutlined,
  BulbOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { GlassCard } from "../components/ui/GlassCard";
import { GlassButton } from "../components/ui/GlassButton";
import { GlassDrawer, GlassDrawerSection } from "../components/ui/GlassDrawer";
import {
  expenseService,
  ReimbursementItem,
  ExpenseRequest,
  ExpenseHistoryEntry,
} from "../services/expense.service";
import { accountingService } from "../services/accounting.service";
import type { Account } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useAI } from "../contexts/AIContext";

const { Text, Title } = Typography;

const DEFAULT_ENTITY_ID =
  import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || "tw-entity-001";

const receiptTypeLabelMap: Record<string, string> = {
  TAX_INVOICE: "發票",
  RECEIPT: "收據",
  BANK_SLIP: "銀行水單",
  INTERNAL_ONLY: "內部單據",
};

const TAIWAN_BANKS = [
  { code: "004", name: "臺灣銀行" },
  { code: "005", name: "土地銀行" },
  { code: "006", name: "合作金庫" },
  { code: "007", name: "第一銀行" },
  { code: "008", name: "華南銀行" },
  { code: "009", name: "彰化銀行" },
  { code: "011", name: "上海商銀" },
  { code: "012", name: "台北富邦" },
  { code: "013", name: "國泰世華" },
  { code: "017", name: "兆豐銀行" },
  { code: "021", name: "花旗銀行" },
  { code: "048", name: "王道銀行" },
  { code: "050", name: "臺灣企銀" },
  { code: "052", name: "渣打銀行" },
  { code: "053", name: "台中銀行" },
  { code: "054", name: "京城銀行" },
  { code: "081", name: "匯豐銀行" },
  { code: "102", name: "華泰銀行" },
  { code: "103", name: "新光銀行" },
  { code: "108", name: "陽信銀行" },
  { code: "118", name: "板信銀行" },
  { code: "147", name: "三信商銀" },
  { code: "803", name: "聯邦銀行" },
  { code: "805", name: "遠東商銀" },
  { code: "806", name: "元大銀行" },
  { code: "807", name: "永豐銀行" },
  { code: "808", name: "玉山銀行" },
  { code: "809", name: "凱基銀行" },
  { code: "810", name: "星展銀行" },
  { code: "812", name: "台新銀行" },
  { code: "815", name: "日盛銀行" },
  { code: "816", name: "安泰銀行" },
  { code: "822", name: "中國信託" },
  { code: "700", name: "中華郵政" },
];

const statusMeta: Record<
  string,
  {
    label: string;
    color: string;
  }
> = {
  pending: { label: "審核中", color: "gold" },
  approved: { label: "已核准", color: "green" },
  rejected: { label: "已駁回", color: "red" },
  draft: { label: "草稿", color: "default" },
  paid: { label: "已付款", color: "blue" },
};

const historyLabelMap: Record<string, string> = {
  submitted: "已提交",
  approved: "核准",
  rejected: "駁回",
  pending: "審核中",
};

type ViewMode = "mine" | "pending";

type ValidationErrorShape = {
  errorFields?: unknown;
};

type ApiErrorShape = {
  response?: {
    data?: {
      message?: string;
    };
  };
};

const toNumber = (value?: string | number | null) => {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
};

const confidenceColor = (value?: number) => {
  if (value === undefined) return "default";
  if (value >= 0.8) return "green";
  if (value >= 0.5) return "blue";
  return "default";
};

const hasValidationErrorFields = (
  error: unknown,
): error is ValidationErrorShape =>
  typeof error === "object" && error !== null && "errorFields" in error;

const extractApiMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    const apiError = error as ApiErrorShape;
    return apiError.response?.data?.message;
  }
  return undefined;
};

const ExpenseRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestIdFromQuery = searchParams.get("requestId")?.trim() || null;
  const isAdmin = useMemo(
    () =>
      (user?.roles ?? []).some(
        (role) => role === "SUPER_ADMIN" || role === "ADMIN",
      ),
    [user],
  );
  const [viewMode, setViewMode] = useState<ViewMode>("mine");
  const [listLoading, setListLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reimbursementItems, setReimbursementItems] = useState<
    ReimbursementItem[]
  >([]);
  const [selectedItem, setSelectedItem] = useState<ReimbursementItem | null>(
    null,
  );
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<ExpenseRequest | null>(
    null,
  );
  const [history, setHistory] = useState<ExpenseHistoryEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [predicting, setPredicting] = useState(false);

  // Use global AI context
  const { selectedModelId: globalModelId } = useAI();

  const [form] = Form.useForm();
  const [approvalForm] = Form.useForm();

  const roleKey = useMemo(() => (user?.roles ?? []).join(","), [user]);
  const resolvedRoles = useMemo(
    () => (roleKey ? roleKey.split(",").filter(Boolean) : []),
    [roleKey],
  );
  const entityId = DEFAULT_ENTITY_ID;
  const departmentId: string | undefined = undefined;

  const fetchReimbursementItems = useCallback(async () => {
    try {
      const items = await expenseService.getReimbursementItems(
        entityId,
        resolvedRoles,
        departmentId,
      );
      setReimbursementItems(items);
    } catch (error) {
      console.error(error);
      message.error("無法載入報銷項目");
    }
  }, [departmentId, entityId, resolvedRoles]);

  const refreshRequests = useCallback(async () => {
    try {
      setListLoading(true);
      const query =
        viewMode === "pending"
          ? { entityId, status: "pending" }
          : { entityId, mine: true };
      const requestList = await expenseService.getExpenseRequests(query);
      setRequests(Array.isArray(requestList) ? requestList : []);
    } catch (error) {
      console.error(error);
      message.error("無法載入費用申請列表");
      setRequests([]);
    } finally {
      setListLoading(false);
    }
  }, [entityId, viewMode]);

  useEffect(() => {
    fetchReimbursementItems();
  }, [fetchReimbursementItems]);

  useEffect(() => {
    refreshRequests();
    // Models are now fetched by AIContext, no need to fetch here manually
  }, [refreshRequests]);

  useEffect(() => {
    if (!isAdmin && viewMode === "pending") {
      setViewMode("mine");
    }
  }, [isAdmin, viewMode]);

  useEffect(() => {
    if (!detailDrawerOpen || !isAdmin) {
      return;
    }
    setAccountsLoading(true);
    accountingService
      .getAccounts(entityId)
      .then(setAccounts)
      .catch((error) => {
        console.error(error);
        message.error("無法載入會計科目");
      })
      .finally(() => setAccountsLoading(false));
  }, [detailDrawerOpen, entityId, isAdmin]);

  useEffect(() => {
    if (detailDrawerOpen && selectedRequest) {
      approvalForm.setFieldsValue({
        finalAccountId:
          selectedRequest.finalAccount?.id ||
          selectedRequest.suggestedAccount?.id ||
          undefined,
        remark: "",
        rejectReason: "",
        rejectNote: "",
      });
    } else {
      approvalForm.resetFields();
    }
  }, [approvalForm, detailDrawerOpen, selectedRequest]);

  const handleOpenDrawer = () => {
    setSelectedItem(null);
    form.resetFields();
    setDrawerOpen(true);
  };

  const handleReimbursementItemChange = (id: string) => {
    const item = reimbursementItems.find((x) => x.id === id) || null;
    setSelectedItem(item);

    const isPrepaidCustoms =
      item?.name.includes("關稅預付") || item?.name.includes("Prepaid Customs");

    const updates: any = {
      receiptType: isPrepaidCustoms ? "TAX_INVOICE" : item?.defaultReceiptType,
      payeeType: isPrepaidCustoms ? "vendor" : form.getFieldValue("payeeType"),
      isInvoicePending: isPrepaidCustoms ? true : false,
    };

    if (item?.defaultTaxType) {
      updates.taxType = item.defaultTaxType;
      const amount = form.getFieldValue("amount");
      if (
        amount &&
        (item.defaultTaxType === "TAXABLE_5_PERCENT" ||
          item.defaultTaxType === "NON_DEDUCTIBLE_5_PERCENT")
      ) {
        updates.taxAmount = Math.round((amount / 1.05) * 0.05);
      } else {
        updates.taxAmount = 0;
      }
    }

    form.setFieldsValue(updates);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (!selectedItem) {
        message.error("請先選擇報銷項目");
        return;
      }
      setSubmitting(true);

      const files = values.files || [];
      const evidenceFiles = await Promise.all(
        files.map(async (file: any) => {
          const originFile = file.originFileObj;
          return new Promise<{ name: string; url: string; mimeType: string }>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.readAsDataURL(originFile);
              reader.onload = () =>
                resolve({
                  name: originFile.name,
                  url: reader.result as string,
                  mimeType: originFile.type,
                });
              reader.onerror = (error) => reject(error);
            },
          );
        }),
      );

      const isPrepaidCustoms =
        selectedItem &&
        (selectedItem.name.includes("關稅預付") ||
          selectedItem.name.includes("Prepaid Customs") ||
          (selectedItem.name.includes("關稅") && values.isInvoicePending));

      const payload = {
        entityId,
        reimbursementItemId: selectedItem.id,
        payeeType: values.payeeType,
        paymentMethod: values.paymentMethod,
        amountOriginal: values.amount,
        amountCurrency: "TWD",
        description: values.description,
        remarks: values.remarks,
        receiptType: values.receiptType,
        dueDate: values.dueDate ? values.dueDate.toISOString() : undefined,
        priority: values.isUrgent ? "urgent" : "normal",
        metadata: {
          ...(values.expenseDate
            ? { expenseDate: values.expenseDate.format("YYYY-MM-DD") }
            : {}),
          paymentMethod: values.paymentMethod,
          payeeType: values.payeeType,
          ...(values.paymentMethod === "bank_transfer"
            ? {
                bankCode: values.bankCode,
                bankAccount: values.bankAccount,
              }
            : {}),
          ...(isPrepaidCustoms
            ? {
                customsDeclarationNumber: values.customsDeclarationNumber,
                isInvoicePending: true,
                isPrepaidCustoms: true,
              }
            : {}),
          ...(values.receiptType === "TAX_INVOICE" && !isPrepaidCustoms
            ? {
                invoiceNo: values.invoiceNo,
                taxId: values.taxId,
                isInvoicePending: values.isInvoicePending,
              }
            : {}),
        },
        evidenceFiles: evidenceFiles.length > 0 ? evidenceFiles : undefined,
      };

      const response = await expenseService.createExpenseRequest(payload);

      const rawConfidence =
        response.suggestionConfidence === undefined ||
        response.suggestionConfidence === null
          ? undefined
          : Number(response.suggestionConfidence);
      const confidence =
        rawConfidence !== undefined && !Number.isNaN(rawConfidence)
          ? rawConfidence
          : undefined;
      const suggestion = response.suggestedAccount
        ? `（建議：${response.suggestedAccount.code} ${response.suggestedAccount.name}${
            confidence !== undefined
              ? ` · ${(confidence * 100).toFixed(0)}%`
              : ""
          }）`
        : "";
      message.success(`費用申請已送出${suggestion}`);
      setDrawerOpen(false);
      form.resetFields();
      setSelectedItem(null);
      await refreshRequests();
    } catch (error) {
      if (hasValidationErrorFields(error)) {
        return;
      }
      console.error(error);
      message.error(
        extractApiMessage(error) || "送出申請時發生錯誤，請稍後再試",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openRequestDetail = useCallback(
    async (
      requestOrId: ExpenseRequest | string,
      options?: { fromNotification?: boolean },
    ) => {
      let resolvedRequest: ExpenseRequest | null =
        typeof requestOrId === "string" ? null : requestOrId;

      setDetailDrawerOpen(true);
      setHistory([]);
      setHistoryLoading(true);

      if (resolvedRequest) {
        setSelectedRequest(resolvedRequest);
      } else {
        setSelectedRequest(null);
        try {
          resolvedRequest = await expenseService.getExpenseRequest(
            requestOrId as string,
          );
          setSelectedRequest(resolvedRequest);
        } catch (error) {
          console.error(error);
          message.error("無法取得費用申請詳情，請稍後再試");
          setHistoryLoading(false);
          setDetailDrawerOpen(false);
          return;
        }
      }

      if (!resolvedRequest) {
        setHistoryLoading(false);
        return;
      }

      try {
        const entries = await expenseService.getExpenseRequestHistory(
          resolvedRequest.id,
        );
        setHistory(entries);
        if (options?.fromNotification) {
          message.success("已定位到通知中的費用申請");
        }
      } catch (error) {
        console.error(error);
        message.error("無法取得歷程紀錄，請稍後再試");
      } finally {
        setHistoryLoading(false);
      }
    },
    [],
  );

  const handleOpenDetail = (request: ExpenseRequest) => {
    void openRequestDetail(request);
  };

  useEffect(() => {
    if (!requestIdFromQuery) {
      return;
    }

    let cancelled = false;

    (async () => {
      await openRequestDetail(requestIdFromQuery, { fromNotification: true });
      if (!cancelled) {
        navigate("/ap/expenses", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestIdFromQuery, openRequestDetail, navigate]);

  const handleCloseDetail = () => {
    setDetailDrawerOpen(false);
    setSelectedRequest(null);
    setHistory([]);
    approvalForm.resetFields();
  };

  const handleApproveRequest = async () => {
    if (!selectedRequest) {
      return;
    }
    try {
      const { finalAccountId, remark } = approvalForm.getFieldsValue();
      setApproveLoading(true);
      await expenseService.approveExpenseRequest(selectedRequest.id, {
        finalAccountId: finalAccountId || undefined,
        remark: remark?.trim() || undefined,
      });
      message.success("已核准該費用申請");
      handleCloseDetail();
      await refreshRequests();
    } catch (error) {
      console.error(error);
      message.error(extractApiMessage(error) || "核准失敗，請稍後再試");
    } finally {
      setApproveLoading(false);
    }
  };

  const handleRejectRequest = async () => {
    if (!selectedRequest) {
      return;
    }
    try {
      const { rejectReason, rejectNote } = await approvalForm.validateFields([
        "rejectReason",
        "rejectNote",
      ]);
      const reason = (rejectReason as string | undefined)?.trim();
      if (!reason) {
        message.error("請輸入駁回原因");
        return;
      }
      setRejectLoading(true);
      await expenseService.rejectExpenseRequest(selectedRequest.id, {
        reason,
        note: (rejectNote as string | undefined)?.trim() || undefined,
      });
      message.success("已駁回該費用申請");
      handleCloseDetail();
      await refreshRequests();
    } catch (error) {
      if (hasValidationErrorFields(error)) {
        return;
      }
      console.error(error);
      message.error(extractApiMessage(error) || "駁回失敗，請稍後再試");
    } finally {
      setRejectLoading(false);
    }
  };

  const handlePredictCategory = async () => {
    const description = form.getFieldValue("description");
    if (!description || !description.trim()) {
      message.warning("請先輸入備註說明，AI 才能進行分析");
      return;
    }

    try {
      setPredicting(true);
      const result = await expenseService.predictCategory(
        entityId,
        description,
        globalModelId,
      );
      if (result && result.suggestedItem) {
        const item = reimbursementItems.find(
          (i) => i.id === result.suggestedItem?.id,
        );
        if (item) {
          form.setFieldsValue({ reimbursementItemId: item.id });
          if (result.amount) {
            form.setFieldsValue({ amount: result.amount });
          }
          // Auto-set tax type if available
          if (item.defaultTaxType) {
            form.setFieldValue("taxType", item.defaultTaxType);
            // Trigger tax calculation
            const amount = result.amount || form.getFieldValue("amount");
            if (
              amount &&
              (item.defaultTaxType === "TAXABLE_5_PERCENT" ||
                item.defaultTaxType === "NON_DEDUCTIBLE_5_PERCENT")
            ) {
              const tax = Math.round((amount / 1.05) * 0.05);
              form.setFieldValue("taxAmount", tax);
            }
          }
          setSelectedItem(item);
          message.success({
            content: (
              <div className="flex flex-col">
                <span>
                  AI 建議：<span className="font-bold">{item.name}</span>{" "}
                  (信心度 {(result.confidence * 100).toFixed(0)}%)
                </span>
                {result.amount && (
                  <span className="text-xs text-gray-500 mt-1">
                    已自動填入金額：{result.amount}
                  </span>
                )}
                {item.account && (
                  <span className="text-xs text-gray-500 mt-1">
                    科目：{item.account.code} {item.account.name}
                  </span>
                )}
                {item.defaultTaxType && (
                  <span className="text-xs text-gray-500 mt-1">
                    稅別：{item.defaultTaxType}
                  </span>
                )}
                {item.description && (
                  <span className="text-xs text-gray-400 mt-0.5">
                    {item.description}
                  </span>
                )}
              </div>
            ),
            icon: <BulbOutlined style={{ color: "#faad14" }} />,
            duration: 4,
          });
        } else {
          // 如果找不到對應的項目，嘗試重新載入列表
          console.log(
            "Suggested item not found in current list, refreshing...",
          );
          await fetchReimbursementItems();
          // 重新尋找
          const refreshedItems = await expenseService.getReimbursementItems(
            entityId,
            resolvedRoles,
            departmentId,
          );
          const refreshedItem = refreshedItems.find(
            (i) => i.id === result.suggestedItem?.id,
          );

          if (refreshedItem) {
            setReimbursementItems(refreshedItems);
            form.setFieldsValue({ reimbursementItemId: refreshedItem.id });
            if (result.amount) {
              form.setFieldsValue({ amount: result.amount });
            }
            // Auto-set tax type if available
            if (refreshedItem.defaultTaxType) {
              form.setFieldValue("taxType", refreshedItem.defaultTaxType);
              // Trigger tax calculation
              const amount = result.amount || form.getFieldValue("amount");
              if (
                amount &&
                (refreshedItem.defaultTaxType === "TAXABLE_5_PERCENT" ||
                  refreshedItem.defaultTaxType === "NON_DEDUCTIBLE_5_PERCENT")
              ) {
                const tax = Math.round((amount / 1.05) * 0.05);
                form.setFieldValue("taxAmount", tax);
              }
            }
            setSelectedItem(refreshedItem);
            message.success({
              content: (
                <div className="flex flex-col">
                  <span>
                    AI 建議：
                    <span className="font-bold">{refreshedItem.name}</span>{" "}
                    (信心度 {(result.confidence * 100).toFixed(0)}%)
                  </span>
                  {result.amount && (
                    <span className="text-xs text-gray-500 mt-1">
                      已自動填入金額：{result.amount}
                    </span>
                  )}
                  {refreshedItem.account && (
                    <span className="text-xs text-gray-500 mt-1">
                      科目：{refreshedItem.account.code}{" "}
                      {refreshedItem.account.name}
                    </span>
                  )}
                  {refreshedItem.defaultTaxType && (
                    <span className="text-xs text-gray-500 mt-1">
                      稅別：{refreshedItem.defaultTaxType}
                    </span>
                  )}
                  {refreshedItem.description && (
                    <span className="text-xs text-gray-400 mt-0.5">
                      {refreshedItem.description}
                    </span>
                  )}
                </div>
              ),
              icon: <BulbOutlined style={{ color: "#faad14" }} />,
              duration: 4,
            });
          } else {
            message.info("AI 建議的項目目前不可用");
          }
        }
      } else {
        message.info(
          "AI 無法判斷合適的報銷項目，可能尚未設定報銷項目庫，請聯繫管理員",
        );
      }
    } catch (error) {
      console.error(error);
      const apiMessage = extractApiMessage(error);
      message.error(apiMessage || "AI 分析失敗，請稍後再試");
    } finally {
      setPredicting(false);
    }
  };

  const allowedReceiptTypes = selectedItem?.allowedReceiptTypes
    ?.split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const canReview = Boolean(isAdmin && selectedRequest?.status === "pending");

  const columns: ColumnsType<ExpenseRequest> = [
    {
      title: "報銷項目",
      dataIndex: ["reimbursementItem", "name"],
      key: "reimbursementItem",
      fixed: "left",
      className: "!bg-transparent",
      render: (_, record) => (
        <div className="flex flex-col">
          <span className="font-medium text-gray-800">
            {record.reimbursementItem?.name || "--"}
          </span>
          <div className="sm:hidden mt-1">
            <Tag
              color={statusMeta[record.status]?.color || "default"}
              className="mr-0 text-[10px] px-1.5 leading-5 h-5 border-0"
            >
              {statusMeta[record.status]?.label || record.status}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: "金額",
      dataIndex: "amountOriginal",
      key: "amountOriginal",
      render: (_: unknown, record) => {
        const amount = toNumber(record.amountOriginal);
        return (
          <span className="font-mono text-gray-700">
            {record.amountCurrency || "TWD"} {amount.toLocaleString()}
          </span>
        );
      },
    },
    {
      title: "智能建議",
      key: "suggestedAccount",
      responsive: ["lg"],
      render: (_: unknown, record) => {
        if (!record.suggestedAccount) {
          return <Text type="secondary">—</Text>;
        }
        const confidence = Number(record.suggestionConfidence ?? 0);
        return (
          <Space size={4} direction="vertical">
            <Space size={4}>
              <Tag color="blue" bordered={false}>
                {record.suggestedAccount.code}
              </Tag>
              <span>{record.suggestedAccount.name}</span>
            </Space>
            <Tag color={confidenceColor(confidence)} bordered={false}>
              信心 {(confidence * 100).toFixed(0)}%
            </Tag>
          </Space>
        );
      },
    },
    {
      title: "預計付款日",
      dataIndex: "dueDate",
      key: "dueDate",
      width: 120,
      responsive: ["md"],
      render: (date: string) =>
        date ? dayjs(date).format("YYYY-MM-DD") : "--",
    },
    {
      title: "付款狀態",
      dataIndex: "paymentStatus",
      key: "paymentStatus",
      width: 120,
      responsive: ["sm"],
      sorter: (a, b) =>
        (a.paymentStatus || "").localeCompare(b.paymentStatus || ""),
      render: (status: string, record) => {
        const map: Record<string, { text: string; color: string }> = {
          pending: { text: "待付款", color: "default" },
          processing: { text: "付款中", color: "processing" },
          paid: { text: "已付款", color: "success" },
        };
        const meta = map[status] || { text: "待付款", color: "default" };

        // 急件邏輯：優先級為 urgent 或 到期日剩餘 3 天內且未付款
        const isUrgent =
          record.priority === "urgent" ||
          (record.dueDate &&
            dayjs(record.dueDate).diff(dayjs(), "day") <= 3 &&
            status !== "paid");

        return (
          <Space>
            <Tag color={meta.color}>{meta.text}</Tag>
            {isUrgent && (
              <Tooltip title="急件：請盡速處理">
                <ExclamationCircleOutlined className="text-red-500" />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: "狀態",
      dataIndex: "status",
      key: "status",
      responsive: ["sm"],
      render: (value: string, record) => {
        const meta = statusMeta[value] || { label: value, color: "default" };
        const metadata = (record.metadata as Record<string, any>) || {};
        const isInvoicePending = metadata.isInvoicePending === true;
        const daysSinceCreation = dayjs().diff(dayjs(record.createdAt), "day");
        const isInvoiceOverdue = isInvoicePending && daysSinceCreation > 20;

        return (
          <Space direction="vertical" size={2}>
            <Tag color={meta.color}>{meta.label}</Tag>
            {isInvoicePending && (
              <Tooltip
                title={
                  isInvoiceOverdue
                    ? `發票補正已逾期 ${daysSinceCreation} 天`
                    : "發票後補中"
                }
              >
                <Tag
                  color={isInvoiceOverdue ? "red" : "orange"}
                  className="flex items-center gap-1"
                >
                  <ClockCircleOutlined />{" "}
                  {isInvoiceOverdue ? "補正逾期" : "發票後補"}
                </Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: "申請時間",
      dataIndex: "createdAt",
      key: "createdAt",
      responsive: ["xl"],
      render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      className: "!bg-transparent",
      render: (_: unknown, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => handleOpenDetail(record)}
          >
            查看
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-[fadeInUp_0.4s_ease-out]">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">費用申請</h1>
        <p className="text-slate-500 text-sm max-w-3xl">
          以標準化報銷項目提交費用，並串接智慧科目建議與審批歷程。
        </p>
      </div>

      <GlassCard className="w-full p-0 overflow-hidden">
        <div className="p-6 border-b border-white/20 flex flex-col md:flex-row justify-between items-center gap-4 bg-white/10">
          <h3 className="text-lg font-semibold text-slate-800">我的費用申請</h3>

          <div className="flex items-center gap-3">
            <GlassButton
              onClick={refreshRequests}
              disabled={listLoading}
              className="px-4"
            >
              重新整理
            </GlassButton>
            <GlassButton
              onClick={handleOpenDrawer}
              className="flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700 border-none shadow-lg shadow-blue-500/30"
            >
              <PlusOutlined /> 新增費用申請
            </GlassButton>
          </div>
        </div>

        <Table
          rowKey="id"
          loading={listLoading}
          columns={columns}
          dataSource={requests}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: "目前尚無費用申請紀錄" }}
          className="w-full"
          rowClassName="hover:bg-white/20 transition-colors"
          scroll={{ x: 800 }}
        />
      </GlassCard>

      <GlassDrawer
        title="新增費用申請"
        placement="right"
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        width={420}
        destroyOnClose
        footer={
          <div className="flex justify-end gap-3">
            <GlassButton onClick={() => setDrawerOpen(false)}>取消</GlassButton>
            <GlassButton
              variant="primary"
              isLoading={submitting}
              onClick={handleSubmit}
              className="px-6"
            >
              送出申請
            </GlassButton>
          </div>
        }
      >
        <Form
          layout="vertical"
          form={form}
          initialValues={{ amount: 0 }}
          className="space-y-4"
        >
          <GlassDrawerSection>
            <Form.Item
              label="受款人類型"
              name="payeeType"
              initialValue="employee"
              rules={[{ required: true, message: "請選擇受款人類型" }]}
              className="mb-0"
            >
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                className="w-full flex"
              >
                <Radio.Button value="employee" className="flex-1 text-center">
                  員工代墊
                </Radio.Button>
                <Radio.Button value="vendor" className="flex-1 text-center">
                  廠商直付
                </Radio.Button>
              </Radio.Group>
            </Form.Item>
          </GlassDrawerSection>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) =>
              prevValues.reimbursementItemId !==
              currentValues.reimbursementItemId
            }
          >
            {({ getFieldValue }) => {
              const itemId = getFieldValue("reimbursementItemId");
              const item = reimbursementItems.find((i) => i.id === itemId);
              const isPrepaidCustoms =
                item &&
                (item.name.includes("關稅預付") ||
                  item.name.includes("Prepaid Customs") ||
                  (item.name.includes("關稅") &&
                    getFieldValue("isInvoicePending") === true));

              return isPrepaidCustoms ? (
                <GlassDrawerSection>
                  <div className="mb-4">
                    <Alert
                      message="關稅預付模式"
                      description="系統將自動標記為發票後補。請輸入報關單號，待取得正式進口報單與稅費單據後再行補件。"
                      type="info"
                      showIcon
                    />
                  </div>
                  <Form.Item
                    label="報關單號"
                    name="customsDeclarationNumber"
                    rules={[{ required: true, message: "請輸入報關單號" }]}
                    className="mb-0"
                  >
                    <Input
                      placeholder="請輸入報關單號 (例如: AX/12/345/67890)"
                      className="rounded-xl"
                    />
                  </Form.Item>
                </GlassDrawerSection>
              ) : null;
            }}
          </Form.Item>

          <GlassDrawerSection>
            <Form.Item
              label="請用一句話描述這筆費用"
              style={{ marginBottom: 0 }}
              required
            >
              <div className="mb-2 text-slate-500 text-xs">
                例如：`計程車到客戶公司 560`、`Facebook 廣告費
                3200`。助手會先幫你判斷報銷項目，並嘗試帶入金額。
              </div>
              <Form.Item
                name="description"
                noStyle
                rules={[{ required: true, message: "請輸入備註說明" }]}
              >
                <Input.TextArea
                  rows={3}
                  placeholder="例如：搭計程車去拜訪客戶 560 元"
                  style={{ marginBottom: 12 }}
                  className="rounded-xl bg-white/50 border-white/30 focus:bg-white/80"
                  onChange={(e) => {
                    const value = e.target.value;
                    let match = value.match(
                      /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:元|塊|TWD|NT|USD)/i,
                    );
                    if (!match) {
                      match = value.match(
                        /(?:\$|NT\$?|TWD)\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
                      );
                    }
                    if (!match) {
                      match = value.match(
                        /(?:^|\s)(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s|$)/,
                      );
                    }

                    if (match) {
                      const amountStr = match[1].replace(/,/g, "");
                      const amount = parseFloat(amountStr);
                      if (!isNaN(amount)) {
                        form.setFieldValue("amount", amount);
                      }
                    }

                    // Auto-detect Prepaid Customs
                    if (value.includes("關稅") || value.includes("報關")) {
                      let customsItem = reimbursementItems.find(
                        (i) =>
                          i.name.includes("關稅預付") ||
                          i.name.includes("Prepaid Customs"),
                      );
                      if (!customsItem) {
                        customsItem = reimbursementItems.find(
                          (i) =>
                            i.name.includes("進口關稅") ||
                            i.name.includes("Import Customs"),
                        );
                      }

                      if (customsItem) {
                        form.setFieldsValue({
                          reimbursementItemId: customsItem.id,
                          payeeType: "vendor",
                          receiptType: "TAX_INVOICE",
                          isInvoicePending: true,
                        });
                        setSelectedItem(customsItem);
                      }
                    }
                  }}
                />
              </Form.Item>
              <GlassButton
                fullWidth
                onClick={handlePredictCategory}
                isLoading={predicting}
                className="flex items-center justify-center gap-2 text-blue-600"
              >
                <BulbOutlined /> 請助手判斷報銷項目
              </GlassButton>
            </Form.Item>
          </GlassDrawerSection>

          <GlassDrawerSection>
            <Form.Item label="備註" name="remarks" style={{ marginBottom: 0 }}>
              <Input.TextArea
                rows={2}
                placeholder="例如：飲料五箱、餅乾三箱"
                className="rounded-xl bg-white/50 border-white/30 focus:bg-white/80"
              />
            </Form.Item>
          </GlassDrawerSection>

          <GlassDrawerSection>
            <div className="grid grid-cols-2 gap-4">
              <Form.Item
                label="發生日期"
                name="expenseDate"
                rules={[{ required: true, message: "請選擇發生日期" }]}
                className="mb-0"
              >
                <DatePicker className="w-full rounded-xl" />
              </Form.Item>
              <Form.Item
                label="金額（TWD）"
                name="amount"
                rules={[{ required: true, message: "請輸入金額" }]}
                className="mb-0"
                extra={
                  <span className="text-orange-500 text-xs flex items-center gap-1 mt-1">
                    <ExclamationCircleOutlined /> 請務必再次確認金額
                  </span>
                }
              >
                <InputNumber<number>
                  min={0}
                  precision={0}
                  className="w-full rounded-xl"
                  placeholder="請輸入金額"
                  formatter={(value) =>
                    value
                      ? `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                      : ""
                  }
                  parser={(value) => {
                    if (!value) return 0;
                    const numeric = Number(value.replace(/,/g, ""));
                    return Number.isNaN(numeric) ? 0 : numeric;
                  }}
                  onChange={(value) => {
                    const taxType = form.getFieldValue("taxType");
                    if (
                      value &&
                      (taxType === "TAXABLE_5_PERCENT" ||
                        taxType === "NON_DEDUCTIBLE_5_PERCENT")
                    ) {
                      const tax = Math.round((Number(value) / 1.05) * 0.05);
                      form.setFieldsValue({ taxAmount: tax });
                    }
                  }}
                />
              </Form.Item>
            </div>
            <div className="mt-4">
              <Form.Item name="isUrgent" valuePropName="checked" noStyle>
                <Checkbox className="text-red-600 font-medium">
                  <Space>
                    <ExclamationCircleOutlined />
                    標記為急件 (Urgent)
                  </Space>
                </Checkbox>
              </Form.Item>
              <div className="text-xs text-slate-500 mt-1 ml-6">
                勾選此項將會通知管理員優先處理，請僅在緊急情況下使用。
              </div>
            </div>
          </GlassDrawerSection>

          <GlassDrawerSection>
            <div className="grid grid-cols-2 gap-4">
              <Form.Item
                label="預計付款日"
                name="dueDate"
                tooltip="若為廠商直付，請填寫應付款日期"
                className="mb-0"
              >
                <DatePicker className="w-full rounded-xl" />
              </Form.Item>
              <Form.Item label="付款方式" name="paymentMethod" className="mb-0">
                <Select
                  allowClear
                  placeholder="選擇付款方式"
                  className="rounded-xl"
                  options={[
                    { label: "現金", value: "cash" },
                    { label: "銀行轉帳", value: "bank_transfer" },
                    { label: "信用卡", value: "credit_card" },
                    { label: "支票", value: "check" },
                    { label: "其他", value: "other" },
                  ]}
                />
              </Form.Item>
            </div>
            <Form.Item
              noStyle
              shouldUpdate={(prevValues, currentValues) =>
                prevValues.paymentMethod !== currentValues.paymentMethod
              }
            >
              {({ getFieldValue }) => {
                const paymentMethod = getFieldValue("paymentMethod");
                return paymentMethod === "bank_transfer" ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="grid grid-cols-2 gap-4 mt-4"
                  >
                    <Form.Item
                      label="銀行代碼"
                      name="bankCode"
                      rules={[{ required: true, message: "請選擇銀行" }]}
                      className="mb-0"
                    >
                      <Select
                        showSearch
                        placeholder="搜尋銀行"
                        optionFilterProp="label"
                        options={TAIWAN_BANKS.map((bank) => ({
                          label: `${bank.code} ${bank.name}`,
                          value: bank.code,
                        }))}
                        className="rounded-xl"
                      />
                    </Form.Item>
                    <Form.Item
                      label="銀行帳號"
                      name="bankAccount"
                      rules={[{ required: true, message: "請輸入銀行帳號" }]}
                      className="mb-0"
                    >
                      <Input placeholder="請輸入帳號" className="rounded-xl" />
                    </Form.Item>
                  </motion.div>
                ) : null;
              }}
            </Form.Item>
          </GlassDrawerSection>

          <GlassDrawerSection>
            <div className="grid grid-cols-2 gap-4">
              <Form.Item label="稅別" name="taxType" className="mb-0">
                <Select
                  allowClear
                  placeholder="選擇稅別"
                  className="rounded-xl"
                  options={[
                    { label: "應稅 5% (V5)", value: "TAXABLE_5_PERCENT" },
                    {
                      label: "不可扣抵 5% (VND)",
                      value: "NON_DEDUCTIBLE_5_PERCENT",
                    },
                    { label: "零稅率 (Z0)", value: "ZERO_RATED" },
                    { label: "免稅 (F0)", value: "TAX_FREE" },
                  ]}
                  onChange={(value) => {
                    const amount = form.getFieldValue("amount");
                    if (
                      amount &&
                      (value === "TAXABLE_5_PERCENT" ||
                        value === "NON_DEDUCTIBLE_5_PERCENT")
                    ) {
                      const tax = Math.round((amount / 1.05) * 0.05);
                      form.setFieldsValue({ taxAmount: tax });
                    } else {
                      form.setFieldsValue({ taxAmount: 0 });
                    }
                  }}
                />
              </Form.Item>
              <Form.Item label="稅額" name="taxAmount" className="mb-0">
                <InputNumber
                  min={0}
                  precision={0}
                  className="w-full rounded-xl"
                  placeholder="自動計算"
                />
              </Form.Item>
            </div>
          </GlassDrawerSection>

          <GlassDrawerSection>
            <Form.Item
              label="報銷項目"
              name="reimbursementItemId"
              rules={[{ required: true, message: "請選擇報銷項目" }]}
              className="mb-4"
            >
              <Select
                placeholder="請選擇報銷項目（可使用上方 AI 建議）"
                onChange={handleReimbursementItemChange}
                loading={listLoading}
                showSearch
                className="rounded-xl"
                optionFilterProp="label"
                options={reimbursementItems.map((item) => ({
                  label: item.name,
                  value: item.id,
                }))}
              />
            </Form.Item>

            <Form.Item
              label="憑證類型"
              name="receiptType"
              rules={[{ required: true, message: "請選擇憑證類型" }]}
              className="mb-0"
            >
              <Select
                placeholder={
                  selectedItem ? "請選擇憑證類型" : "請先選擇報銷項目"
                }
                disabled={!selectedItem}
                className="rounded-xl"
                options={
                  allowedReceiptTypes?.map((type) => ({
                    label: receiptTypeLabelMap[type] || type,
                    value: type,
                  })) || []
                }
              />
            </Form.Item>
          </GlassDrawerSection>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) =>
              prevValues.receiptType !== currentValues.receiptType ||
              prevValues.isInvoicePending !== currentValues.isInvoicePending
            }
          >
            {({ getFieldValue }) => {
              const receiptType = getFieldValue("receiptType");
              const isInvoicePending = getFieldValue("isInvoicePending");
              const showInvoiceFields = receiptType === "TAX_INVOICE";

              return showInvoiceFields ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <GlassDrawerSection>
                    <div className="mb-4">
                      <Form.Item
                        name="isInvoicePending"
                        valuePropName="checked"
                        noStyle
                      >
                        <Checkbox>
                          發票後補 (暫無發票，需在 20 天內補正)
                        </Checkbox>
                      </Form.Item>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Form.Item
                        label="發票號碼"
                        name="invoiceNo"
                        rules={[
                          {
                            required: !isInvoicePending,
                            message: "請輸入發票號碼",
                          },
                        ]}
                        className="mb-0"
                      >
                        <Input
                          placeholder="例如：AB-12345678"
                          className="rounded-xl"
                          disabled={isInvoicePending}
                        />
                      </Form.Item>
                      <Form.Item label="統一編號" name="taxId" className="mb-0">
                        <Input
                          placeholder="賣方統編 (選填)"
                          className="rounded-xl"
                          disabled={isInvoicePending}
                        />
                      </Form.Item>
                    </div>
                  </GlassDrawerSection>
                </motion.div>
              ) : null;
            }}
          </Form.Item>

          <GlassDrawerSection>
            <Form.Item
              label="憑證/單據照片"
              name="files"
              valuePropName="fileList"
              getValueFromEvent={(e) => {
                if (Array.isArray(e)) return e;
                return e?.fileList;
              }}
              className="mb-0"
            >
              <Upload
                listType="picture"
                beforeUpload={() => false}
                maxCount={5}
                accept="image/*,.pdf"
              >
                <GlassButton>
                  <UploadOutlined className="mr-2" />
                  上傳照片
                </GlassButton>
              </Upload>
            </Form.Item>

            {selectedItem && allowedReceiptTypes && (
              <div className="mt-3 text-xs text-slate-500">
                <span className="mr-2">此報銷項目允許的憑證：</span>
                <Space size={[4, 4]} wrap>
                  {allowedReceiptTypes.map((type) => (
                    <Tag
                      key={type}
                      color="blue"
                      bordered={false}
                      className="rounded-full px-2"
                    >
                      {receiptTypeLabelMap[type] || type}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
          </GlassDrawerSection>
        </Form>
      </GlassDrawer>

      <GlassDrawer
        title="申請詳情"
        placement="right"
        onClose={handleCloseDetail}
        open={detailDrawerOpen}
        width={420}
        destroyOnClose
      >
        {!selectedRequest ? (
          <Text type="secondary" className="p-6 block">
            請選擇申請查看詳情
          </Text>
        ) : (
          <div className="space-y-4">
            <GlassDrawerSection>
              <Descriptions
                bordered
                column={1}
                size="small"
                labelStyle={{ width: 100, background: "transparent" }}
                contentStyle={{ background: "transparent" }}
              >
                <Descriptions.Item label="報銷項目">
                  {selectedRequest.reimbursementItem?.name || "--"}
                </Descriptions.Item>
                <Descriptions.Item label="金額">
                  {selectedRequest.amountCurrency || "TWD"}{" "}
                  {toNumber(selectedRequest.amountOriginal).toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="狀態">
                  <Tag
                    color={
                      statusMeta[selectedRequest.status]?.color || "default"
                    }
                    className="rounded-full px-2 border-none"
                  >
                    {statusMeta[selectedRequest.status]?.label ||
                      selectedRequest.status}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="系統建議">
                  {selectedRequest.suggestedAccount ? (
                    <Space direction="vertical" size={0}>
                      <span>
                        {selectedRequest.suggestedAccount.code} ·{" "}
                        {selectedRequest.suggestedAccount.name}
                      </span>
                      {selectedRequest.suggestionConfidence && (
                        <Text type="secondary" className="text-xs">
                          信心{" "}
                          {(
                            Number(selectedRequest.suggestionConfidence) * 100
                          ).toFixed(0)}
                          %
                        </Text>
                      )}
                    </Space>
                  ) : (
                    <Text type="secondary">—</Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="最終科目">
                  {selectedRequest.finalAccount ? (
                    <span>
                      {selectedRequest.finalAccount.code} ·{" "}
                      {selectedRequest.finalAccount.name}
                    </span>
                  ) : (
                    <Text type="secondary">尚未指定</Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="備註">
                  {selectedRequest.description || (
                    <Text type="secondary">—</Text>
                  )}
                </Descriptions.Item>
              </Descriptions>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">歷程紀錄</div>
              <div className="max-h-72 overflow-y-auto px-1 pt-1 pb-4">
                <Timeline
                  mode="left"
                  pending={historyLoading ? "讀取中..." : undefined}
                  items={history.map((entry) => ({
                    color:
                      entry.action === "approved"
                        ? "green"
                        : entry.action === "rejected"
                          ? "red"
                          : "blue",
                    children: (
                      <div className="pb-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm font-medium leading-relaxed">
                          <span className="font-bold text-slate-700">
                            {historyLabelMap[entry.action] || entry.action}
                          </span>
                          <span className="text-xs text-slate-400 whitespace-nowrap">
                            {dayjs(entry.createdAt).format("YYYY/MM/DD HH:mm")}
                          </span>
                        </div>
                        {entry.actor && (
                          <div className="text-xs text-slate-500 mt-1">
                            由 {entry.actor.name}
                          </div>
                        )}
                        {entry.note && (
                          <div className="text-sm mt-2 text-slate-600 break-words whitespace-pre-wrap leading-relaxed p-2 bg-white/40 rounded-md border border-white/20">
                            {entry.note}
                          </div>
                        )}
                      </div>
                    ),
                  }))}
                />
                {!historyLoading && history.length === 0 && (
                  <Text type="secondary">尚無歷程紀錄</Text>
                )}
              </div>
            </GlassDrawerSection>

            {selectedRequest.status === "paid" && (
              <GlassDrawerSection>
                <div className="mb-4 font-semibold text-slate-800">
                  付款資訊
                </div>
                <Descriptions
                  bordered
                  column={1}
                  size="small"
                  labelStyle={{ width: 100, background: "transparent" }}
                  contentStyle={{ background: "transparent" }}
                >
                  <Descriptions.Item label="付款銀行">
                    {selectedRequest.paymentBankName || "--"}
                  </Descriptions.Item>
                  <Descriptions.Item label="帳號末五碼">
                    {selectedRequest.paymentAccountLast5 || "--"}
                  </Descriptions.Item>
                  <Descriptions.Item label="付款方式">
                    {selectedRequest.paymentMethod || "--"}
                  </Descriptions.Item>
                </Descriptions>
              </GlassDrawerSection>
            )}
          </div>
        )}
      </GlassDrawer>
    </div>
  );
};

export default ExpenseRequestsPage;
