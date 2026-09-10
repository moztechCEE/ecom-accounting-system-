export type WorkStage = 'pick' | 'pack'
export type WarehouseRow = {
  id: string; orderNumber: string; brand: string | null; state: string;
  warehouseLabel: string; logisticsLabel: string; receiptLabel: string;
  assignee: string | null; updatedAt: string;
  required: number; picked: number; packed: number;
}
export type WorkItem = {
  id: string; name: string; sku: string; barcode: string;
  quantity: number; picked: number; packed: number;
  serials: { value: string; status: 'pending' | 'picked' | 'packed' }[];
}
export type WarehouseDetail = WarehouseRow & {
  revision: number; source: string; items: WorkItem[];
  allowedActions: string[]; blockers: string[];
}
