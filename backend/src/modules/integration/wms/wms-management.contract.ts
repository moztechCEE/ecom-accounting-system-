import { ServiceUnavailableException } from '@nestjs/common';

export const managementPermissions = {
  overview: 'wms_overview:read',
  logs: 'wms_logs:read',
  exceptions: 'wms_exceptions:read',
  'scan-errors': 'wms_scan_errors:read',
  defects: 'wms_defects:read',
};
export type ManagementSection = keyof typeof managementPermissions;
const invalid = (): never => {
  throw new ServiceUnavailableException('WMS_MANAGEMENT_RESPONSE_INVALID');
};
const record = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : invalid();
const text = (v: unknown, max = 500): string =>
  typeof v === 'string' && v.length <= max ? v : invalid();
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid();
const date = (v: unknown): string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : invalid();
const list = (v: unknown, limit: number): unknown[] =>
  Array.isArray(v) && v.length <= limit ? v : invalid();
export function projectManagement(value: unknown, section: ManagementSection) {
  const d = record(value);
  if (
    d.contractVersion !== 'wms.management-read.v1' ||
    d.source !== 'wms' ||
    d.mode !== 'read_only' ||
    d.section !== section ||
    d.coverage !== 'approved_order_mappings' ||
    !Array.isArray(d.allowedActions) ||
    d.allowedActions.length
  )
    invalid();
  const base = {
    source: 'wms',
    mode: 'read_only',
    section,
    coverage: d.coverage as string,
    observedAt: date(d.observedAt),
    allowedActions: [],
  };
  if (section === 'overview') {
    const summary = Object.fromEntries(
      ['pending', 'picking', 'picked', 'packing', 'completed', 'voided'].map(
        (s) => [s, count(record(d.summary)[s])],
      ),
    );
    const lane = (value: unknown, states: string[]) => {
      const l = record(value);
      const items = list(l.items, 10).map((v) => {
        const r = record(v);
        if (!states.includes(r.state)) invalid();
        return {
          id: text(r.id, 128),
          orderNumber: text(r.orderNumber, 256),
          brand: text(r.brand, 128),
          state: text(r.state),
          updatedAt: date(r.updatedAt),
          picker: r.picker === null ? null : text(r.picker),
          packer: r.packer === null ? null : text(r.packer),
          required: count(r.required),
          picked: count(r.picked),
          packed: count(r.packed),
          blocked: count(r.blocked),
        };
      });
      if (
        count(l.total) !== states.reduce((n, s) => n + summary[s], 0) ||
        l.total < items.length ||
        count(l.page) < 1
      )
        invalid();
      if (
        items.length !== Math.min(10, Math.max(0, l.total - (l.page - 1) * 10))
      )
        invalid();
      return { items, total: l.total as number, page: l.page as number };
    };
    return {
      ...base,
      summary,
      pick: lane(d.pick, ['pending', 'picking']),
      pack: lane(d.pack, ['picked', 'packing']),
    };
  }
  if (
    ![1, 7, 30, 90, ...(section === 'exceptions' ? [0] : [])].includes(
      d.days,
    ) ||
    count(d.page) < 1
  )
    invalid();
  const records = list(d.records, 25).map((v) => {
    const r = record(v);
    const result: Record<string, string> = {
      id: text(r.id, 128),
      orderId: text(r.orderId, 128),
      orderNumber: text(r.orderNumber, 256),
      brand: text(r.brand, 128),
      actor: text(r.actor),
      occurredAt: date(r.occurredAt),
    };
    for (const key of [
      'action',
      'status',
      'reason',
      'stage',
      'scanValue',
      'product',
      'barcode',
      'originalSn',
      'newSn',
      'ackNote',
      'resolutionNote',
    ]) {
      if (r[key] != null) result[key] = text(r[key], 4000);
    }
    return result;
  });
  const breakdown = list(d.breakdown, 10).map((v) => {
    const r = record(v);
    return { label: text(r.label), count: count(r.count) };
  });
  if (
    count(d.total) < records.length ||
    breakdown.reduce((n, r) => n + r.count, 0) > d.total
  )
    invalid();
  if (records.length !== Math.min(25, Math.max(0, d.total - (d.page - 1) * 25)))
    invalid();
  return {
    ...base,
    days: d.days as number,
    page: d.page as number,
    total: d.total as number,
    records,
    breakdown,
  };
}
