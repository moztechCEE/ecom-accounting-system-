import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { AgentError, DeviceRevoked } from "./constants.mjs";
import { Journal } from "./journal.mjs";
import { PrintWorker } from "./worker.mjs";
import { fixture, DEVICE, JOB, NOW } from "./test-fixtures.mjs";
import { DeviceApi } from "./protocol.mjs";
import { TOKEN } from "./test-fixtures.mjs";
function terminalProof(job, changes = {}) {
  return {
    id: job.id,
    requestId: DEVICE,
    deviceId: DEVICE,
    status: "FAILED",
    pages: job.pages,
    expiresAt: job.expiresAt,
    cupsJobId: null,
    errorCode: "EXPIRED",
    reprintOf: null,
    ...changes,
  };
}

test("durable SUBMITTING precedes its server ACK and the single fixed lp invocation", async (t) => {
  const f = fixture(t);
  let acked = false;
  f.api.receipt = async (job, receipt) => {
    assert.equal(new Journal(f.root, DEVICE).get(JOB).state, receipt.state);
    if (receipt.state === "SUBMITTING") acked = true;
    f.state.receipts.push(receipt);
  };
  f.printer.print = async (id, path) => {
    assert.equal(acked, true);
    assert.equal(id, JOB);
    assert.equal(path, f.journal.pdfPath(JOB));
    assert.equal(new Journal(f.root, DEVICE).get(JOB).state, "SUBMITTING");
    f.state.submitted++;
    return "Xprinter_XP-235B-123";
  };
  await f.worker.tick();
  assert.equal(f.state.submitted, 1);
  assert.deepEqual(
    f.state.receipts.map((r) => r.state),
    ["SUBMITTING", "SUBMITTED"],
  );
  assert.equal(f.journal.get(JOB).acknowledged, true);
  assert.equal(fs.existsSync(f.journal.pdfPath(JOB)), false);
});

test("duplicate server claim never calls lp twice even after PDF cleanup", async (t) => {
  const f = fixture(t);
  f.state.claims.push(f.job);
  await f.worker.tick();
  await f.worker.tick();
  assert.equal(f.state.submitted, 1);
  assert.equal(f.state.documentCalls, 1);
});

test("lost terminal ACK is retried on restart even when claim has no job; no second lp", async (t) => {
  const f = fixture(t);
  let lost = true;
  f.api.receipt = async (_job, receipt) => {
    f.state.receipts.push(receipt);
    if (receipt.state === "SUBMITTED" && lost) {
      lost = false;
      throw new AgentError("NETWORK_UNAVAILABLE");
    }
  };
  await f.worker.tick();
  assert.equal(f.journal.get(JOB).state, "SUBMITTED");
  assert.equal(f.journal.get(JOB).acknowledged, false);
  const restarted = new PrintWorker({
    api: f.api,
    journal: new Journal(f.root, DEVICE),
    printer: f.printer,
    lock: f.lock,
    now: () => NOW,
  });
  await restarted.tick();
  assert.equal(f.state.submitted, 1);
  assert.equal(
    f.state.receipts.filter((r) => r.state === "SUBMITTED").length,
    2,
  );
  assert.equal(new Journal(f.root, DEVICE).get(JOB).acknowledged, true);
});

test("crash with durable SUBMITTING becomes UNKNOWN before polling and never resubmits", async (t) => {
  const f = fixture(t);
  f.journal.save({
    manifest: f.job,
    state: "SUBMITTING",
    cupsJobId: null,
    errorCode: null,
    acknowledged: false,
  });
  f.state.claims = [f.job];
  await f.worker.tick();
  assert.equal(f.state.submitted, 0);
  assert.equal(f.journal.get(JOB).state, "UNKNOWN");
  assert.equal(f.state.receipts[0].state, "UNKNOWN");
  assert.equal(f.calls[0], "UNKNOWN");
});

