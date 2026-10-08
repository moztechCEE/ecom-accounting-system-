export type StorageZone = "RECEIVING" | "OUTBOUND";
export type StorageItem = {
  id: string; productName: string; sku: string | null; serialNumber: string | null;
  sourceNumber: string | null; receiptId: string; receiptNumber: string;
  category: string; storageLocationId: string | null;
  status: string; location: string; custodianId: string; custodianName: string;
  version: number; canMove: boolean;
};
export type StorageRack = {
  id: string; code: string; name: string; zone: StorageZone;
  rows: number; columns: number; layoutX: number; layoutY: number;
  version: number; isActive: boolean;
};
export type StorageLocation = {
  id: string; code: string; name: string; rackId: string; level: number; slot: number;
  version: number; isActive: boolean; items: StorageItem[];
};
export type StorageSnapshot = {
  racks: StorageRack[]; locations: StorageLocation[]; unassigned: StorageItem[];
  counts: { stored: number; unassigned: number }; canManage: boolean;
};
export type StorageOperation = { path: string; body: Readonly<Record<string, unknown>> };
export const STORAGE_ZONES: Record<StorageZone, string> = { RECEIVING: "收件區", OUTBOUND: "待寄區" };
export function storageItemMatches(item: StorageItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [item.productName, item.sku, item.serialNumber, item.sourceNumber,
    item.receiptNumber, item.location, item.custodianName].some(value => value?.toLocaleLowerCase().includes(needle));
}
export function storageLocationMatches(location: StorageLocation, rack: StorageRack | undefined, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [location.code, location.name, rack?.code, rack?.name].some(value => value?.toLocaleLowerCase().includes(needle))
    || location.items.some(item => storageItemMatches(item, query));
}
export function storageLocationOptions(snapshot: StorageSnapshot): { value: string; label: string }[] {
  const activeRacks = new Map(snapshot.racks.filter(rack => rack.isActive).map(rack => [rack.id, rack]));
  return snapshot.locations.filter(location => location.isActive && activeRacks.has(location.rackId))
    .sort((a, b) => a.code.localeCompare(b.code, "zh-Hant", { numeric: true }))
    .map(location => ({ value: location.id, label: `${STORAGE_ZONES[activeRacks.get(location.rackId)!.zone]} · ${location.code} · ${location.name}` }));
}
export function storageFloorBounds(racks: StorageRack[]) {
  const minX = Math.min(0, ...racks.map(rack => rack.layoutX));
  const minY = Math.min(0, ...racks.map(rack => rack.layoutY));
  return { minX, minY, width: Math.max(600, ...racks.map(rack => rack.layoutX - minX + 320)),
    height: Math.max(360, ...racks.map(rack => rack.layoutY - minY + 220)) };
}
export function storageRequestId(): string { return `storage_${crypto.randomUUID()}`; }
export function storageFailure(error: unknown): string {
  const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  return Array.isArray(message) ? message.join("；") : typeof message === "string" ? message : "暫時無法完成，請重試。";
}
export function storageOutcomeUnknown(error: unknown): boolean {
  const status = (error as { response?: { status?: number } }).response?.status;
  return !status || status >= 500;
}
