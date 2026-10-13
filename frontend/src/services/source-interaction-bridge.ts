export function sourceInteractionBatch(
  payload: unknown,
): {
  actionId: string;
  outcome: "INTENT" | "CANCELLED" | "VALIDATION_BLOCKED";
  recordId?: string;
}[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  const data = payload as Record<string, unknown>;
  if (
    data.source !== "corely.aftersales.interactions.v1" ||
    Object.keys(data).some((key) => !["source", "events"].includes(key)) ||
    !Array.isArray(data.events) ||
    data.events.length > 20 ||
    JSON.stringify(data).length > 4000
  )
    return [];
  const events = data.events as Record<string, unknown>[];
  if (
    events.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).some(
          (key) => !["actionId", "outcome", "recordId"].includes(key),
        ) ||
        item.recordId !== undefined && (typeof item.recordId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.recordId)) ||
        !/^source\.[a-z][a-z0-9_.-]{1,70}$/.test(String(item.actionId)) ||
        !["INTENT", "CANCELLED", "VALIDATION_BLOCKED"].includes(
          String(item.outcome),
        ),
    )
  )
    return [];
  return events.map((item) => ({
    actionId: String(item.actionId),
    outcome: item.outcome as "INTENT" | "CANCELLED" | "VALIDATION_BLOCKED",
    ...(typeof item.recordId === 'string' ? { recordId: item.recordId } : {}),
  }));
}
export function trustedSourceInteractionBatch(
  event: { origin: string; source: unknown; data: unknown },
  origin: string,
  currentFrame: unknown,
  phase: string,
) {
  if (
    !currentFrame ||
    phase !== "READY" ||
    event.origin !== origin ||
    event.source !== currentFrame
  )
    return [];
  return sourceInteractionBatch(event.data);
}