test("lost pre-submit ACK is UNKNOWN with zero lp; it is never retried as SUBMITTING", async (t) => {
  const f = fixture(t);
  const receipt = f.api.receipt;
  f.api.receipt = async (job, body) => {
    if (body.state === "SUBMITTING")
      throw new AgentError("NETWORK_UNAVAILABLE");
    return receipt(job, body);
  };
  await f.worker.tick();
  assert.equal(f.state.submitted, 0);
  assert.equal(f.journal.get(JOB).state, "UNKNOWN");
  assert.equal(f.state.receipts[0].state, "UNKNOWN");
});

test("journal fsync failure before pre-submit produces zero server SUBMITTING and zero lp", async (t) => {
  let failing = false;
  const io = {
    ...fs,
    fsyncSync(fd) {
      if (failing) throw new Error("synthetic disk failure");
      fs.fsyncSync(fd);
    },
  };
  const f = fixture(t, { io });
  f.printer.preflight = async () => {
    failing = true;
  };
  await assert.rejects(f.worker.tick(), { code: "LOCAL_STORAGE_FAILURE" });
  assert.equal(f.state.submitted, 0);
  assert.deepEqual(f.state.receipts, []);
  assert.equal(new Journal(f.root, DEVICE).get(JOB).state, "DOWNLOADED");
});

test("failure to persist known CUPS ID leaves SUBMITTING; restart reports UNKNOWN without lp", async (t) => {
  let failing = false;
  const io = {
    ...fs,
    writeFileSync(fd, bytes, ...rest) {
      if (
        failing &&
        typeof bytes === "string" &&
        bytes.includes('"state":"SUBMITTED"')
      )
        throw new Error("disk full");
      fs.writeFileSync(fd, bytes, ...rest);
    },
  };
  const f = fixture(t, { io });
  f.printer.print = async () => {
    f.state.submitted++;
    failing = true;
    return "Xprinter_XP-235B-123";
  };
  await assert.rejects(f.worker.tick(), { code: "LOCAL_STORAGE_FAILURE" });
  assert.equal(new Journal(f.root, DEVICE).get(JOB).state, "SUBMITTING");
  assert.equal(
    f.state.receipts.some((r) => r.state === "SUBMITTED"),
    false,
  );
  const restarted = new PrintWorker({
    api: f.api,
    journal: new Journal(f.root, DEVICE),
    printer: f.printer,
    lock: f.lock,
    now: () => NOW,
  });
  await restarted.tick();
  assert.equal(f.state.submitted, 1);
  assert.equal(new Journal(f.root, DEVICE).get(JOB).state, "UNKNOWN");
});

for (const scenario of ["timeout", "nonzero", "missing-id"])
  test(`any lp invocation with ${scenario} is UNKNOWN`, async (t) => {
    const f = fixture(t);
    f.printer.print = async () => {
      f.state.submitted++;
      throw new AgentError("SUBMISSION_UNCERTAIN");
    };
    await f.worker.tick();
    await f.worker.tick();
    assert.equal(f.state.submitted, 1);
    assert.equal(f.journal.get(JOB).state, "UNKNOWN");
  });

test("definitive printer preflight failure records FAILED and makes zero lp calls", async (t) => {
  const f = fixture(t);
  f.printer.preflight = async () => {
    throw new AgentError("PRINTER_UNAVAILABLE");
  };
  await f.worker.tick();
  assert.equal(f.state.submitted, 0);
  assert.equal(f.journal.get(JOB).state, "FAILED");
  assert.equal(f.state.receipts[0].errorCode, "PRINTER_UNAVAILABLE");
});

test("PDF hash mismatch is definitive FAILED before preflight or lp", async (t) => {
  const f = fixture(t);
  f.api.document = async () => Buffer.from("wrong document");
  await f.worker.tick();
  assert.equal(f.state.submitted, 0);
  assert.equal(f.state.preflight, 0);
  assert.equal(f.journal.get(JOB).errorCode, "PDF_INVALID");
});

