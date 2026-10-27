import { createHash } from "node:crypto";
import {
  API_BASE,
  PROFILE,
  MAX_PDF_BYTES,
  TERMINAL,
  ERROR_CODES,
  CUPS_ID,
  AgentError,
  DeviceRevoked,
  documentPath,
  uuid,
  capability,
} from "./constants.mjs";

export function manifest(raw, deviceId, now = Date.now()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AgentError("PROTOCOL_INVALID");
  const id = uuid(raw.id);
  if (
    raw.deviceId !== deviceId ||
    typeof raw.entityId !== "string" ||
    !raw.entityId ||
    raw.entityId.length > 128 ||
    raw.status !== "CLAIMED" ||
    raw.profile !== PROFILE ||
    raw.documentPath !== documentPath(id) ||
    !/^[a-f0-9]{64}$/.test(raw.pdfSha256) ||
    !Number.isSafeInteger(raw.pdfBytes) ||
    raw.pdfBytes < 1 ||
    raw.pdfBytes > MAX_PDF_BYTES ||
    !Number.isInteger(raw.pages) ||
    raw.pages < 1 ||
    raw.pages > 50 ||
    typeof raw.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(raw.expiresAt))
  )
    throw new AgentError("PROTOCOL_INVALID");
  if (now !== null && Date.parse(raw.expiresAt) <= now)
    throw new AgentError("EXPIRED");
  return {
    id,
    entityId: raw.entityId,
    deviceId,
    status: "CLAIMED",
    pdfSha256: raw.pdfSha256,
    pdfBytes: raw.pdfBytes,
    pages: raw.pages,
    expiresAt: raw.expiresAt,
    profile: PROFILE,
    documentPath: documentPath(id),
  };
}

export function validatePdf(bytes, job) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== job.pdfBytes ||
    bytes.length > MAX_PDF_BYTES ||
    bytes
      .subarray(0, 8)
      .toString("ascii")
      .match(/^%PDF-1\.[3-7]/) === null ||
    createHash("sha256").update(bytes).digest("hex") !== job.pdfSha256
  )
    throw new AgentError("PDF_INVALID");
  const raw = bytes.toString("latin1");
  const end = /startxref\s+([0-9]+)\s+%%EOF\s*$/.exec(raw);
  if (!end || !Number.isSafeInteger(Number(end[1])))
    throw new AgentError("PDF_INVALID");
  const table = raw.slice(Number(end[1])).split(/\r?\n/);
  const section = /^0 ([1-9][0-9]*)$/.exec(table[1] || "");
  if (table[0] !== "xref" || !section || Number(section[1]) > 20_000)
    throw new AgentError("PDF_INVALID");
  for (let index = 0; index < Number(section[1]); index++) {
    const entry = /^([0-9]{10}) ([0-9]{5}) ([nf])\s*$/.exec(
      table[index + 2] || "",
    );
    if (
      !entry ||
      (index === 0 && entry[3] !== "f") ||
      (entry[3] === "n" &&
        !raw
          .slice(Number(entry[1]))
          .startsWith(`${index} ${Number(entry[2])} obj`))
    )
      throw new AgentError("PDF_INVALID");
  }
  if (table[Number(section[1]) + 2] !== "trailer")
    throw new AgentError("PDF_INVALID");
  // Accept only the classic, non-object-stream PDFKit structure produced by this profile.
  const structure = raw.replace(
    /(?:^|\n)stream\r?\n[\s\S]*?\r?\nendstream/g,
    "\nendstream",
  );
  if (
    /\/(?:Encrypt|ObjStm|JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|URI|GoToR|RichMedia|AcroForm)\b/.test(
      structure,
    )
  )
    throw new AgentError("PDF_INVALID");
  const pages = [
    ...structure.matchAll(/(?:^|\n)\d+\s+\d+\s+obj\b([\s\S]*?)endobj/g),
  ]
    .map((match) => match[1])
    .filter((body) => /\/Type\s*\/Page\b/.test(body));
  if (pages.length !== job.pages) throw new AgentError("PDF_INVALID");
  for (const page of pages) {
    const box =
      /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(
        page,
      );
    if (
      !box ||
      Number(box[1]) !== 0 ||
      Number(box[2]) !== 0 ||
      Math.abs(Number(box[3]) - (50 * 72) / 25.4) > 0.001 ||
      Math.abs(Number(box[4]) - (30 * 72) / 25.4) > 0.001
    )
      throw new AgentError("PDF_INVALID");
  }
  return bytes;
}

