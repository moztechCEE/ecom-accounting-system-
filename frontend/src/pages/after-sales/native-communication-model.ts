export type ConfirmationPurpose =
  | "PROFILE"
  | "PRODUCT"
  | "QUOTE"
  | "DISPOSITION";
export type PhysicalConfirmationBinding = {
  itemId: string;
  label?: string;
  planVersion: number;
  planHash: string;
  proposalHash?: string;
};
export type CustomerConfirmation = {
  id: string;
  purpose: ConfirmationPurpose;
  status: string;
  revision: number;
  expiresAt: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  identityProvider?: string | null;
  url?: string;
  submittedData?: {
    name: string;
    phone: string;
    address: string;
    email: string;
    productDescription?: string;
    faultDescription?: string;
    decision?: string;
    photos?: { index: number; name?: string }[];
  } | null;
};
export type CustomerNotification = {
  id: string;
  type: string;
  status: string;
  brand: string;
  provider?: string | null;
  providerReceiptId?: string | null;
  lastErrorCode?: string | null;
  payload: {
    title: string;
    text: string;
    actionUrl?: string;
    actionLabel?: string;
  };
  createdAt: string;
  sentAt?: string | null;
};
export type FactoryIssue = {
  id: string;
  status: string;
  revision: number;
  factoryName: string;
  assigneeId: string;
  assigneeName?: string;
  issueSummary: string;
  reply?: string | null;
  resolution?: string | null;
};
export type NativeCommunication = {
  confirmations: CustomerConfirmation[];
  notifications: CustomerNotification[];
  factory: FactoryIssue | null;
  productBindings?: PhysicalConfirmationBinding[];
  sourceActorId?: string;
  aiCustomerService?: { status: string };
};
export type RepairProposal = {
  id: string;
  itemId: string;
  status: string;
  planVersion: number;
  adoptedQuoteRevision?: number | null;
  proposal: {
    plan: "REPAIR" | "REPLACE" | "FACTORY" | "RETURN";
    planHash: string;
    proposalHash: string;
    planNote: string;
    summary: string;
    customerVisibleSummary: string;
    feeMode: "FREE" | "PAID" | "REVIEW";
    amount: number | null;
    currency: string;
    original: {
      productName: string;
      sku?: string | null;
      serialNumber?: string | null;
      sourceItemId: string;
      quantity: number;
    };
    isUnderWarranty?: boolean | null;
    isAccidentalDamage?: boolean | null;
  };
};
export type ConfirmationScope = {
  actorId: string;
  entityId: string;
  caseId: string;
};
export type ConfirmationRequest = {
  operation: "CREATE_CONFIRMATION";
  requestId: string;
  purpose: ConfirmationPurpose;
  expectedUpdatedAt: string;
  binding?: PhysicalConfirmationBinding;
};
export type PendingConfirmation = ConfirmationScope & {
  schema: "corely.doa.pending-confirmation.v1";
  request: ConfirmationRequest;
};
export const confirmationLabels: Record<string, string> = {
  PROFILE: "顧客資料與 LINE",
  PRODUCT: "實收品項確認",
  QUOTE: "維修報價確認",
  DISPOSITION: "寄回或報廢意願",
};
export const confirmationStatuses: Record<string, string> = {
  PENDING: "等待顧客填寫",
  SUBMITTED: "待客服審核",
  APPROVED: "客服已審核",
  REJECTED: "已退回",
  SUPERSEDED: "已換新版",
};
export const notificationStatuses: Record<string, string> = {
  DRAFT: "待審核",
  APPROVED: "已審核，待發送",
  QUEUED: "等待發送",
  SENDING: "發送中",
  FAILED: "發送失敗",
  UNKNOWN: "發送結果待確認",
  SENT: "LINE 已接受",
  SIMULATED: "DEV 模擬完成",
};
export const notificationTypes: Record<string, string> = {
  CASE_CREATED: "案件成立",
  PRODUCT_MISMATCH: "實收品項不符",
  QUOTE_READY: "維修報價",
  QUOTE_ACCEPTED: "顧客同意維修",
  PAYMENT_CONFIRMED: "收款確認",
  PAYMENT_REMINDER: "付款提醒",
  PAYMENT_NEEDS_MORE_INFO: "款項待補資料",
  REPAIR_STARTED: "開始維修",
  REPAIR_COMPLETED: "維修完成",
  EXCHANGE_READY: "換貨準備完成",
  DISPATCHED: "產品已寄出",
  REFUND_CONFIRMED: "退款確認",
  ISSUE_REPLY: "产品問題回覆",
};
export function proposalBlocker(proposals: RepairProposal[], overflow = false) {
  if (overflow) return "提案超過可審核範圍，請先核對完整品項";
  if (!proposals.length) return "尚未收到維修提案";
  if (new Set(proposals.map((p) => p.itemId)).size !== proposals.length)
    return "同一品項有重複提案，請更新案件";
  if (
    proposals.some(
      (p) =>
        !p.proposal ||
        p.proposal.feeMode === "REVIEW" ||
        p.proposal.amount === null ||
        !Number.isFinite(p.proposal.amount),
    )
  )
    return "維修師尚未確認費用";
  if (new Set(proposals.map((p) => p.proposal.currency)).size !== 1)
    return "提案使用不同幣別，請先核對";
  return null;
}
export function pendingConfirmationKey(scope: ConfirmationScope) {
  return `corely.doa.pending-confirmation.v1:${encodeURIComponent(scope.actorId)}:${encodeURIComponent(scope.entityId)}:${encodeURIComponent(scope.caseId)}`;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function validatePendingConfirmation(
  value: unknown,
  scope: ConfirmationScope,
): PendingConfirmation {
  const invalid = () => {
    throw new Error("待確認連結資料無法讀取，請聯絡管理員");
  };
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        !["schema", "actorId", "entityId", "caseId", "request"].includes(key),
    ) ||
    value.schema !== "corely.doa.pending-confirmation.v1" ||
    value.actorId !== scope.actorId ||
    value.entityId !== scope.entityId ||
    value.caseId !== scope.caseId ||
    !object(value.request)
  )
    return invalid();
  const request = value.request;
  if (
    Object.keys(request).some(
      (key) =>
        ![
          "operation",
          "requestId",
          "purpose",
          "expectedUpdatedAt",
          "binding",
        ].includes(key),
    ) ||
    request.operation !== "CREATE_CONFIRMATION" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      String(request.requestId),
    ) ||
    !["PROFILE", "PRODUCT", "QUOTE", "DISPOSITION"].includes(
      String(request.purpose),
    ) ||
    typeof request.expectedUpdatedAt !== "string" ||
    !Number.isFinite(Date.parse(request.expectedUpdatedAt))
  )
    return invalid();
  if (request.binding) {
    const binding = request.binding;
    if (
      !object(binding) ||
      Object.keys(binding).some(
        (key) =>
          !["itemId", "planVersion", "planHash", "proposalHash"].includes(key),
      ) ||
      typeof binding.itemId !== "string" ||
      binding.itemId.length > 128 ||
      !Number.isInteger(binding.planVersion) ||
      Number(binding.planVersion) < 1 ||
      !/^[a-f0-9]{64}$/.test(String(binding.planHash)) ||
      (binding.proposalHash != null &&
        !/^[a-f0-9]{64}$/.test(String(binding.proposalHash)))
    )
      return invalid();
  }
  if (JSON.stringify(value).length > 3000) return invalid();
  return value as unknown as PendingConfirmation;
}
export function readPendingConfirmation(
  storage: Pick<Storage, "getItem">,
  scope: ConfirmationScope,
) {
  let raw: string | null;
  try {
    raw = storage.getItem(pendingConfirmationKey(scope));
  } catch {
    throw new Error("待確認連結無法讀取，尚未送出");
  }
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("待確認連結資料無法讀取，請聯絡管理員");
  }
  return validatePendingConfirmation(value, scope);
}
export function savePendingConfirmation(
  storage: Pick<Storage, "getItem" | "setItem">,
  pending: PendingConfirmation,
) {
  validatePendingConfirmation(pending, pending);
  const previous = readPendingConfirmation(storage, pending);
  if (previous && JSON.stringify(previous) !== JSON.stringify(pending))
    throw new Error("已有待確認連結，請先重試確認");
  try {
    storage.setItem(pendingConfirmationKey(pending), JSON.stringify(pending));
  } catch {
    throw new Error("確認請求未能保存，尚未送出");
  }
  if (
    JSON.stringify(readPendingConfirmation(storage, pending)) !==
    JSON.stringify(pending)
  )
    throw new Error("確認請求未能確認保存，尚未送出");
}
export function clearPendingConfirmation(
  storage: Pick<Storage, "getItem" | "removeItem">,
  scope: ConfirmationScope,
  requestId: string,
) {
  const previous = readPendingConfirmation(storage, scope);
  if (previous && previous.request.requestId !== requestId)
    throw new Error("待確認連結已改變，請重新核對");
  storage.removeItem(pendingConfirmationKey(scope));
  if (readPendingConfirmation(storage, scope))
    throw new Error("確認請求尚未清除，請重新核對");
}
