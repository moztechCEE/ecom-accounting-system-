import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { Journal, atomicJson } from "./journal.mjs";
import { installationPlan } from "./install.mjs";
import { readHiddenCode, pairDevice } from "./pair.mjs";
import { fixture, DEVICE, JOB, CODE, TOKEN } from "./test-fixtures.mjs";
import { readConfig } from "./worker.mjs";

test("missing or corrupt local ledger is a fail-closed condition, never an implicit reset", (t) => {
  const f = fixture(t);
  fs.unlinkSync(join(f.root, "journal.json"));
  assert.throws(() => new Journal(f.root, DEVICE), {
    code: "LOCAL_STORAGE_FAILURE",
  });
  fs.writeFileSync(join(f.root, "journal.json"), "{bad-json", { mode: 0o600 });
  assert.throws(() => new Journal(f.root, DEVICE), {
    code: "LOCAL_STORAGE_FAILURE",
  });
});
test("journal and spool filenames remain bound to exact UUIDs and private permissions", (t) => {
  const f = fixture(t);
  assert.equal(f.journal.pdfPath(JOB), join(f.root, "spool", JOB + ".pdf"));
  for (const unsafe of ["../other", JOB + "/extra", "-o", "file:///tmp/test"])
    assert.throws(() => f.journal.pdfPath(unsafe), {
      code: "PROTOCOL_INVALID",
    });
  assert.equal(fs.statSync(join(f.root, "journal.json")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(join(f.root, "spool")).mode & 0o777, 0o700);
  fs.chmodSync(join(f.root, "journal.json"), 0o644);
  assert.throws(() => new Journal(f.root, DEVICE), {
    code: "LOCAL_STORAGE_FAILURE",
  });
});
test("symlinked ledger and orphan PDF cannot be used to overwrite another local path", (t) => {
  const f = fixture(t);
  const target = join(f.root, "other.json");
  fs.writeFileSync(target, "{}", { mode: 0o600 });
  fs.unlinkSync(join(f.root, "journal.json"));
  fs.symlinkSync(target, join(f.root, "journal.json"));
  assert.throws(() => new Journal(f.root, DEVICE), {
    code: "LOCAL_STORAGE_FAILURE",
  });
  const output = f.journal.pdfPath(JOB);
  fs.symlinkSync(target, output);
  assert.throws(() => f.journal.storePdf(f.job, f.bytes), {
    code: "LOCAL_STORAGE_FAILURE",
  });
  assert.equal(fs.readFileSync(target, "utf8"), "{}");
});
test("atomic journal update fsyncs data before rename and fsyncs parent after rename", (t) => {
  const f = fixture(t),
    trace = [];
  const io = {
    ...fs,
    fsyncSync(fd) {
      trace.push(
        fs.fstatSync(fd).isDirectory() ? "directory-fsync" : "file-fsync",
      );
      fs.fsyncSync(fd);
    },
    renameSync(a, b) {
      trace.push("rename");
      fs.renameSync(a, b);
    },
  };
  atomicJson(
    join(f.root, "journal.json"),
    { schema: 1, deviceId: DEVICE, jobs: {} },
    io,
  );
  assert.deepEqual(trace, ["file-fsync", "rename", "directory-fsync"]);
  assert.equal(
    fs.readdirSync(f.root).some((name) => name.startsWith(".atomic-")),
    false,
  );
});
test("installer plan is deterministic, secret-free, immutable versioned files and a per-user LaunchAgent only", () => {
  const plan = installationPlan(DEVICE, {
    root: "/private/synthetic app",
    home: "/private/synthetic-home",
    node: "/private/node",
  });
  assert.equal(isAbsolute(plan.bundle), true);
  assert.equal(plan.bundleVersion.length, 64);
  assert.equal(plan.bundleVersion, installationPlan(DEVICE).bundleVersion);
  assert.deepEqual(Object.keys(plan.config), [
    "schema",
    "deviceId",
    "bundleVersion",
  ]);
  assert.equal(JSON.stringify(plan).includes(TOKEN), false);
  assert.match(plan.plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plan.plist, /<key>KeepAlive<\/key><false\/>/);
  assert.equal(
    dirname(plan.plistPath),
    "/private/synthetic-home/Library/LaunchAgents",
  );
  assert.equal(plan.plist.includes("launchctl"), false);
  assert.equal(plan.plist.includes("Bearer"), false);
  assert.equal(plan.plist.includes("sudo"), false);
});
test("hidden TTY pairing input never echoes code or token and restores terminal mode", async () => {
  const input = new PassThrough();
  input.isTTY = true;
  const raw = [];
  input.setRawMode = (value) => raw.push(value);
  let visible = "";
  const pending = readHiddenCode(input, {
    write: (text) => {
      visible += text;
    },
  });
  input.write(CODE + "\r");
  assert.equal(await pending, CODE);
  assert.deepEqual(raw, [true, false]);
  assert.equal(visible.includes(CODE), false);
  assert.equal(visible.includes(TOKEN), false);
});
test("one-time pairing makes one redemption and sends returned token only to Keychain stdin adapter", async () => {
  const calls = [];
  await pairDevice(DEVICE, CODE, {
    api: {
      async redeem(code) {
        calls.push(["redeem", code]);
        return TOKEN;
      },
    },
    printer: {
      async storeToken(device, token) {
        calls.push(["keychain", device, token]);
      },
    },
  });
  assert.deepEqual(calls, [
    ["redeem", CODE],
    ["keychain", DEVICE, TOKEN],
  ]);
  let attempts = 0;
  await assert.rejects(
    pairDevice(DEVICE, CODE, {
      api: {
        async redeem() {
          attempts++;
          throw new Error("lost response");
        },
      },
      printer: {
        async storeToken() {
          assert.fail();
        },
      },
    }),
  );
  assert.equal(attempts, 1);
});
test("startup accepts only a private intact immutable bundle and detects code changes before helper execution", (t) => {
  const f = fixture(t);
  const plan = installationPlan(DEVICE, { root: f.root });
  fs.mkdirSync(join(f.root, "versions"), { mode: 0o700 });
  fs.mkdirSync(plan.bundle, { mode: 0o700 });
  try {
    for (const name of plan.files) {
      fs.copyFileSync(join(plan.source, name), join(plan.bundle, name));
      fs.chmodSync(join(plan.bundle, name), 0o400);
    }
    const helper = join(plan.bundle, "keychain-helper");
    fs.writeFileSync(helper, "SYNTHETIC-NOT-EXECUTED", { mode: 0o500 });
    fs.writeFileSync(
      join(plan.bundle, "bundle.json"),
      JSON.stringify({
        sourceSha256: plan.bundleVersion,
        helperSha256: createHash("sha256")
          .update(fs.readFileSync(helper))
          .digest("hex"),
      }),
      { mode: 0o400 },
    );
    fs.chmodSync(plan.bundle, 0o500);
    atomicJson(join(f.root, "config.json"), plan.config);
    assert.deepEqual(readConfig(f.root), { deviceId: DEVICE, helper });
    const file = join(plan.bundle, "worker.mjs");
    fs.chmodSync(file, 0o600);
    fs.appendFileSync(file, "\n// synthetic changed code\n");
    fs.chmodSync(file, 0o400);
    assert.throws(() => readConfig(f.root), { code: "LOCAL_STORAGE_FAILURE" });
    assert.equal(
      fs.readFileSync(join(f.root, "config.json"), "utf8").includes(TOKEN),
      false,
    );
  } finally {
    fs.chmodSync(plan.bundle, 0o700);
  }
});
