import type { Source } from "./model";

export function sourceSearchRequests() {
  let revision = 0;
  let controller: AbortController | undefined;
  function cancel() {
    revision++;
    controller?.abort();
  }
  return {
    cancel,
    begin() {
      cancel();
      controller = new AbortController();
      const current = revision;
      return {
        signal: controller.signal,
        isCurrent: () => revision === current,
      };
    },
  };
}

export function mergeSourcePages(previous: Source[], next: Source[]) {
  return [
    ...new Map(
      [...previous, ...next].map((source) => [source.id, source]),
    ).values(),
  ];
}