for (const field of [
  "deviceId",
  "documentPath",
  "profile",
  "pdfBytes",
  "pages",
])
  test(`invalid manifest ${field} produces zero document reads or lp`, async (t) => {
    const f = fixture(t);
    f.state.claims = [
      {
        ...f.job,
        [field]: field === "pdfBytes" || field === "pages" ? 0 : "untrusted",
      },
    ];
    await assert.rejects(f.worker.tick(), { code: "PROTOCOL_INVALID" });
    assert.equal(f.state.documentCalls, 0);
    assert.equal(f.state.submitted, 0);
  });

test("revocation during pre-submit stops the device and retains UNKNOWN without more network calls", async (t) => {
  const f = fixture(t);
  let calls = 0;
  f.api.receipt = async () => {
    calls++;
    throw new DeviceRevoked();
  };
  await assert.rejects(f.worker.tick(), DeviceRevoked);
  assert.equal(calls, 1);
  assert.equal(f.state.submitted, 0);
  assert.equal(f.journal.get(JOB).state, "UNKNOWN");
  assert.equal(f.journal.get(JOB).acknowledged, false);
});

test("expiry after successful pre-submit ACK records FAILED without invoking lp", async (t) => {
  const f = fixture(t);
  let clock = NOW;
  f.worker.now = () => clock;
  f.api.receipt = async (_job, receipt) => {
    if (receipt.state === "SUBMITTING") clock = Date.parse(f.job.expiresAt);
  };
  await f.worker.tick();
  assert.equal(f.state.submitted, 0);
  assert.equal(f.journal.get(JOB).errorCode, "EXPIRED");
});

test("unacknowledged terminal results flush before claim; an unavailable ACK prevents new work", async (t) => {
  const f = fixture(t);
  f.journal.save({
    manifest: f.job,
    state: "UNKNOWN",
    cupsJobId: null,
    errorCode: "SUBMISSION_UNCERTAIN",
    acknowledged: false,
  });
  f.api.receipt = async () => {
    throw new AgentError("NETWORK_UNAVAILABLE");
  };
  await f.worker.tick();
  assert.equal(f.calls.includes("claim"), false);
  assert.equal(f.state.submitted, 0);
});
for (const [localState, localError] of [
  ["FAILED", "PRINTER_UNAVAILABLE"],
  ["UNKNOWN", "SUBMISSION_UNCERTAIN"],
])
  test(`expiry terminal proof reconciles ${localState} without overwriting local history or blocking next poll`, async (t) => {
    const f = fixture(t);
    f.journal.save({
      manifest: f.job,
      state: localState,
      cupsJobId: null,
      errorCode: localError,
      acknowledged: false,
    });
    f.api.receipt = async () => ({
      reconciled: true,
      current: terminalProof(f.job),
    });
    f.state.claims = [null];
    await f.worker.tick();
    const entry = new Journal(f.root, DEVICE).get(JOB);
    assert.equal(entry.state, localState);
    assert.equal(entry.errorCode, localError);
    assert.equal(entry.acknowledged, false);
    assert.equal(entry.receiptReconciled, true);
    assert.equal(entry.serverReceipt.status, "FAILED");
    assert.equal(entry.serverReceipt.errorCode, "EXPIRED");
    assert.equal(f.calls.includes("claim"), true);
    assert.equal(f.state.submitted, 0);
    const restarted = new PrintWorker({
      api: f.api,
      journal: new Journal(f.root, DEVICE),
      printer: f.printer,
      lock: f.lock,
      now: () => NOW,
    });
    f.state.claims = [f.job];
    await restarted.tick();
    assert.equal(f.state.submitted, 0);
  });
