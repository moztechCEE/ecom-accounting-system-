import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  API_BASE,
  MAX_PDF_BYTES,
  DeviceRevoked,
  safeEvent,
} from "./constants.mjs";
import { DeviceApi, validatePdf, manifest } from "./protocol.mjs";
import {
  DEVICE,
  JOB,
  TOKEN,
  CODE,
  jobFor,
  pdf,
  NOW,
} from "./test-fixtures.mjs";

const response = (value, status = 201) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
test("HTTPS transport uses only fixed DEV URL/device headers and rejects arbitrary route input", async () => {
  const calls = [];
  const api = new DeviceApi(DEVICE, TOKEN, {
    transport: async (url, options) => {
      calls.push({ url, options });
      return response({ job: null });
    },
  });
  assert.equal(await api.claim(), null);
  assert.equal(calls[0].url, API_BASE + "/mailroom/print-device/claim");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["x-corely-print-device"], DEVICE);
  assert.equal(calls[0].options.headers.Authorization, "Bearer " + TOKEN);
  await assert.rejects(api.request("GET", "https://evil.test/document"), {
    code: "PROTOCOL_INVALID",
  });
  assert.equal(calls.length, 1);
});
for (const status of [301, 302, 307, 308])
  test(`server redirect ${status} never fetches its Location`, async () => {
    let calls = 0;
    const api = new DeviceApi(DEVICE, TOKEN, {
      transport: async () => {
        calls++;
        return new Response(null, {
          status,
          headers: { location: "https://evil.test/token" },
        });
      },
    });
    await assert.rejects(api.claim(), { code: "PROTOCOL_INVALID" });
    assert.equal(calls, 1);
  });
for (const status of [401, 403])
  test(`device HTTP ${status} is a stop condition`, async () => {
    const api = new DeviceApi(DEVICE, TOKEN, {
      transport: async () => new Response(null, { status }),
    });
    await assert.rejects(api.claim(), DeviceRevoked);
  });
test("redeem returns a validated token without logging or returning it from pairing UI output", async () => {
  const calls = [];
  const api = new DeviceApi(DEVICE, null, {
    transport: async (url, options) => {
      calls.push({ url, options });
      return response({ deviceId: DEVICE, token: TOKEN });
    },
  });
  assert.equal(await api.redeem(CODE), TOKEN);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    deviceId: DEVICE,
    code: CODE,
  });
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].url, API_BASE + "/mailroom/print-device/redeem");
});
test("document uses derived fixed UUID route and checks PDF content type/bytes/hash/structure", async () => {
  const bytes = pdf(),
    job = jobFor(bytes);
  const urls = [];
  const api = new DeviceApi(DEVICE, TOKEN, {
    transport: async (url) => {
      urls.push(url);
      return new Response(bytes, {
        headers: {
          "content-type": "application/pdf",
          "content-length": String(bytes.length),
        },
      });
    },
  });
  assert.deepEqual(await api.document(job), bytes);
  assert.deepEqual(urls, [
    API_BASE + `/mailroom/print-device/jobs/${JOB}/document`,
  ]);
});
test("rejects wrong content type and oversized body before any printing path", async () => {
  const bytes = pdf(),
    job = jobFor(bytes);
  const api = new DeviceApi(DEVICE, TOKEN, {
    transport: async () =>
      new Response(bytes, { headers: { "content-type": "text/html" } }),
  });
  await assert.rejects(api.document(job), { code: "PDF_INVALID" });
  api.transport = async () =>
    new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(MAX_PDF_BYTES + 1),
      },
    });
  await assert.rejects(api.document(job), { code: "PROTOCOL_INVALID" });
});
test("receipt ACK must match exact job/device/state and CUPS result", async () => {
  const job = jobFor();
  const body = { state: "SUBMITTED", cupsJobId: "Xprinter_XP-235B-77" };
  const api = new DeviceApi(DEVICE, TOKEN, {
    transport: async () =>
      response({
        id: JOB,
        deviceId: DEVICE,
        status: body.state,
        cupsJobId: body.cupsJobId,
        errorCode: null,
      }),
  });
  await api.receipt(job, body);
  api.transport = async () =>
    response({ id: JOB, deviceId: DEVICE, status: "CLAIMED", cupsJobId: null });
  await assert.rejects(api.receipt(job, body), { code: "PROTOCOL_INVALID" });
});
for (const kind of [
  "page-count",
  "paper-size",
  "active-content",
  "xref",
  "hash",
  "magic",
])
  test(`PDF validation rejects ${kind}`, () => {
    let bytes = pdf();
    let job = jobFor(bytes);
    if (kind === "page-count") job = { ...job, pages: 2 };
    if (kind === "paper-size") {
      bytes = pdf(1, { wrongSize: true });
      job = jobFor(bytes);
    }
    if (kind === "active-content") {
      bytes = pdf(1, { action: true });
      job = jobFor(bytes);
    }
    if (kind === "xref") {
      bytes = Buffer.from(
        bytes.toString("latin1").replace(/startxref\n[0-9]+/, "startxref\n1"),
        "latin1",
      );
      job = jobFor(bytes);
    }
    if (kind === "hash") job = { ...job, pdfSha256: "a".repeat(64) };
    if (kind === "magic") {
      bytes = Buffer.from(bytes);
      bytes[0] = 0;
      job = jobFor(bytes);
    }
    assert.throws(() => validatePdf(bytes, job), { code: "PDF_INVALID" });
  });
