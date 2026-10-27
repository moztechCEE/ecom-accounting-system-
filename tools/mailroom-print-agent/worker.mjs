import * as fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  APP_ROOT,
  BUNDLE_FILES,
  AgentError,
  DeviceRevoked,
  TERMINAL,
  safeEvent,
  uuid,
} from "./constants.mjs";
import {
  DeviceApi,
  manifest,
  validatePdf,
  serverReceipt,
} from "./protocol.mjs";
import { Journal } from "./journal.mjs";
import { NativePrinter, acquireLock } from "./native.mjs";

function sameManifest(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function record(job, state, { cupsJobId = null, errorCode = null } = {}) {
  return { manifest: job, state, cupsJobId, errorCode, acknowledged: false };
}
function receipt(entry) {
  return {
    state: entry.state,
    ...(entry.cupsJobId ? { cupsJobId: entry.cupsJobId } : {}),
    ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
  };
}

export class PrintWorker {
  constructor({ api, journal, printer, lock, now = Date.now, log = () => {} }) {
    this.api = api;
    this.journal = journal;
    this.printer = printer;
    this.lock = lock;
    this.now = now;
    this.log = log;
    this.recovered = false;
  }
  emit(event, code, id) {
    this.log(safeEvent(event, code, id));
  }
  reconcile(entry, current) {
    const reconciled = {
      ...entry,
      receiptReconciled: true,
      serverReceipt: serverReceipt(current, entry.manifest),
    };
    // Preserve the original local state/error; this is terminal proof, not an ACK of our different receipt.
    this.journal.save(reconciled);
    this.journal.cleanup(reconciled);
    this.emit(
      "receipt_reconciled",
      reconciled.serverReceipt.status,
      entry.manifest.id,
    );
  }
  async acknowledge(entry) {
    this.lock.assertHeld();
    let result;
    try {
      result = await this.api.receipt(entry.manifest, receipt(entry));
    } catch (error) {
      if (
        !(error instanceof AgentError) ||
        error.code !== "NETWORK_UNAVAILABLE"
      )
        throw error;
      this.emit("receipt_pending", "NETWORK_UNAVAILABLE", entry.manifest.id);
      return false;
    }
    if (result?.reconciled) {
      this.reconcile(entry, result.current);
      return true;
    }
    const acknowledged = { ...entry, acknowledged: true };
    this.journal.save(acknowledged);
    this.journal.cleanup(acknowledged);
    this.emit("receipt_saved", entry.state, entry.manifest.id);
    return true;
  }
  async finish(job, state, errorCode = null, cupsJobId = null) {
    const entry = record(job, state, { errorCode, cupsJobId });
    this.journal.save(entry);
    await this.acknowledge(entry);
  }
  async recoverAndFlush() {
    this.lock.assertHeld();
    if (!this.recovered) {
      for (const entry of this.journal.entries())
        if (entry.state === "SUBMITTING")
          this.journal.save(
            record(entry.manifest, "UNKNOWN", {
              errorCode: "SUBMISSION_UNCERTAIN",
            }),
          );
      this.recovered = true;
    }
    for (const entry of this.journal.entries()) {
      if (
        entry.state === "DOWNLOADED" &&
        Date.parse(entry.manifest.expiresAt) <= this.now()
      ) {
        this.journal.save(
          record(entry.manifest, "FAILED", { errorCode: "EXPIRED" }),
        );
      }
    }
    for (const entry of this.journal.entries()) {
      if (
        TERMINAL.has(entry.state) &&
        (entry.acknowledged || entry.receiptReconciled)
      ) {
        this.journal.cleanup(entry);
        continue;
      }
      if (
        TERMINAL.has(entry.state) &&
        !entry.acknowledged &&
        !entry.receiptReconciled &&
        !(await this.acknowledge(entry))
      )
        return false;
    }
    this.journal.compact();
    return true;
  }
  async tick() {
    if (this.busy) throw new AgentError("INSTANCE_LOCKED");
    this.busy = true;
    try {
      return await this.processTick();
    } finally {
      this.busy = false;
    }
  }
  async processTick() {
    if (!(await this.recoverAndFlush())) return;
    this.lock.assertHeld();
    const claimed = await this.api.claim();
    if (claimed === null) return;
    const job = manifest(claimed, this.api.deviceId, this.now());
    const existing = this.journal.get(job.id);
    if (existing && !sameManifest(existing.manifest, job))
      throw new AgentError("PROTOCOL_INVALID");
    if (existing && TERMINAL.has(existing.state)) {
      // Even an erroneous duplicate server claim may only repeat its receipt.
      if (!existing.acknowledged && !existing.receiptReconciled)
        await this.acknowledge(existing);
      return;
    }
    if (existing && existing.state !== "DOWNLOADED")
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    if (existing) this.journal.readPdf(job);
    else if (this.journal.hasPdf(job.id)) {
      // A crash after PDF fsync but before DOWNLOADED may leave an orphan cache.
      // Adopt only an exact private, hash/byte/page/size-validated file for this fresh CLAIMED manifest.
      this.journal.readPdf(job);
      this.journal.save(record(job, "DOWNLOADED"));
    } else {
      let bytes;
      try {
        bytes = validatePdf(await this.api.document(job), job);
      } catch (error) {
        if (error instanceof DeviceRevoked) throw error;
        if (
          error instanceof AgentError &&
          ["PDF_INVALID", "PROTOCOL_INVALID", "EXPIRED"].includes(error.code)
        ) {
          await this.finish(
            job,
            "FAILED",
            error.code === "EXPIRED" ? "EXPIRED" : "PDF_INVALID",
          );
          return;
        }
        throw error;
      }
      this.lock.assertHeld();
      this.journal.storePdf(job, bytes);
      this.journal.save(record(job, "DOWNLOADED"));
    }
    try {
      await this.printer.preflight();
    } catch {
      await this.finish(job, "FAILED", "PRINTER_UNAVAILABLE");
      return;
    }
    this.lock.assertHeld();
    if (Date.parse(job.expiresAt) <= this.now()) {
      await this.finish(job, "FAILED", "EXPIRED");
      return;
    }
    // This fsynced state precedes even the pre-submit network request.
    this.journal.save(record(job, "SUBMITTING"));
    let submitting;
    try {
      submitting = await this.api.receipt(job, { state: "SUBMITTING" });
    } catch (error) {
      this.journal.save(
        record(job, "UNKNOWN", {
          errorCode:
            error instanceof DeviceRevoked
              ? "DEVICE_REVOKED"
              : "SUBMISSION_UNCERTAIN",
        }),
      );
      if (
        !(error instanceof AgentError) ||
        error.code !== "NETWORK_UNAVAILABLE"
      )
        throw error;
      await this.acknowledge(this.journal.get(job.id));
      return;
    }
    if (submitting?.reconciled) {
      const unknown = record(job, "UNKNOWN", {
        errorCode: "SUBMISSION_UNCERTAIN",
      });
      this.reconcile(unknown, submitting.current);
      return;
    }
    this.lock.assertHeld();
    if (Date.parse(job.expiresAt) <= this.now()) {
      await this.finish(job, "FAILED", "EXPIRED");
      return;
    }
    let cupsJobId;
    try {
      cupsJobId = await this.printer.print(
        job.id,
        this.journal.pdfPath(job.id),
      );
    } catch {
      await this.finish(job, "UNKNOWN", "SUBMISSION_UNCERTAIN");
      return;
    }
    // If saving fails after lp, the prior SUBMITTING record survives for UNKNOWN recovery.
    await this.finish(job, "SUBMITTED", null, cupsJobId);
  }
}

export function readConfig(root = APP_ROOT) {
  try {
    const path = join(root, "config.json");
    const stat = fs.lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 4096
    )
      throw new Error();
    const value = JSON.parse(fs.readFileSync(path, "utf8"));
    if (
      value.schema !== 1 ||
      !/^[a-f0-9]{64}$/.test(value.bundleVersion) ||
      Object.keys(value).some(
        (key) => !["schema", "deviceId", "bundleVersion"].includes(key),
      )
    )
      throw new Error();
    const bundle = join(root, "versions", value.bundleVersion);
    const check = (file, mode, directory = false) => {
      const stat = fs.lstatSync(file);
      if (
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid() ||
        (stat.mode & 0o777) !== mode ||
        (directory ? !stat.isDirectory() : !stat.isFile())
      )
        throw new Error();
    };
    check(bundle, 0o500, true);
    if (fs.realpathSync(bundle) !== bundle) throw new Error();
    const hash = createHash("sha256");
    for (const name of BUNDLE_FILES) {
      check(join(bundle, name), 0o400);
      hash.update(name).update(fs.readFileSync(join(bundle, name)));
    }
    check(join(bundle, "bundle.json"), 0o400);
    const receipt = JSON.parse(
      fs.readFileSync(join(bundle, "bundle.json"), "utf8"),
    );
    const helper = join(bundle, "keychain-helper");
    check(helper, 0o500);
    if (
      hash.digest("hex") !== value.bundleVersion ||
      receipt.sourceSha256 !== value.bundleVersion ||
      receipt.helperSha256 !==
        createHash("sha256").update(fs.readFileSync(helper)).digest("hex")
    )
      throw new Error();
    return { deviceId: uuid(value.deviceId), helper };
  } catch {
    throw new AgentError("LOCAL_STORAGE_FAILURE");
  }
}

