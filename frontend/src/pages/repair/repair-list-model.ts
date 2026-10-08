import { inspectionReviewCurrent, repairStartReady, sourceQuoteConsentCurrent, type RepairItem, type RepairQueue } from './repair-model';

export type RepairListScope = RepairQueue | 'todo';
export type RepairWorkbenchTab = 'todo' | 'acceptance' | 'all';
export const REPAIR_WORKBENCH_TABS = {todo: '我的待辦', acceptance: '待認領與簽收', all: '案件查詢'} as const;
export const REPAIR_QUERY_FILTERS = {all: '全部案件', mine: '我的案件', waiting: '等待中', delivery: '已交辦收發室', records: '完成紀錄'} as const;
export function repairListScope(value: string | null): RepairListScope {
  return value && ['todo', 'all', 'acceptance', 'mine', 'waiting', 'delivery', 'records'].includes(value) ? value as RepairListScope : 'todo';
}
export function repairWorkbenchTab(scope: RepairListScope): RepairWorkbenchTab {
  return scope === 'todo' || scope === 'acceptance' ? scope : 'all';
}
export type RepairQueueCounts = Partial<Record<RepairListScope, number>>;
export const REPAIR_TODO_LABELS = {INSPECTION:'檢修待處理',REPAIR_WORK:'維修與複驗',START_REPAIR:'待開始維修',START_REPLACEMENT:'待開始換機',SEND_FACTORY:'待交運原廠',FACTORY_RETURN_RECEIPT:'待簽收返還件',RETURN_ORIGINAL:'待交回原件'} as const;
export type RepairListItem = RepairItem & {
  todoKind?: keyof typeof REPAIR_TODO_LABELS;
  repairOverview?: {
    customerName: string | null;
    customerPhone: string | null;
    photoUrl: string | null;
  };
};
export type RepairListResponse = {
  items: RepairListItem[];
  total: number;
  queueCounts?: RepairQueueCounts;
  countExact?: boolean;
  unknownCount?: number;
};

export function repairQueueCount(counts: RepairQueueCounts | undefined, queue: RepairListScope): number | undefined {
  const value = counts?.[queue];
  return Number.isSafeInteger(value) && Number(value) >= 0 ? value : undefined;
}

export function repairCaseProgress(item: RepairItem): string | undefined {
  if (item.receipt.category !== 'REPAIR' || !['INSPECTING', 'WAITING_CUSTOMER'].includes(item.status) || item.repairInspection?.status !== 'SUBMITTED' || item.repairInspection.data.plan === 'RETURN' || item.repairWorkflow?.csr?.decision === 'DECLINE') return undefined;
  if (repairStartReady(item)) return item.repairInspection.data.plan === 'REPLACE' ? '待開始換機' : '待開始維修';
  const inspection = item.repairInspection;
  const csr = item.repairWorkflow?.csr;
  if (!['REPAIR', 'REPLACE'].includes(inspection.data.plan) || !inspectionReviewCurrent(inspection) || inspection.review?.decision !== 'APPROVE' || csr?.status !== 'RESOLVED' || csr.decision !== 'APPROVE' || csr.inspectionRevision !== inspection.revision || csr.estimateRevision !== inspection.revision || csr.quoteRevision !== inspection.review.quoteRevision || csr.planHash !== inspection.review.planHash) return undefined;
  if (item.release?.available !== true) return undefined;
  const info = item.release.releaseInfo;
  if (!info || !Number.isInteger(info.quoteRevision) || info.quoteRevision < 1 || info.quoteRevision !== inspection.review?.quoteRevision) return undefined;
  if (!sourceQuoteConsentCurrent(info)) return '等待顧客確認';
  if (Number.isFinite(info.amount) && Number(info.amount) > 0 && info.confirmedPaymentQuoteRevision !== info.quoteRevision) return '等待款項確認';
  return undefined;
}

export function repairTodoLabel(item: RepairListItem): string | undefined {
  return item.todoKind && Object.hasOwn(REPAIR_TODO_LABELS, item.todoKind) ? REPAIR_TODO_LABELS[item.todoKind] : undefined;
}
