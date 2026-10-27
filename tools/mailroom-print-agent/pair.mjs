import { pathToFileURL } from "node:url";
import {
  APP_ROOT,
  AgentError,
  capability,
  safeEvent,
  uuid,
} from "./constants.mjs";
import { DeviceApi } from "./protocol.mjs";
import { NativePrinter } from "./native.mjs";
import { readConfig } from "./worker.mjs";

export function readHiddenCode(input = process.stdin, output = process.stderr) {
  return new Promise((resolve, reject) => {
    let code = "";
    const tty = !!input.isTTY;
    if (tty && typeof input.setRawMode !== "function") {
      reject(new AgentError("CAPABILITY_INVALID"));
      return;
    }
    const finish = (error) => {
      input.off("data", data);
      input.off("end", end);
      input.off("error", fail);
      if (tty) {
        input.setRawMode(false);
        output.write("\n");
      }
      input.pause();
      if (error) reject(error);
      else {
        try {
          resolve(capability(code));
        } catch {
          reject(new AgentError("CAPABILITY_INVALID"));
        }
      }
      code = "";
    };
    const fail = () => finish(new AgentError("CAPABILITY_INVALID"));
    const end = () => {
      code = code.replace(/\r?\n$/, "");
      finish();
    };
    const data = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (tty && (character === "\r" || character === "\n")) {
          finish();
          return;
        }
        if (character === "\u0003") {
          fail();
          return;
        }
        if (tty && (character === "\u007f" || character === "\b"))
          code = code.slice(0, -1);
        else code += character;
        if (code.length > 64) {
          fail();
          return;
        }
      }
    };
    input.on("data", data);
    input.once("end", end);
    input.once("error", fail);
    if (tty) {
      output.write("配對碼：");
      input.setRawMode(true);
    }
    input.resume();
  });
}

export async function pairDevice(deviceId, code, { api, printer } = {}) {
  uuid(deviceId);
  capability(code);
  const token = await api.redeem(code); // Single attempt: a lost redemption response is never retried automatically.
  await printer.storeToken(deviceId, token);
}
export async function main(args = process.argv.slice(2)) {
  if (
    process.platform !== "darwin" ||
    args.length !== 2 ||
    args[0] !== "--device"
  )
    throw new AgentError("PAIR_USAGE");
  const deviceId = uuid(args[1]);
  const config = readConfig();
  if (deviceId !== config.deviceId) throw new AgentError("PROTOCOL_INVALID");
  const code = await readHiddenCode();
  await pairDevice(deviceId, code, {
    api: new DeviceApi(deviceId, null),
    printer: new NativePrinter(config.helper, APP_ROOT + "/spool"),
  });
  process.stdout.write("配對完成。\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(
      safeEvent(
        "pair_failed",
        error instanceof AgentError ? error.code : "LOCAL_STORAGE_FAILURE",
      ) + "\n",
    );
    process.exitCode = 1;
  });