export async function main() {
  if (
    process.platform !== "darwin" ||
    Number(process.versions.node.split(".")[0]) < 20
  )
    throw new AgentError("PLATFORM_UNSUPPORTED");
  const config = readConfig();
  const lock = await acquireLock(config.helper);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    // Read the ledger only after owning the native lock; a waiting process must not use stale state.
    const journal = new Journal(APP_ROOT, config.deviceId);
    const printer = new NativePrinter(config.helper, journal.spool);
    const token = await printer.token(config.deviceId);
    const worker = new PrintWorker({
      api: new DeviceApi(config.deviceId, token),
      journal,
      printer,
      lock,
      log: (line) => process.stdout.write(line + "\n"),
    });
    let backoff = 3000;
    while (!stopping) {
      try {
        await worker.tick();
        backoff = 3000;
      } catch (error) {
        if (
          error instanceof DeviceRevoked ||
          !(error instanceof AgentError) ||
          [
            "LOCAL_STORAGE_FAILURE",
            "INSTANCE_LOCKED",
            "PROTOCOL_INVALID",
          ].includes(error.code)
        )
          throw error;
        worker.emit("poll_unavailable", error.code);
        backoff = Math.min(backoff * 2, 30_000);
      }
      if (!stopping) await delay(backoff);
    }
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await lock.release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(
      safeEvent(
        "agent_stopped",
        error instanceof AgentError ? error.code : "LOCAL_STORAGE_FAILURE",
      ) + "\n",
    );
    process.exitCode = 1;
  });
