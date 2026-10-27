import { join } from "node:path";
import { homedir } from "node:os";

export const API_BASE =
  "https://corely-erp-api-dev-sp5g377smq-de.a.run.app/api/v1";
export const PROFILE = "xp235b-50x30-v1";
export const QUEUE = "Xprinter_XP-235B";
// The server currently caps documents at 2 MiB, below the absolute 10 MiB ceiling.
export const MAX_PDF_BYTES = 2 * 1024 * 1024;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
export const CUPS_ID = /^Xprinter_XP-235B-[1-9][0-9]*$/;
export const TERMINAL = new Set(["SUBMITTED", "FAILED", "UNKNOWN"]);
export const STATES = new Set(["DOWNLOADED", "SUBMITTING", ...TERMINAL]);
export const ERROR_CODES = new Set([
  "PRINTER_UNAVAILABLE",
  "PDF_INVALID",
  "LOCAL_STORAGE_FAILURE",
  "SUBMISSION_UNCERTAIN",
  "SUBMISSION_FAILED",
  "EXPIRED",
  "DEVICE_REVOKED",
  "AUTHORIZATION_REVOKED",
]);
export const APP_ROOT = join(
  homedir(),
  "Library",
  "Application Support",
  "Corely",
  "Mailroom Print Agent",
);
export const BUNDLE_FILES = [
  "constants.mjs",
  "protocol.mjs",
  "journal.mjs",
  "native.mjs",
  "worker.mjs",
  "pair.mjs",
  "keychain-helper.m",
];
export class AgentError extends Error {
  constructor(code) {
    super(code);
    this.name = "AgentError";
    this.code = code;
  }
}
export class DeviceRevoked extends AgentError {
  constructor() {
    super("DEVICE_REVOKED");
  }
}
export function uuid(value) {
  if (typeof value !== "string" || value.length !== 36 || !UUID.test(value))
    throw new AgentError("PROTOCOL_INVALID");
  return value;
}
export function capability(value) {
  if (
    typeof value !== "string" ||
    !CAPABILITY.test(value) ||
    Buffer.from(value, "base64url").length !== 32 ||
    Buffer.from(value, "base64url").toString("base64url") !== value
  )
    throw new AgentError("CAPABILITY_INVALID");
  return value;
}
export function documentPath(id) {
  return `/api/v1/mailroom/print-device/jobs/${uuid(id)}/document`;
}
export function safeEvent(event, code, id) {
  return JSON.stringify({
    event,
    ...(typeof code === "string" && /^[A-Z_]{1,40}$/.test(code)
      ? { code }
      : {}),
    ...(UUID.test(id || "") ? { jobId: id } : {}),
  });
}
