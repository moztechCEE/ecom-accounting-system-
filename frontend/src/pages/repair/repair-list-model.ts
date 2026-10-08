import type { RepairItem, RepairQueue } from './repair-model';

export type RepairQueueCounts = Partial<Record<RepairQueue, number>>;
export type RepairListItem = RepairItem & {
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
};

export function repairQueueCount(counts: RepairQueueCounts | undefined, queue: RepairQueue): number | undefined {
  const value = counts?.[queue];
  return Number.isSafeInteger(value) && Number(value) >= 0 ? value : undefined;
}