test("valid 50-page PDF is accepted, but a forged manifest cannot exceed device/profile/page/expiry constraints", () => {
  const bytes = pdf(50),
    job = jobFor(bytes, { pages: 50 });
  assert.deepEqual(validatePdf(bytes, job), bytes);
  for (const changes of [
    { pages: 51 },
    { pdfBytes: MAX_PDF_BYTES + 1 },
    { pdfSha256: "../escape" },
    { deviceId: JOB },
    { profile: "raw-tspl" },
    { documentPath: "https://evil.test" },
  ])
    assert.throws(() => manifest({ ...job, ...changes }, DEVICE, NOW), {
      code: "PROTOCOL_INVALID",
    });
  assert.throws(
    () =>
      manifest({ ...job, expiresAt: new Date(NOW).toISOString() }, DEVICE, NOW),
    { code: "EXPIRED" },
  );
});
test("network exceptions and events cannot expose capabilities or server error text", async () => {
  const api = new DeviceApi(DEVICE, TOKEN, {
    transport: async () => {
      throw new Error(TOKEN + CODE);
    },
  });
  await assert.rejects(
    api.claim(),
    (error) =>
      error.message === "NETWORK_UNAVAILABLE" &&
      !JSON.stringify(error).includes(TOKEN),
  );
  assert.equal(safeEvent("agent_stopped", TOKEN, CODE).includes(TOKEN), false);
  assert.equal(createHash("sha256").update(pdf()).digest("hex").length, 64);
});
test("typed authenticated terminal 409 returns bounded proof and preserves distinct server result", async () => {
  const job = jobFor();
  const current = {
    id: JOB,
    requestId: DEVICE,
    deviceId: DEVICE,
    status: "FAILED",
    pages: 1,
    expiresAt: job.expiresAt,
    cupsJobId: null,
    errorCode: "EXPIRED",
    reprintOf: null,
  };
  const api = new DeviceApi(DEVICE, TOKEN, {
    transport: async () =>
      response({ message: "PRINT_RECEIPT_TERMINAL_CONFLICT", current }, 409),
  });
  assert.deepEqual(
    await api.receipt(job, {
      state: "UNKNOWN",
      errorCode: "SUBMISSION_UNCERTAIN",
    }),
    { reconciled: true, current },
  );
});
for (const [field, value] of [
  ["id", DEVICE],
  ["deviceId", JOB],
  ["status", "CLAIMED"],
  ["pages", 2],
  ["expiresAt", "2099-01-01"],
  ["cupsJobId", "other-1"],
  ["errorCode", "UNTRUSTED"],
])
  test(`terminal conflict with wrong ${field} is not accepted as ACK or proof`, async () => {
    const job = jobFor();
    const current = {
      id: JOB,
      requestId: DEVICE,
      deviceId: DEVICE,
      status: "FAILED",
      pages: 1,
      expiresAt: job.expiresAt,
      cupsJobId: null,
      errorCode: "EXPIRED",
      reprintOf: null,
      [field]: value,
    };
    const api = new DeviceApi(DEVICE, TOKEN, {
      transport: async () =>
        response({ message: "PRINT_RECEIPT_TERMINAL_CONFLICT", current }, 409),
    });
    await assert.rejects(
      api.receipt(job, { state: "UNKNOWN", errorCode: "SUBMISSION_UNCERTAIN" }),
      { code: "PROTOCOL_INVALID" },
    );
  });
for (const status of [429, 500, 502, 503, 504])
  test(`temporary HTTP ${status} can recover on the next claim without protocol stop`, async () => {
    let calls = 0;
    const api = new DeviceApi(DEVICE, TOKEN, {
      transport: async () =>
        ++calls === 1
          ? new Response(null, { status })
          : response({ job: null }),
    });
    await assert.rejects(api.claim(), { code: "NETWORK_UNAVAILABLE" });
    assert.equal(await api.claim(), null);
    assert.equal(calls, 2);
  });
for (const status of [404, 410])
  test(`expired fixed document HTTP ${status} is a known pre-lp unavailability, not a global protocol fault`, async () => {
    const api = new DeviceApi(DEVICE, TOKEN, {
      transport: async () => new Response(null, { status }),
    });
    await assert.rejects(api.document(jobFor()), { code: "EXPIRED" });
    await assert.rejects(api.claim(), { code: "PROTOCOL_INVALID" });
  });
