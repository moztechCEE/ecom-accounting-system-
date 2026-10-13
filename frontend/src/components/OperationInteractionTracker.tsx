import { useEffect } from "react";
import axios from "axios";
import api from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { useEntityContext } from "../hooks/useEntityContext";
type Intent = {
  id: string;
  actionId: string;
  workbench: string;
  recordId?: string;
  requestId?: string;
  brand?: string;
  outcome: "INTENT" | "CANCELLED" | "VALIDATION_BLOCKED";
  occurredAt: string;
};
const workbenchFor = (path: string) =>
  path.includes("/after-sales/")
    ? "AFTER_SALES"
    : path.includes("/mailroom")
      ? "MAILROOM"
      : path.includes("/repair")
        ? "REPAIR"
        : path.includes("/inventory/")
          ? "INVENTORY"
          : path.includes("/accounting/")
            ? "FINANCE"
            : path.includes("/admin/")
              ? "ADMIN"
              : "OTHER";
export default function OperationInteractionTracker() {
  const { user } = useAuth();
  const entityId = useEntityContext();
  useEffect(() => {
    if (!user?.id || !entityId) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const queue: Intent[] = [];
    let active = true;
    let sending = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const defaultAdapter = axios.getAdapter(api.defaults.adapter);
    const flush = async () => {
      if (
        !active ||
        sending ||
        !queue.length ||
        localStorage.getItem("access_token") !== token
      )
        return;
      const batch = queue.slice(0, 20);
      sending = true;
      try {
        await api.post(
          "/admin/operation-logs/interactions",
          { entityId, items: batch },
          {
            headers: { Authorization: "Bearer " + token },
            adapter: (config) => {
              if (
                !active ||
                localStorage.getItem("access_token") !== token ||
                String(config.headers.get("Authorization")) !==
                  "Bearer " + token
              )
                throw new axios.CanceledError("Actor changed");
              return defaultAdapter(config);
            },
          },
        );
        queue.splice(0, batch.length);
        failures = 0;
      } catch {
        failures++;
      } finally {
        sending = false;
        if (active && queue.length && failures < 3)
          timer = setTimeout(flush, 1000 * 2 ** failures);
      }
    };
    const enqueue = (
      input: Omit<Intent, "id" | "occurredAt" | "workbench">,
    ) => {
      if (
        !active ||
        !/^[a-z][a-z0-9_.-]{2,79}$/.test(input.actionId) ||
        localStorage.getItem("access_token") !== token
      )
        return;
      if (queue.length >= 100) {
        window.dispatchEvent(
          new CustomEvent("operation-log-status", {
            detail: { pending: queue.length, status: "QUEUE_FULL" },
          }),
        );
        return;
      }
      queue.push({
        ...input,
        id: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        workbench: workbenchFor(window.location.pathname),
      });
      if (!timer && !sending)
        timer = setTimeout(() => {
          timer = undefined;
          void flush();
        }, 500);
    };
    const click = (event: MouseEvent) => {
      const target = (event.target as Element)?.closest<HTMLElement>(
        "[data-operation-action]",
      );
      if (!target || target.matches(':disabled,[aria-disabled="true"]')) return;
      enqueue({ actionId: target.dataset.operationAction!, outcome: "INTENT" });
    };
    const custom = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        !detail ||
        !["INTENT", "CANCELLED", "VALIDATION_BLOCKED"].includes(detail.outcome)
      )
        return;
      enqueue({ actionId: detail.actionId, outcome: detail.outcome });
    };
    document.addEventListener("click", click, true);
    window.addEventListener("operation-interaction", custom);
    window.addEventListener("online", flush);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      queue.length = 0;
      document.removeEventListener("click", click, true);
      window.removeEventListener("operation-interaction", custom);
      window.removeEventListener("online", flush);
    };
  }, [user?.id, entityId]);
  return null;
}
