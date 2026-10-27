import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AgentError,
  STATES,
  TERMINAL,
  CUPS_ID,
  ERROR_CODES,
  uuid,
} from "./constants.mjs";
import { manifest, validatePdf, serverReceipt } from "./protocol.mjs";

function privateStat(path, directory, io = fs) {
  const stat = io.lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)
  )
    throw new AgentError("LOCAL_STORAGE_FAILURE");
}
export function atomicJson(path, value, io = fs) {
  const directory = resolve(path, "..");
  privateStat(directory, true, io);
  const temp = join(directory, `.atomic-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = io.openSync(
      temp,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    io.writeFileSync(descriptor, JSON.stringify(value));
    io.fsyncSync(descriptor);
    io.closeSync(descriptor);
    descriptor = undefined;
    io.renameSync(temp, path);
    const parent = io.openSync(directory, fs.constants.O_RDONLY);
    try {
      io.fsyncSync(parent);
    } finally {
      io.closeSync(parent);
    }
  } catch {
    throw new AgentError("LOCAL_STORAGE_FAILURE");
  } finally {
    if (descriptor !== undefined) io.closeSync(descriptor);
    try {
      io.unlinkSync(temp);
    } catch {}
  }
}
export function initializeJournal(root, deviceId, io = fs) {
  uuid(deviceId);
  privateStat(root, true, io);
  privateStat(join(root, "spool"), true, io);
  privateStat(join(root, "archive"), true, io);
  const path = join(root, "journal.json");
  if (io.existsSync(path)) {
    new Journal(root, deviceId, io);
    return;
  }
  atomicJson(path, { schema: 1, deviceId, jobs: {} }, io);
}
export class Journal {
  constructor(
    root,
    deviceId,
    io = fs,
    {
      compactBytes = 1024 * 1024,
      compactEntries = 1000,
      keepRecent = 200,
    } = {},
  ) {
    this.root = resolve(root);
    this.deviceId = uuid(deviceId);
    this.io = io;
    this.path = join(this.root, "journal.json");
    this.spool = join(this.root, "spool");
    this.archive = join(this.root, "archive");
    this.compactBytes = compactBytes;
    this.compactEntries = compactEntries;
    this.keepRecent = keepRecent;
    try {
      if (
        ![compactBytes, compactEntries].every(
          (value) => Number.isSafeInteger(value) && value > 0,
        ) ||
        !Number.isSafeInteger(keepRecent) ||
        keepRecent < 0
      )
        throw new Error();
      privateStat(this.root, true, io);
      privateStat(this.spool, true, io);
      privateStat(this.archive, true, io);
      privateStat(this.path, false, io);
      if (
        io.realpathSync(this.root) !== this.root ||
        io.realpathSync(this.spool) !== this.spool ||
        io.realpathSync(this.archive) !== this.archive ||
        io.statSync(this.path).size > 8 * 1024 * 1024
      )
        throw new Error();
      this.data = JSON.parse(io.readFileSync(this.path, "utf8"));
      if (
        this.data.schema !== 1 ||
        this.data.deviceId !== deviceId ||
        !this.data.jobs ||
        typeof this.data.jobs !== "object" ||
        Array.isArray(this.data.jobs)
      )
        throw new Error();
      for (const [id, entry] of Object.entries(this.data.jobs))
        this.validate(entry, id);
    } catch {
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    }
  }
  validate(entry, id) {
    uuid(id);
    if (
      !entry ||
      entry.manifest?.id !== id ||
      !STATES.has(entry.state) ||
      typeof entry.acknowledged !== "boolean"
    )
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    manifest(entry.manifest, this.deviceId, null);
    if (
      entry.state === "SUBMITTED"
        ? !CUPS_ID.test(entry.cupsJobId) || entry.errorCode != null
        : entry.cupsJobId != null
    )
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    if (
      ["FAILED", "UNKNOWN"].includes(entry.state)
        ? !ERROR_CODES.has(entry.errorCode)
        : entry.errorCode != null
    )
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    if (!TERMINAL.has(entry.state) && entry.acknowledged)
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    if (
      entry.receiptReconciled !== undefined &&
      typeof entry.receiptReconciled !== "boolean"
    )
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    if (entry.receiptReconciled) {
      if (!TERMINAL.has(entry.state) || entry.acknowledged)
        throw new AgentError("LOCAL_STORAGE_FAILURE");
      serverReceipt(entry.serverReceipt, entry.manifest);
    } else if (entry.serverReceipt !== undefined)
      throw new AgentError("LOCAL_STORAGE_FAILURE");
  }
  entries() {
    return Object.values(structuredClone(this.data.jobs));
  }
  get(id) {
    uuid(id);
    return this.data.jobs[id]
      ? structuredClone(this.data.jobs[id])
      : this.readArchive(id);
  }
  readArchive(id) {
    const path = join(this.archive, `${uuid(id)}.json`);
    try {
      try {
        this.io.lstatSync(path);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      privateStat(this.archive, true, this.io);
      privateStat(path, false, this.io);
      if (this.io.statSync(path).size > 32 * 1024) throw new Error();
      const entry = JSON.parse(this.io.readFileSync(path, "utf8"));
      this.validate(entry, id);
      if (
        !["SUBMITTED", "FAILED"].includes(entry.state) ||
        !entry.acknowledged ||
        entry.receiptReconciled
      )
        throw new Error();
      return entry;
    } catch {
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    }
  }
  save(entry) {
    this.validate(entry, entry.manifest.id);
    if (
      !this.data.jobs[entry.manifest.id] &&
      this.readArchive(entry.manifest.id)
    )
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    const next = structuredClone(this.data);
    next.jobs[entry.manifest.id] = structuredClone(entry);
    atomicJson(this.path, next, this.io);
    this.data = next;
  }
  compact() {
    const entries = this.entries();
    if (
      entries.length < this.compactEntries &&
      Buffer.byteLength(JSON.stringify(this.data)) < this.compactBytes
    )
      return;
    const eligible = entries
      .filter(
        (entry) =>
          ["SUBMITTED", "FAILED"].includes(entry.state) &&
          entry.acknowledged &&
          !entry.receiptReconciled &&
          !this.hasPdf(entry.manifest.id),
      )
      .sort(
        (a, b) =>
          Date.parse(a.manifest.expiresAt) - Date.parse(b.manifest.expiresAt) ||
          a.manifest.id.localeCompare(b.manifest.id),
      );
    const removing = eligible.slice(
      0,
      Math.max(0, eligible.length - this.keepRecent),
    );
    if (!removing.length) return;
    try {
      for (const entry of removing) {
        const path = join(this.archive, `${entry.manifest.id}.json`);
        const existing = this.readArchive(entry.manifest.id);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(entry))
            throw new Error();
          // A previous crash may have left both copies; re-fsync the archive before removing the live copy.
          const file = this.io.openSync(
            path,
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
          );
          try {
            this.io.fsyncSync(file);
          } finally {
            this.io.closeSync(file);
          }
          const directory = this.io.openSync(
            this.archive,
            fs.constants.O_RDONLY,
          );
          try {
            this.io.fsyncSync(directory);
          } finally {
            this.io.closeSync(directory);
          }
        } else atomicJson(path, entry, this.io);
      }
      const next = structuredClone(this.data);
      for (const entry of removing) delete next.jobs[entry.manifest.id];
      atomicJson(this.path, next, this.io);
      this.data = next;
    } catch {
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    }
  }
  pdfPath(id) {
    return join(this.spool, `${uuid(id)}.pdf`);
  }
  hasPdf(id) {
    try {
      this.io.lstatSync(this.pdfPath(id));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    }
  }
  storePdf(job, bytes) {
    validatePdf(bytes, job);
    const target = this.pdfPath(job.id);
    let fd;
    try {
      privateStat(this.spool, true, this.io);
      fd = this.io.openSync(
        target,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      this.io.writeFileSync(fd, bytes);
      this.io.fsyncSync(fd);
      this.io.closeSync(fd);
      fd = undefined;
      const parent = this.io.openSync(this.spool, fs.constants.O_RDONLY);
      try {
        this.io.fsyncSync(parent);
      } finally {
        this.io.closeSync(parent);
      }
    } catch {
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    } finally {
      if (fd !== undefined) this.io.closeSync(fd);
    }
  }
  readPdf(job) {
    try {
      privateStat(this.pdfPath(job.id), false, this.io);
      return validatePdf(this.io.readFileSync(this.pdfPath(job.id)), job);
    } catch {
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    }
  }
  cleanup(entry) {
    if (
      !TERMINAL.has(entry.state) ||
      (!entry.acknowledged && !entry.receiptReconciled)
    )
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    try {
      const path = this.pdfPath(entry.manifest.id);
      if (!this.io.existsSync(path)) return;
      privateStat(path, false, this.io);
      this.io.unlinkSync(path);
      const parent = this.io.openSync(this.spool, fs.constants.O_RDONLY);
      try {
        this.io.fsyncSync(parent);
      } finally {
        this.io.closeSync(parent);
      }
    } catch {
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    }
  }
}
