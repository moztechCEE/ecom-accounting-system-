export type MailroomDraftState = { dirty: boolean; busy: boolean; uncertain?: boolean; persistedDispatch?: boolean };

/** Ignore field registration order and blank optional fields, retaining actual draft values. */
export function mailroomDraftFingerprint(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === 'object') return Object.fromEntries(
      Object.entries(entry).filter(([, child]) => child !== undefined && child !== '')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
    return entry;
  };
  return JSON.stringify(normalize(value));
}

/** A route and a drawer share one confirmation owner; a second destination is cancelled. */
export function createMailroomDiscardConfirmation(
  state: () => MailroomDraftState,
  ask: () => Promise<boolean>,
  onBusy: () => void,
) {
  let asking = false;
  return async () => {
    if (state().busy) { onBusy(); return false; }
    if (asking) return false;
    asking = true;
    try { return await ask() && !state().busy; }
    finally { asking = false; }
  };
}
