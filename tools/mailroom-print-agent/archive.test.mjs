import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";
import { Journal } from "./journal.mjs";
import { PrintWorker } from "./worker.mjs";
import { documentPath } from "./constants.mjs";
import {
  fixture,
  jobFor,
  pdf,
  DEVICE,
  NOW,
  TOKEN,
  CODE,
} from "./test-fixtures.mjs";

function entry(index, { state = "SUBMITTED", acknowledged = true } = {}) {
  const id = "bbbbbbbb-cccc-4ddd-8eee-" + index.toString(16).padStart(12, "0");
  const job = jobFor(pdf(), {
    id,
    documentPath: documentPath(id),
    expiresAt: new Date(NOW + 120_000 + index * 1000).toISOString(),
  });
  return {
    manifest: job,
    state,
    acknowledged,
    cupsJobId: state === "SUBMITTED" ? "Xprinter_XP-235B-123" : null,
    errorCode:
      state === "FAILED"
        ? "PDF_INVALID"
        : state === "UNKNOWN"
          ? "SUBMISSION_UNCERTAIN"
          : null,
  };
}
const thresholds = {
  compactEntries: 3,
  keepRecent: 1,
  compactBytes: 1024 * 1024,
};

for (const threshold of ["entries", "bytes"])
  test(`safe ${threshold} threshold archives complete ACKed results and retains latest entries`, (t) => {
    const f = fixture(t);
    const options =
      threshold === "entries"
        ? thresholds
        : { compactEntries: 1000, compactBytes: 1, keepRecent: 1 };
    const journal = new Journal(f.root, DEVICE, fs, options);
    const rows = [entry(1), entry(2, { state: "FAILED" }), entry(3)];
    for (const row of rows) journal.save(row);
    journal.compact();
    assert.equal(journal.entries().length, 1);
    assert.deepEqual(journal.entries()[0], rows[2]);
    assert.equal(fs.readdirSync(join(f.root, "archive")).length, 2);
    for (const row of rows.slice(0, 2)) {
      const file = join(f.root, "archive", row.manifest.id + ".json");
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), row);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(fs.readFileSync(file, "utf8").includes(TOKEN), false);
      assert.equal(fs.readFileSync(file, "utf8").includes(CODE), false);
      assert.equal(
        fs.readFileSync(file, "utf8").includes("customerName"),
        false,
      );
    }
    assert.equal(fs.statSync(join(f.root, "archive")).mode & 0o777, 0o700);
    assert.deepEqual(
      new Journal(f.root, DEVICE).get(rows[0].manifest.id),
      rows[0],
    );
  });

test("UNKNOWN, unacknowledged, reconciled-only and uncleaned-PDF results never move to archive", (t) => {
  const f = fixture(t);
  const journal = new Journal(f.root, DEVICE, fs, {
    compactEntries: 1,
    compactBytes: 1,
    keepRecent: 0,
  });
  const unknown = entry(1, { state: "UNKNOWN" }),
    pending = entry(2, { acknowledged: false }),
    cached = entry(3);
  const reconciled = entry(4, { state: "FAILED", acknowledged: false });
  reconciled.receiptReconciled = true;
  reconciled.serverReceipt = {
    id: reconciled.manifest.id,
    requestId: DEVICE,
    deviceId: DEVICE,
    status: "FAILED",
    pages: 1,
    expiresAt: reconciled.manifest.expiresAt,
    cupsJobId: null,
    errorCode: "EXPIRED",
    reprintOf: null,
  };
  for (const row of [unknown, pending, cached, reconciled]) journal.save(row);
  journal.storePdf(cached.manifest, f.bytes);
  journal.compact();
  assert.equal(journal.entries().length, 4);
  assert.deepEqual(fs.readdirSync(join(f.root, "archive")), []);
});

