import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeSourcePages,
  sourceSearchRequests,
} from "../src/pages/mailroom/source-search.ts";
import type { Source } from "../src/pages/mailroom/model.ts";

test("typing a new query invalidates the prior response immediately, before debounce fires", () => {
  const requests = sourceSearchRequests();
  const old = requests.begin();
  requests.cancel();
  assert.equal(old.isCurrent(), false);
  assert.equal(old.signal.aborted, true);
  const next = requests.begin();
  assert.equal(next.isCurrent(), true);
  assert.equal(next.signal.aborted, false);
});

test("closing the drawer or switching away from cases invalidates search and load-more requests", () => {
  const requests = sourceSearchRequests();
  const search = requests.begin();
  const more = requests.begin();
  assert.equal(search.isCurrent(), false);
  requests.cancel();
  assert.equal(more.isCurrent(), false);
  assert.equal(more.signal.aborted, true);
});

test("loading older pages retains recent-first server order, avoids duplicates and updates repeated cases", () => {
  const source = (id: string, number: string) => ({ id, number }) as Source;
  assert.deepEqual(
    mergeSourcePages(
      [source("new", "T-new"), source("middle", "T-middle")],
      [source("middle", "T-updated"), source("old", "T-old")],
    ),
    [
      source("new", "T-new"),
      source("middle", "T-updated"),
      source("old", "T-old"),
    ],
  );
});
