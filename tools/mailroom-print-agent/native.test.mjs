import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { NativePrinter, acquireLock, readKeychainToken } from "./native.mjs";
import { QUEUE } from "./constants.mjs";
import { DEVICE, JOB, TOKEN } from "./test-fixtures.mjs";

test("preflight accepts only exact fixed CUPS queue and USB Xprinter XP-235B model without logging serial", async () => {
  const calls = [];
  const printer = new NativePrinter("/private/helper", "/private/spool", {
    exec: async (...args) => {
      calls.push(args);
      return "device for Xprinter_XP-235B: usb://Xprinter/XP-235B?serial=PRIVATE-SERIAL\n";
    },
  });
  await printer.preflight();
  assert.equal(calls[0][0], "/usr/bin/lpstat");
  assert.deepEqual(calls[0][1], ["-v", QUEUE]);
});
for (const output of [
  "",
  "device for Other: usb://Xprinter/XP-235B\n",
  "device for Xprinter_XP-235B: ipp://printer.local/XP-235B\n",
  "device for Xprinter_XP-235B: usb://Xprinter/XP-350B\n",
])
  test(`wrong or missing queue fails safely: ${output.trim()}`, async () => {
    const printer = new NativePrinter("/private/helper", "/private/spool", {
      exec: async () => output,
    });
    await assert.rejects(printer.preflight(), { code: "PRINTER_UNAVAILABLE" });
  });
test("lp receives only fixed verified options and a generated absolute UUID PDF path, with no shell/raw/--", async () => {
  const calls = [];
  const printer = new NativePrinter("/private/helper", "/private/spool", {
    exec: async (...args) => {
      calls.push(args);
      return "request id is Xprinter_XP-235B-77 (1 file(s))\n";
    },
  });
  assert.equal(
    await printer.print(JOB, `/private/spool/${JOB}.pdf`),
    "Xprinter_XP-235B-77",
  );
  assert.equal(calls[0][0], "/usr/bin/lp");
  assert.deepEqual(calls[0][1], [
    "-d",
    QUEUE,
    "-n",
    "1",
    "-t",
    `corely-mailroom-${JOB}`,
    "-o",
    "PageSize=Custom.50x30mm",
    "-o",
    "Resolution=203dpi",
    "-o",
    "Origin=Rotation180",
    "-o",
    "MirrorImage=False",
    "-o",
    "NegativeImage=False",
    "-o",
    "orientation-requested=3",
    `/private/spool/${JOB}.pdf`,
  ]);
  assert.equal(calls[0][1].includes("--"), false);
  assert.equal(calls[0][1].includes("raw"), false);
  await assert.rejects(printer.print(JOB, "/tmp/other.pdf"), {
    code: "LOCAL_STORAGE_FAILURE",
  });
  assert.equal(calls.length, 1);
});
for (const output of [
  "printed",
  "request id is Other-77 (1 file(s))\n",
  "request id is Xprinter_XP-235B-0 (1 file(s))\n",
])
  test("missing or wrong CUPS job ID is uncertain", async () => {
    const printer = new NativePrinter("/private/helper", "/private/spool", {
      exec: async () => output,
    });
    await assert.rejects(printer.print(JOB, `/private/spool/${JOB}.pdf`), {
      code: "SUBMISSION_UNCERTAIN",
    });
  });
test("Keychain put sends token only through stdin; get uses private FD3 and never stdout or argv", async () => {
  const calls = [];
  const printer = new NativePrinter("/private/helper", "/private/spool", {
    exec: async (...args) => {
      calls.push(args);
      return "";
    },
    readSecret: async () => TOKEN,
  });
  await printer.storeToken(DEVICE, TOKEN);
  assert.equal(await printer.token(DEVICE), TOKEN);
  assert.deepEqual(calls[0][1], ["put", DEVICE]);
  assert.equal(calls[0][2].input, TOKEN + "\n");
  assert.equal(JSON.stringify(calls[0][1]).includes(TOKEN), false);
  const seen = [];
  const spawn = (file, args, options) => {
    seen.push({ file, args, options });
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.stdio = [null, null, child.stderr, new PassThrough()];
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdio[3].write(TOKEN);
      child.emit("close", 0);
    });
    return child;
  };
  assert.equal(
    await readKeychainToken("/private/helper", DEVICE, { spawn }),
    TOKEN,
  );
  assert.deepEqual(seen[0].options.stdio, ["ignore", "ignore", "pipe", "pipe"]);
  assert.equal(JSON.stringify(seen[0]).includes(TOKEN), false);
});
test("concurrent agents share a native lock; parent pipe EOF releases it without stale PID deletion", async () => {
  let held = false;
  const children = [];
  const spawn = (_file, args, options) => {
    assert.deepEqual(args, ["lock"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let ended = false;
    const close = (code) => {
      if (ended) return;
      ended = true;
      if (child.owns) held = false;
      child.emit("exit", code);
      child.emit("close", code);
    };
    child.stdin = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
      final(done) {
        close(0);
        done();
      },
    });
    child.kill = () => close(1);
    children.push(child);
    if (held) queueMicrotask(() => close(73));
    else {
      held = true;
      child.owns = true;
      queueMicrotask(() => child.stdout.write("LOCKED\n"));
    }
    return child;
  };
  const first = await acquireLock("/private/helper", { spawn });
  await assert.rejects(acquireLock("/private/helper", { spawn }), {
    code: "INSTANCE_LOCKED",
  });
  first.assertHeld();
  await first.release();
  assert.throws(() => first.assertHeld(), { code: "INSTANCE_LOCKED" });
  const restarted = await acquireLock("/private/helper", { spawn });
  restarted.assertHeld();
  await restarted.release();
  assert.equal(held, false);
});
test("preflight supports actual Traditional Chinese lpstat wording while preserving exact USB queue/model", async () => {
  const printer = new NativePrinter("/private/helper", "/private/spool", {
    exec: async () =>
      "Xprinter_XP-235B的裝置：usb://Xprinter/XP-235B?serial=PRIVATE-SERIAL\n",
  });
  await printer.preflight();
});
test("successful CUPS ACK may be Chinese but must contain exactly one complete fixed queue job ID", async () => {
  const printer = new NativePrinter("/private/helper", "/private/spool", {
    exec: async () => "要求識別碼為 Xprinter_XP-235B-77（1 個檔案）\n",
  });
  assert.equal(
    await printer.print(JOB, `/private/spool/${JOB}.pdf`),
    "Xprinter_XP-235B-77",
  );
});
for (const output of [
  "Xprinter_XP-235B-77 Xprinter_XP-235B-78",
  "Xprinter_XP-235B-77 Xprinter_XP-235B-77",
  "Xprinter_XP-235B-77oops",
  "Xprinter_XP-235B-77-8",
  "prefixXprinter_XP-235B-77",
])
  test(`ambiguous or partial CUPS token is uncertain: ${output}`, async () => {
    const printer = new NativePrinter("/private/helper", "/private/spool", {
      exec: async () => output,
    });
    await assert.rejects(printer.print(JOB, `/private/spool/${JOB}.pdf`), {
      code: "SUBMISSION_UNCERTAIN",
    });
  });