test("restart and old archived duplicate claim never download or print the old job", async (t) => {
  const f = fixture(t);
  const journal = new Journal(f.root, DEVICE, fs, thresholds);
  const rows = [entry(1), entry(2), entry(3)];
  for (const row of rows) journal.save(row);
  journal.compact();
  const restarted = new Journal(f.root, DEVICE, fs, thresholds);
  f.state.claims = [rows[0].manifest];
  const worker = new PrintWorker({
    api: f.api,
    journal: restarted,
    printer: f.printer,
    lock: f.lock,
    now: () => NOW,
  });
  await worker.tick();
  assert.equal(f.state.submitted, 0);
  assert.equal(f.state.documentCalls, 0);
  assert.deepEqual(f.state.receipts, []);
  assert.equal(restarted.get(rows[0].manifest.id).state, "SUBMITTED");
});

test("archive write failure leaves live results intact and prevents any new claim or lp", async (t) => {
  const f = fixture(t);
  let failing = false;
  const io = {
    ...fs,
    renameSync(from, to) {
      if (failing && to.startsWith(join(f.root, "archive") + "/"))
        throw new Error("synthetic disk full");
      fs.renameSync(from, to);
    },
  };
  const journal = new Journal(f.root, DEVICE, io, thresholds);
  for (const row of [entry(1), entry(2), entry(3)]) journal.save(row);
  failing = true;
  const worker = new PrintWorker({
    api: f.api,
    journal,
    printer: f.printer,
    lock: f.lock,
    now: () => NOW,
  });
  await assert.rejects(worker.tick(), { code: "LOCAL_STORAGE_FAILURE" });
  assert.equal(new Journal(f.root, DEVICE).entries().length, 3);
  assert.equal(f.calls.includes("claim"), false);
  assert.equal(f.state.submitted, 0);
});

test("crash after archive fsync but before live-ledger removal keeps both copies and recovers without duplicate lp", async (t) => {
  const f = fixture(t);
  let failing = false;
  const io = {
    ...fs,
    renameSync(from, to) {
      if (failing && to === join(f.root, "journal.json"))
        throw new Error("synthetic live-ledger failure");
      fs.renameSync(from, to);
    },
  };
  const journal = new Journal(f.root, DEVICE, io, thresholds);
  const rows = [entry(1), entry(2), entry(3)];
  for (const row of rows) journal.save(row);
  failing = true;
  const worker = new PrintWorker({
    api: f.api,
    journal,
    printer: f.printer,
    lock: f.lock,
    now: () => NOW,
  });
  await assert.rejects(worker.tick(), { code: "LOCAL_STORAGE_FAILURE" });
  assert.equal(new Journal(f.root, DEVICE).entries().length, 3);
  assert.equal(fs.readdirSync(join(f.root, "archive")).length, 2);
  const restarted = new Journal(f.root, DEVICE, fs, thresholds);
  restarted.compact();
  assert.equal(restarted.entries().length, 1);
  f.state.claims = [rows[0].manifest];
  await new PrintWorker({
    api: f.api,
    journal: restarted,
    printer: f.printer,
    lock: f.lock,
    now: () => NOW,
  }).tick();
  assert.equal(f.state.submitted, 0);
  assert.deepEqual(restarted.get(rows[0].manifest.id), rows[0]);
});

test("corrupt archived duplicate is a storage failure, never treated as an unseen printable job", async (t) => {
  const f = fixture(t);
  const journal = new Journal(f.root, DEVICE, fs, thresholds);
  const rows = [entry(1), entry(2), entry(3)];
  for (const row of rows) journal.save(row);
  journal.compact();
  fs.writeFileSync(
    join(f.root, "archive", rows[0].manifest.id + ".json"),
    "{}",
    { mode: 0o600 },
  );
  f.state.claims = [rows[0].manifest];
  await assert.rejects(
    new PrintWorker({
      api: f.api,
      journal,
      printer: f.printer,
      lock: f.lock,
      now: () => NOW,
    }).tick(),
    { code: "LOCAL_STORAGE_FAILURE" },
  );
  assert.equal(f.state.submitted, 0);
  assert.equal(f.state.documentCalls, 0);
});
