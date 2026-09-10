import type { WarehouseDetail } from "../src/services/warehouse.types";
import type { ReportRecord } from "../src/services/warehouse-management";

// Synthetic records, isolated from production. Uses the same in-memory order list as the scanning workstations.
export function createManagementFixture(orders: WarehouseDetail[]) {
  const history: Record<string, ReportRecord[]> = Object.fromEntries(
    ["logs", "exceptions", "scan-errors", "defects"].map((section) => [
      section,
      Array.from({ length: section === "scan-errors" ? 68 : 31 }, (_, i) => {
        const o =
          orders[
            section === "exceptions" ? [7, 9, 12][i % 3] : i % orders.length
          ];
        return {
          id: `${section}-${i}`,
          orderId: o.id,
          orderNumber: o.orderNumber,
          brand: o.brand || "MOZTECH",
          actor: i % 2 ? "測試揀貨員" : "測試裝箱員",
          occurredAt: new Date(
            Date.now() - (i % 40) * 86400000 - i * 60000,
          ).toISOString(),
          ...(section === "logs"
            ? {
                action: i % 2 ? "pick" : "pack",
                stage: i % 2 ? "pick" : "pack",
                scanValue: "TEST-CABLE",
              }
            : {}),
          ...(section === "exceptions"
            ? {
                action: ["stockout", "damage", "order_change"][i % 3],
                status: ["open", "ack", "resolved", "rejected"][i % 4],
                reason: [
                  "測試：商品數量不足",
                  "測試：包裝破損",
                  "測試：品項需要確認",
                ][i % 3],
              }
            : {}),
          ...(section === "scan-errors"
            ? {
                action: "scan_error",
                scanValue: i % 2 ? "TEST-WRONG" : "TEST-SN-REPEAT",
                stage: i % 2 ? "pick" : "pack",
                reason: i % 2 ? "條碼不屬於訂單" : "重複掃描 SN",
              }
            : {}),
          ...(section === "defects"
            ? {
                product: i % 2 ? "測試主機" : "測試配件",
                barcode: i % 2 ? "TEST-DEVICE" : "TEST-CABLE",
                originalSn: `TEST-OLD-${i}`,
                newSn: `TEST-NEW-${i}`,
                reason: i % 2 ? "測試：功能異常" : "測試：外觀破損",
              }
            : {}),
        };
      }),
    ]),
  );
  orders.forEach((o) => {
    o.blockers = [
      ...new Set(
        history.exceptions
          .filter(
            (r) =>
              r.orderId === o.id && ["open", "ack"].includes(r.status || ""),
          )
          .map((r) => r.reason!),
      ),
    ];
  });
  function read(section: string, q: URLSearchParams) {
    const base = {
      source: "fixture",
      observedAt: new Date().toISOString(),
      mode: "read_only",
      section,
      coverage: "approved_order_mappings",
      allowedActions: [],
    };
    const search = (q.get("search") || "").toLowerCase();
    if (section === "overview") {
      const filtered = orders.filter((o) =>
        o.orderNumber.toLowerCase().includes(search),
      );
      const summary = Object.fromEntries(
        ["pending", "picking", "picked", "packing", "completed", "voided"].map(
          (s) => [s, filtered.filter((o) => o.state === s).length],
        ),
      );
      const lane = (stage: "pick" | "pack") => {
        const states =
            stage === "pick" ? ["pending", "picking"] : ["picked", "packing"],
          page = Number(q.get(stage + "Page") || 1);
        const all = filtered.filter((o) => states.includes(o.state));
        return {
          total: all.length,
          page,
          items: all
            .slice((page - 1) * 10, page * 10)
            .map((o) => ({
              ...o,
              blocked: history.exceptions.filter(
                (r) =>
                  r.orderId === o.id &&
                  ["open", "ack"].includes(r.status || ""),
              ).length,
              picker: o.picked ? "測試揀貨員" : null,
              packer: o.packed ? "測試裝箱員" : null,
            })),
        };
      };
      return { ...base, summary, pick: lane("pick"), pack: lane("pack") };
    }
    if (!history[section]) return null;
    const days = Number(q.get("days") || 30),
      page = Number(q.get("page") || 1),
      status = q.get("status") || "all";
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const start = Date.parse(today + "T00:00:00+08:00") - (days - 1) * 86400000;
    const all = history[section].filter(
      (r) =>
        (days === 0 || Date.parse(r.occurredAt) >= start) &&
        (r.orderNumber.toLowerCase().includes(search) ||
          r.actor.toLowerCase().includes(search)) &&
        (section !== "exceptions" ||
          status === "all" ||
          (status === "unresolved"
            ? ["open", "ack"].includes(r.status || "")
            : r.status === status)),
    );
    const breakdown = new Map<string, number>();
    for (const r of all) {
      const key =
        section === "defects"
          ? r.product!
          : section === "scan-errors"
            ? r.actor
            : r.action!;
      breakdown.set(key, (breakdown.get(key) || 0) + 1);
    }
    return {
      ...base,
      total: all.length,
      days,
      page,
      records: all.slice((page - 1) * 25, page * 25),
      breakdown: [...breakdown]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }
  function event(
    id: string,
    stage: string,
    kind: string,
    value: string,
    rejected = false,
  ) {
    const o = orders.find((o) => o.id === id);
    if (!o) return;
    const r = {
      id: crypto.randomUUID(),
      orderId: id,
      orderNumber: o.orderNumber,
      brand: o.brand || "MOZTECH",
      actor: stage === "pick" ? "測試揀貨員" : "測試裝箱員",
      occurredAt: new Date().toISOString(),
      action: rejected ? "scan_error" : kind === "scan" ? stage : "claim",
      stage,
      scanValue: value,
      reason: rejected ? "測試掃碼未通過核對" : "",
    };
    history.logs.unshift(r);
    if (rejected) history["scan-errors"].unshift(r);
  }
  return { read, event };
}
