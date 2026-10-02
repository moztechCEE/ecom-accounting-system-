export const CATEGORIES: Record<string, string> = {
  REPAIR: "維修品",
  RETURN: "退貨品",
  LETTER: "公司信件",
  PARCEL: "同仁包裹",
  UNMATCHED: "待辨識收件",
};
export const STATUS: Record<string, string> = {
  RECEIVED: "已收件，待核對",
  MISMATCH: "品項不符，待客服確認",
  WAITING_PICKUP: "待同仁簽領",
  WAITING_REPAIR_ACCEPTANCE: "待維修簽收",
  REPAIR_RECEIVED: "維修已簽收",
  INSPECTING: "檢測中",
  WAITING_CUSTOMER: "待客服確認",
  REPAIRING: "維修中",
  WAITING_RETURN_ACCEPTANCE: "處理完成，待收發室簽收",
  READY_FOR_DISPATCH: "待安排寄回",
  PENDING_RESTOCK: "AA 待重新入庫",
  PENDING_DISPOSITION: "A 待瑕疵補寄／福利品處理",
  PENDING_REFURBISH: "B／C 待整新簽收",
  REFURBISHING: "整新中",
  PENDING_WELFARE_STOCK: "整新完成，待福利品入庫",
  COLLECTED: "已簽領",
};
export const ACTIONS: Record<string, string> = {
  identify: "補登收件歸屬",
  receive: "登記收件",
  inspect: "核對實收品項",
  grade: "退貨檢查與分級",
  acknowledge_inspection: "接手退貨檢查結果",
  correct: "更正實收資料",
  move: "更新存放位置",
  assign: "重新指派接收人",
  accept: "本人逐件簽收",
  resolve_customer: "客服已確認，交回檢測",
  resolve_mismatch: "記錄客服確認結果",
  start_inspection: "開始檢測",
  await_customer: "交客服確認",
  start_repair: "開始維修",
  complete_repair: "維修完成，交回收發室",
  complete_refurbish: "整新完成，交回收發室",
  accept_return: "收發室簽收處理完成品",
};
export const DISPOSITIONS: Record<string, string> = {
  RESTOCK: "重新入庫",
  DEFECT_REPLACEMENT: "瑕疵補寄",
  WELFARE_SALE: "福利品販售",
  REFURBISH_THEN_WELFARE: "整理後福利品販售",
};
export type Person = {
  id: string;
  name: string;
  employeeNo: string;
  department: string;
  repair: boolean;
  mailroom: boolean;
};
export type Source = {
  id: string;
  number: string;
  type: string;
  status: string;
  statusLabel?: string;
  customerLabel: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  expectedQuantity?: number;
  receivedQuantity?: number;
  remainingQuantity?: number;
  items: {
    id: string;
    name: string;
    sku: string | null;
    serialNumber: string | null;
    quantity: number;
    receivedQuantity?: number;
    remainingQuantity?: number;
  }[];
};
export type Item = {
  id: string;
  label: string;
  productName: string;
  sku: string | null;
  serialNumber: string | null;
  status: string;
  statusLabel: string;
  version: number;
  matchResult: string;
  grade: string | null;
  disposition: string | null;
  conditionNote: string | null;
  returnInspection?: {
    packaging: string;
    product: string;
    accessories: string;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
  } | null;
  location: string;
  custodianId: string;
  custodianName: string;
  nextUserId: string | null;
  nextUserName: string | null;
  recipientId: string | null;
  repairOwnerId: string | null;
  mine: boolean;
  evidenceCount: number;
  evidence?: string[];
  declared?: { name: string; sku: string | null; serialNumber: string | null };
  receipt: {
    number: string;
    category: string;
    sourceCaseId: string | null;
    sourceNumber: string | null;
    customerServiceUserId?: string | null;
    trackingNumber: string | null;
    carrier: string | null;
    senderLabel: string | null;
    receivedAt: string;
  };
  history?: {
    id: string;
    actorName: string;
    action: string;
    toStatus: string;
    version: number;
    note: string | null;
    createdAt: string;
    snapshot?: { evidence?: string[] };
  }[];
  deliverySummary?: { target: string; status: string; count: number }[];
  deliveries?: {
    id: string;
    target: string;
    status: string;
    lastError: string | null;
    createdAt: string;
  }[];
};
export type Task = { id: string; kind: string; createdAt: string; item: Item };
export function mailroomEnabled() {
  return (
    window.__APP_CONFIG__?.mailroomEnabled === true ||
    import.meta.env.VITE_MAILROOM_ENABLED === "true"
  );
}
export function errorText(error: unknown) {
  const message = (error as { response?: { data?: { message?: unknown } } })
    .response?.data?.message;
  return Array.isArray(message)
    ? message.join("；")
    : typeof message === "string"
      ? message
      : "暫時無法完成，請稍後重試。";
}