for (const changes of [
  { id: DEVICE },
  { deviceId: JOB },
  { status: "CLAIMED" },
  { pages: 2 },
])
  test(`invalid terminal proof retains UNKNOWN and does not allow another claim ${JSON.stringify(changes)}`, async (t) => {
    const f = fixture(t);
    f.journal.save({
      manifest: f.job,
      state: "UNKNOWN",
      cupsJobId: null,
      errorCode: "SUBMISSION_UNCERTAIN",
      acknowledged: false,
    });
    f.api.receipt = async () => ({
      reconciled: true,
      current: terminalProof(f.job, changes),
    });
    await assert.rejects(f.worker.tick(), { code: "PROTOCOL_INVALID" });
    const entry = new Journal(f.root, DEVICE).get(JOB);
    assert.equal(entry.state, "UNKNOWN");
    assert.equal(entry.acknowledged, false);
    assert.equal(entry.receiptReconciled, undefined);
    assert.equal(f.calls.includes("claim"), false);
    assert.equal(f.state.submitted, 0);
  });
test("server terminal before pre-submit ACK creates separately reconciled UNKNOWN and zero lp", async (t) => {
  const f = fixture(t);
  f.api.receipt = async () => ({
    reconciled: true,
    current: terminalProof(f.job),
  });
  await f.worker.tick();
  assert.equal(f.state.submitted, 0);
  assert.equal(f.journal.get(JOB).state, "UNKNOWN");
  assert.equal(f.journal.get(JOB).errorCode, "SUBMISSION_UNCERTAIN");
  assert.equal(f.journal.get(JOB).serverReceipt.errorCode, "EXPIRED");
  assert.equal(f.journal.get(JOB).receiptReconciled, true);
});
test("terminal proof must be fsynced before flushing can unblock or poll another job", async (t) => {
  let failing = false;
  const io = {
    ...fs,
    fsyncSync(fd) {
      if (failing) throw new Error("disk full");
      fs.fsyncSync(fd);
    },
  };
  const f = fixture(t, { io });
  f.journal.save({
    manifest: f.job,
    state: "UNKNOWN",
    cupsJobId: null,
    errorCode: "SUBMISSION_UNCERTAIN",
    acknowledged: false,
  });
  f.api.receipt = async () => {
    failing = true;
    return { reconciled: true, current: terminalProof(f.job) };
  };
  await assert.rejects(f.worker.tick(), { code: "LOCAL_STORAGE_FAILURE" });
  assert.equal(
    new Journal(f.root, DEVICE).get(JOB).receiptReconciled,
    undefined,
  );
  assert.equal(f.calls.includes("claim"), false);
  assert.equal(f.state.submitted, 0);
});
test("reentrant polling is blocked while one tick owns the worker", async (t) => {
  const f = fixture(t);
  let release;
  f.api.claim = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const first = f.worker.tick();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(f.worker.tick(), { code: "INSTANCE_LOCKED" });
  release(null);
  await first;
  assert.equal(f.state.submitted, 0);
});
test("receipt HTTP 503 preserves SUBMITTED and retries only the ACK after recovery", async (t) => {
  const f = fixture(t);
  let unavailable = true;
  const api = new DeviceApi(DEVICE, TOKEN, {
    transport: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.state === "SUBMITTED" && unavailable)
        return new Response(null, { status: 503 });
      return new Response(
        JSON.stringify({
          id: JOB,
          deviceId: DEVICE,
          status: body.state,
          cupsJobId: body.cupsJobId ?? null,
          errorCode: body.errorCode ?? null,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });
  f.api.receipt = api.receipt.bind(api);
  await f.worker.tick();
  assert.equal(f.journal.get(JOB).state, "SUBMITTED");
  assert.equal(f.journal.get(JOB).acknowledged, false);
  unavailable = false;
  await f.worker.tick();
  assert.equal(f.state.submitted, 1);
  assert.equal(f.journal.get(JOB).acknowledged, true);
});
test("expired document creates FAILED without lp, reconciles a different server terminal, then continues polling", async (t) => {
  const f = fixture(t);
  f.api.document = async () => {
    throw new AgentError("EXPIRED");
  };
  f.api.receipt = async () => ({
    reconciled: true,
    current: terminalProof(f.job, { errorCode: "AUTHORIZATION_REVOKED" }),
  });
  await f.worker.tick();
  assert.equal(f.state.submitted, 0);
  assert.equal(f.journal.get(JOB).state, "FAILED");
  assert.equal(f.journal.get(JOB).errorCode, "EXPIRED");
  assert.equal(f.journal.get(JOB).receiptReconciled, true);
  const before = f.calls.filter((call) => call === "claim").length;
  await f.worker.tick();
  assert.equal(f.calls.filter((call) => call === "claim").length, before + 1);
});
test("crash after PDF fsync before DOWNLOADED adopts only exact cache and prints once after resume", async (t) => {
  const f = fixture(t);
  f.journal.storePdf(f.job, f.bytes);
  assert.equal(f.journal.get(JOB), null);
  assert.equal(f.state.submitted, 0);
  const restarted = new PrintWorker({
    api: f.api,
    journal: new Journal(f.root, DEVICE),
    printer: f.printer,
    lock: f.lock,
    now: () => NOW,
  });
  await restarted.tick();
  assert.equal(f.state.documentCalls, 0);
  assert.equal(f.state.submitted, 1);
  f.state.claims = [f.job];
  await restarted.tick();
  assert.equal(f.state.submitted, 1);
});
test("orphan cache with wrong hash is never adopted or printed", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.journal.pdfPath(JOB), "partial download", { mode: 0o600 });
  await assert.rejects(f.worker.tick(), { code: "LOCAL_STORAGE_FAILURE" });
  assert.equal(f.state.submitted, 0);
  assert.equal(f.journal.get(JOB), null);
});
test("malformed terminal ACK stops with the durable local result intact and no retry loop", async (t) => {
  const f = fixture(t);
  f.journal.save({
    manifest: f.job,
    state: "UNKNOWN",
    cupsJobId: null,
    errorCode: "SUBMISSION_UNCERTAIN",
    acknowledged: false,
  });
  f.api.receipt = async () => {
    throw new AgentError("PROTOCOL_INVALID");
  };
  await assert.rejects(f.worker.tick(), { code: "PROTOCOL_INVALID" });
  assert.equal(f.calls.includes("claim"), false);
  assert.equal(f.journal.get(JOB).state, "UNKNOWN");
  assert.equal(f.journal.get(JOB).acknowledged, false);
  assert.equal(f.state.submitted, 0);
});
test("malformed pre-submit ACK persists UNKNOWN then stops without lp or another receipt", async (t) => {
  const f = fixture(t);
  let receipts = 0;
  f.api.receipt = async () => {
    receipts++;
    throw new AgentError("PROTOCOL_INVALID");
  };
  await assert.rejects(f.worker.tick(), { code: "PROTOCOL_INVALID" });
  assert.equal(receipts, 1);
  assert.equal(f.journal.get(JOB).state, "UNKNOWN");
  assert.equal(f.state.submitted, 0);
});
for (const reconciled of [false, true])
  test(`restart cleans terminal PDF after durable ${reconciled ? "proof" : "ACK"} without lp or another receipt`, async (t) => {
    const f = fixture(t);
    f.journal.storePdf(f.job, f.bytes);
    f.journal.save({
      manifest: f.job,
      state: "FAILED",
      cupsJobId: null,
      errorCode: "PDF_INVALID",
      acknowledged: !reconciled,
      ...(reconciled
        ? { receiptReconciled: true, serverReceipt: terminalProof(f.job) }
        : {}),
    });
    f.state.claims = [null];
    const restarted = new PrintWorker({
      api: f.api,
      journal: new Journal(f.root, DEVICE),
      printer: f.printer,
      lock: f.lock,
      now: () => NOW,
    });
    await restarted.tick();
    assert.equal(fs.existsSync(f.journal.pdfPath(JOB)), false);
    assert.equal(f.state.submitted, 0);
    assert.deepEqual(f.state.receipts, []);
  });
