import * as fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PROFILE, documentPath } from "./constants.mjs";
import { initializeJournal, Journal } from "./journal.mjs";
import { manifest } from "./protocol.mjs";
import { PrintWorker } from "./worker.mjs";

export const DEVICE = "11111111-2222-4333-8444-555555555555";
export const JOB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const TOKEN = Buffer.alloc(32, 7).toString("base64url");
export const CODE = Buffer.alloc(32, 9).toString("base64url");
export const NOW = Date.now();
export function pdf(pages = 1, { wrongSize = false, action = false } = {}) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ")}] >>`,
  ];
  for (let i = 0; i < pages; i++)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wrongSize ? "200" : "141.732283"} 85.03937] /Resources << /Font << /F1 ${pages * 2 + 3} 0 R >> >> /Contents ${pages + i + 3} 0 R ${action ? "/AA << /O << /S /JavaScript /JS (alert) >> >>" : ""} >>`,
    );
  const content = "BT /F1 8 Tf 5 50 Td (SYNTHETIC) Tj ET";
  for (let i = 0; i < pages; i++)
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.3\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
export function jobFor(bytes = pdf(), overrides = {}) {
  return manifest(
    {
      id: JOB,
      entityId: "synthetic-company",
      deviceId: DEVICE,
      status: "CLAIMED",
      pdfSha256: createHash("sha256").update(bytes).digest("hex"),
      pdfBytes: bytes.length,
      pages: 1,
      expiresAt: new Date(NOW + 120_000).toISOString(),
      profile: PROFILE,
      documentPath: documentPath(JOB),
      ...overrides,
    },
    DEVICE,
    NOW,
  );
}
export function fixture(t, options = {}) {
  const root = fs.realpathSync(
    mkdtempSync(join(tmpdir(), "corely-agent-test-")),
  );
  fs.mkdirSync(join(root, "spool"), { mode: 0o700 });
  fs.mkdirSync(join(root, "archive"), { mode: 0o700 });
  initializeJournal(root, DEVICE);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journal = new Journal(root, DEVICE, options.io || fs);
  const bytes = pdf();
  const job = jobFor(bytes);
  const events = [],
    calls = [];
  const state = {
    claims: [job],
    submitted: 0,
    preflight: 0,
    receipts: [],
    documentCalls: 0,
  };
  const api = {
    deviceId: DEVICE,
    async claim() {
      calls.push("claim");
      return state.claims.shift() ?? null;
    },
    async document() {
      state.documentCalls++;
      return bytes;
    },
    async receipt(manifest, receipt) {
      state.receipts.push({ id: manifest.id, ...receipt });
      calls.push(receipt.state);
    },
  };
  const printer = {
    async preflight() {
      state.preflight++;
      calls.push("preflight");
    },
    async print() {
      state.submitted++;
      calls.push("lp");
      return "Xprinter_XP-235B-123";
    },
  };
  const lock = { assertHeld() {}, async release() {} };
  const worker = new PrintWorker({
    api,
    journal,
    printer,
    lock,
    now: () => NOW,
    log: (event) => events.push(event),
  });
  return {
    root,
    journal,
    bytes,
    job,
    events,
    calls,
    state,
    api,
    printer,
    lock,
    worker,
  };
}