export function serverReceipt(raw, job) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    raw.id !== job.id ||
    raw.deviceId !== job.deviceId ||
    !TERMINAL.has(raw.status) ||
    raw.pages !== job.pages ||
    raw.expiresAt !== job.expiresAt ||
    raw.reprintOf === undefined ||
    raw.cupsJobId === undefined ||
    raw.errorCode === undefined
  )
    throw new AgentError("PROTOCOL_INVALID");
  uuid(raw.requestId);
  if (raw.reprintOf !== null) uuid(raw.reprintOf);
  if (
    raw.status === "SUBMITTED"
      ? typeof raw.cupsJobId !== "string" ||
        raw.cupsJobId !== raw.cupsJobId.trim() ||
        !CUPS_ID.test(raw.cupsJobId) ||
        raw.errorCode !== null
      : raw.cupsJobId !== null || !ERROR_CODES.has(raw.errorCode)
  )
    throw new AgentError("PROTOCOL_INVALID");
  return {
    id: job.id,
    requestId: raw.requestId,
    deviceId: job.deviceId,
    status: raw.status,
    pages: raw.pages,
    expiresAt: raw.expiresAt,
    cupsJobId: raw.cupsJobId,
    errorCode: raw.errorCode,
    reprintOf: raw.reprintOf,
  };
}

async function boundedBody(response, maximum) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > maximum))
    throw new AgentError("PROTOCOL_INVALID");
  const reader = response.body?.getReader();
  if (!reader) throw new AgentError("PROTOCOL_INVALID");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new AgentError("PROTOCOL_INVALID");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (length !== null && size !== Number(length))
    throw new AgentError("PROTOCOL_INVALID");
  return Buffer.concat(chunks);
}

async function responseJson(response) {
  if (
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new AgentError("PROTOCOL_INVALID");
  try {
    return JSON.parse(
      (await boundedBody(response, 64 * 1024)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError("PROTOCOL_INVALID");
  }
}

export class DeviceApi {
  constructor(deviceId, token, { transport = globalThis.fetch } = {}) {
    this.deviceId = uuid(deviceId);
    this.token = token === null ? null : capability(token);
    this.transport = transport;
  }
  async request(method, path, body, { terminalConflict = false } = {}) {
    if (
      !/^\/mailroom\/print-device\/(?:claim|redeem|jobs\/[0-9a-f-]{36}\/(?:document|receipt))$/.test(
        path,
      )
    )
      throw new AgentError("PROTOCOL_INVALID");
    let response;
    try {
      response = await this.transport(API_BASE + path, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "x-corely-print-device": this.deviceId,
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new AgentError("NETWORK_UNAVAILABLE");
    }
    if (response.status === 401 || response.status === 403)
      throw new DeviceRevoked();
    if (
      response.redirected ||
      (response.url && response.url !== API_BASE + path)
    )
      throw new AgentError("PROTOCOL_INVALID");
    if (
      response.status === 429 ||
      (response.status >= 500 && response.status <= 599)
    )
      throw new AgentError("NETWORK_UNAVAILABLE");
    if (
      method === "GET" &&
      /^\/mailroom\/print-device\/jobs\/[0-9a-f-]{36}\/document$/.test(path) &&
      [404, 410].includes(response.status)
    )
      throw new AgentError("EXPIRED");
    if (
      (response.status < 200 || response.status >= 300) &&
      !(terminalConflict && response.status === 409)
    )
      throw new AgentError("PROTOCOL_INVALID");
    return response;
  }
  async json(method, path, body) {
    const response = await this.request(method, path, body);
    return responseJson(response);
  }
  async redeem(code) {
    if (this.token !== null) throw new AgentError("PROTOCOL_INVALID");
    const response = await this.json("POST", "/mailroom/print-device/redeem", {
      deviceId: this.deviceId,
      code: capability(code),
    });
    if (response.deviceId !== this.deviceId)
      throw new AgentError("PROTOCOL_INVALID");
    return capability(response.token);
  }
  async claim() {
    if (!this.token) throw new AgentError("CAPABILITY_INVALID");
    const response = await this.json(
      "POST",
      "/mailroom/print-device/claim",
      {},
    );
    if (!response || !Object.hasOwn(response, "job"))
      throw new AgentError("PROTOCOL_INVALID");
    return response.job === null ? null : manifest(response.job, this.deviceId);
  }
  async document(job) {
    manifest(job, this.deviceId);
    // Derive the route locally even after verifying the supplied manifest path.
    const response = await this.request(
      "GET",
      `/mailroom/print-device/jobs/${uuid(job.id)}/document`,
    );
    if (
      response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/pdf"
    )
      throw new AgentError("PDF_INVALID");
    return validatePdf(await boundedBody(response, MAX_PDF_BYTES), job);
  }
  async receipt(job, receipt) {
    const http = await this.request(
      "POST",
      `/mailroom/print-device/jobs/${uuid(job.id)}/receipt`,
      receipt,
      { terminalConflict: true },
    );
    const response = await responseJson(http);
    if (http.status === 409) {
      if (response.message !== "PRINT_RECEIPT_TERMINAL_CONFLICT")
        throw new AgentError("PROTOCOL_INVALID");
      return {
        reconciled: true,
        current: serverReceipt(response.current, job),
      };
    }
    if (
      response.id !== job.id ||
      response.deviceId !== this.deviceId ||
      response.status !== receipt.state ||
      (response.cupsJobId ?? null) !== (receipt.cupsJobId ?? null) ||
      (response.errorCode ?? null) !== (receipt.errorCode ?? null)
    )
      throw new AgentError("PROTOCOL_INVALID");
  }
}
