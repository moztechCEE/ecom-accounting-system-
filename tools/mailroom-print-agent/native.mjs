import {
  execFile as nodeExecFile,
  spawn as nodeSpawn,
} from "node:child_process";
import { join, isAbsolute, dirname } from "node:path";
import { AgentError, QUEUE, CUPS_ID, capability, uuid } from "./constants.mjs";

export function execute(
  file,
  args,
  { input, timeout = 10_000, execFile = nodeExecFile } = {},
) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        shell: false,
        encoding: "utf8",
        timeout,
        maxBuffer: 16 * 1024,
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
      },
      (error, stdout) => {
        if (error) reject(new AgentError("NATIVE_UNAVAILABLE"));
        else resolve(stdout);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input === undefined ? undefined : input);
  });
}

export function acquireLock(helper, { spawn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, ["lock"], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let active = false,
      ready = false,
      output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new AgentError("INSTANCE_LOCKED"));
    }, 5000);
    const ended = new Promise((done) =>
      child.once("close", () => {
        active = false;
        done();
      }),
    );
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      if (!ready) reject(new AgentError("INSTANCE_LOCKED"));
    });
    child.on("exit", () => {
      clearTimeout(timer);
      active = false;
      if (!ready) reject(new AgentError("INSTANCE_LOCKED"));
    });
    child.stdout.on("data", (chunk) => {
      if (ready) {
        if (chunk.length) {
          active = false;
          child.kill();
        }
        return;
      }
      output += chunk.toString("utf8");
      if (
        output.length > 128 ||
        (output.includes("\n") && output !== "LOCKED\n")
      ) {
        child.kill();
        reject(new AgentError("INSTANCE_LOCKED"));
        return;
      }
      if (output === "LOCKED\n") {
        clearTimeout(timer);
        ready = true;
        active = true;
        resolve({
          assertHeld() {
            if (!active) throw new AgentError("INSTANCE_LOCKED");
          },
          async release() {
            child.stdin.end();
            await ended;
          },
        });
      }
    });
  });
}

export function readKeychainToken(
  helper,
  deviceId,
  { spawn = nodeSpawn } = {},
) {
  return new Promise((resolve, reject) => {
    // FD 3 is a private pipe; neither the helper nor the CLI writes a token to stdout.
    const child = spawn(helper, ["get", uuid(deviceId)], {
      shell: false,
      stdio: ["ignore", "ignore", "pipe", "pipe"],
    });
    let secret = "",
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
      reject(new AgentError("KEYCHAIN_UNAVAILABLE"));
    }, 10_000);
    child.stderr.on("data", () => {});
    child.stdio[3].on("data", (chunk) => {
      secret += chunk.toString("utf8");
      if (secret.length > 43) {
        failed = true;
        child.kill();
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new AgentError("KEYCHAIN_UNAVAILABLE"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || failed) {
        secret = "";
        reject(new AgentError("KEYCHAIN_UNAVAILABLE"));
        return;
      }
      try {
        resolve(capability(secret));
      } catch {
        reject(new AgentError("KEYCHAIN_UNAVAILABLE"));
      }
      secret = "";
    });
  });
}

export class NativePrinter {
  constructor(
    helper,
    spool,
    { exec = execute, readSecret = readKeychainToken } = {},
  ) {
    this.helper = helper;
    this.spool = spool;
    this.exec = exec;
    this.readSecret = readSecret;
  }
  async token(deviceId) {
    try {
      return capability(await this.readSecret(this.helper, uuid(deviceId)));
    } catch {
      throw new AgentError("KEYCHAIN_UNAVAILABLE");
    }
  }
  async storeToken(deviceId, token) {
    try {
      await this.exec(this.helper, ["put", uuid(deviceId)], {
        input: capability(token) + "\n",
      });
    } catch {
      throw new AgentError("KEYCHAIN_UNAVAILABLE");
    }
  }
  async preflight() {
    try {
      const output = await this.exec("/usr/bin/lpstat", ["-v", QUEUE], {
        timeout: 5000,
      });
      const match = new RegExp(
        `^(?:device for ${QUEUE}:|${QUEUE}\\s*的裝置[：:])\\s*(\\S+)\\s*$`,
      ).exec(output);
      if (!match) throw new Error();
      const uri = new URL(match[1]);
      const model = (uri.hostname + decodeURIComponent(uri.pathname))
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase();
      if (
        uri.protocol !== "usb:" ||
        model !== "xprinterxp235b" ||
        uri.username ||
        uri.password
      )
        throw new Error();
    } catch {
      throw new AgentError("PRINTER_UNAVAILABLE");
    }
  }
  async print(jobId, path) {
    uuid(jobId);
    if (
      !isAbsolute(path) ||
      dirname(path) !== this.spool ||
      path !== join(this.spool, `${jobId}.pdf`)
    )
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    const args = [
      "-d",
      QUEUE,
      "-n",
      "1",
      "-t",
      `corely-mailroom-${jobId}`,
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
      path,
    ];
    try {
      const output = await this.exec("/usr/bin/lp", args, { timeout: 15_000 });
      const ids = [
        ...output.matchAll(
          /(?<![A-Za-z0-9_-])Xprinter_XP-235B-[1-9][0-9]*(?![A-Za-z0-9_-])/g,
        ),
      ].map((match) => match[0]);
      if (ids.length !== 1 || !CUPS_ID.test(ids[0])) throw new Error();
      return ids[0];
    } catch {
      throw new AgentError("SUBMISSION_UNCERTAIN");
    }
  }
}
