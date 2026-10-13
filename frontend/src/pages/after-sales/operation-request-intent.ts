/** A dispatch attempt is distinct from a click and never a server result. */
export function operationRequestIntent(actionId: string, requestId: string, recordId?: string) {
  if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(actionId) || !/^[a-f0-9-]{36}$/i.test(requestId)) return;
  window.dispatchEvent(new CustomEvent('operation-interaction', { detail: { actionId, outcome: 'INTENT', requestId,
    ...(recordId && /^[A-Za-z0-9_-]{1,128}$/.test(recordId) ? { recordId } : {}) } }));
}
