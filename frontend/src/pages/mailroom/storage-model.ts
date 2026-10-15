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
  purpose?: StorageZone | null; version: number; isActive: boolean; items: StorageItem[];
};
export type StorageSnapshot = {
  racks: StorageRack[]; locations: StorageLocation[]; unassigned: StorageItem[];
  counts: { stored: number; unassigned: number }; canManage: boolean;
};
export type StorageOperation = { path: string; body: Readonly<Record<string, unknown>> };
export const STORAGE_ZONES: Record<StorageZone, string> = { RECEIVING: "收件區", OUTBOUND: "待寄區" };
export const STORAGE_PURPOSES: Record<StorageZone, string> = { RECEIVING: "收件", OUTBOUND: "待寄" };
export function storageEffectivePurpose(location: Pick<StorageLocation, "purpose">, rack: Pick<StorageRack, "zone">): StorageZone {
  return location.purpose ?? rack.zone;
}
export function storageLevelLocations(locations: StorageLocation[], rackId: string, level: number): StorageLocation[] {
  return locations.filter(location => location.rackId === rackId && location.level === level)
    .sort((a, b) => a.slot - b.slot || a.code.localeCompare(b.code, "zh-Hant", { numeric: true }));
}
export function storageNextSlot(locations: StorageLocation[], rack: StorageRack, level: number): number | undefined {
  const occupied = new Set(storageLevelLocations(locations, rack.id, level).map(location => location.slot));
  return Array.from({ length: rack.columns }, (_, index) => index + 1).find(slot => !occupied.has(slot));
}
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
    .map(location => ({ value: location.id, label: `${STORAGE_ZONES[storageEffectivePurpose(location, activeRacks.get(location.rackId)!)]} · ${location.code} · ${location.name}` }));
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
