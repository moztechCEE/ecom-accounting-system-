import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  APP_ROOT,
  BUNDLE_FILES,
  AgentError,
  safeEvent,
  uuid,
} from "./constants.mjs";
import { atomicJson, initializeJournal } from "./journal.mjs";
import { execute } from "./native.mjs";
import { readConfig } from "./worker.mjs";

const xml = (value) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export function installationPlan(
  deviceId,
  {
    root = APP_ROOT,
    node = process.execPath,
    source = dirname(fileURLToPath(import.meta.url)),
    home = homedir(),
  } = {},
) {
  uuid(deviceId);
  if (
    !isAbsolute(root) ||
    !isAbsolute(node) ||
    !isAbsolute(home) ||
    /[\r\n\0]/.test(root + node + home)
  )
    throw new AgentError("LOCAL_STORAGE_FAILURE");
  const hash = createHash("sha256");
  for (const name of BUNDLE_FILES)
    hash.update(name).update(fs.readFileSync(join(source, name)));
  const bundleVersion = hash.digest("hex");
  const bundle = join(root, "versions", bundleVersion);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>cc.corely.mailroom-print-agent.dev</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(join(bundle, "worker.mjs"))}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>30</integer><key>StandardOutPath</key><string>${xml(join(root, "agent.out.log"))}</string><key>StandardErrorPath</key><string>${xml(join(root, "agent.err.log"))}</string></dict></plist>\n`;
  return {
    deviceId,
    root,
    bundleVersion,
    bundle,
    source,
    files: [...BUNDLE_FILES],
    config: { schema: 1, deviceId, bundleVersion },
    plistPath: join(
      home,
      "Library",
      "LaunchAgents",
      "cc.corely.mailroom-print-agent.dev.plist",
    ),
    plist,
  };
}
function directory(path) {
  fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o700
  )
    throw new AgentError("LOCAL_STORAGE_FAILURE");
}
export async function install(deviceId) {
  if (
    process.platform !== "darwin" ||
    process.getuid() === 0 ||
    Number(process.versions.node.split(".")[0]) < 20
  )
    throw new AgentError("PLATFORM_UNSUPPORTED");
  const plan = installationPlan(deviceId);
  directory(plan.root);
  directory(join(plan.root, "spool"));
  directory(join(plan.root, "archive"));
  directory(join(plan.root, "versions"));
  const configPath = join(plan.root, "config.json");
  if (fs.existsSync(configPath)) {
    const stat = fs.lstatSync(configPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== 0o600
    )
      throw new AgentError("LOCAL_STORAGE_FAILURE");
    const previous = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (previous.deviceId !== deviceId)
      throw new AgentError("DEVICE_CONFIG_CONFLICT");
    if (!fs.existsSync(join(plan.root, "journal.json")))
      throw new AgentError("LOCAL_STORAGE_FAILURE");
  }
  // Installer never resets an existing ledger, including unresolved jobs.
  initializeJournal(plan.root, deviceId);
  if (!fs.existsSync(plan.bundle)) {
    const stage = join(plan.root, "versions", `.install-${randomUUID()}`);
    directory(stage);
    for (const name of plan.files) {
      fs.copyFileSync(
        join(plan.source, name),
        join(stage, name),
        fs.constants.COPYFILE_EXCL,
      );
      fs.chmodSync(join(stage, name), 0o400);
    }
    await execute(
      "/usr/bin/clang",
      [
        "-fobjc-arc",
        "-O2",
        "-framework",
        "Foundation",
        "-framework",
        "Security",
        join(stage, "keychain-helper.m"),
        "-o",
        join(stage, "keychain-helper"),
      ],
      { timeout: 30_000 },
    );
    fs.chmodSync(join(stage, "keychain-helper"), 0o500);
    fs.writeFileSync(
      join(stage, "bundle.json"),
      JSON.stringify({
        sourceSha256: plan.bundleVersion,
        helperSha256: createHash("sha256")
          .update(fs.readFileSync(join(stage, "keychain-helper")))
          .digest("hex"),
      }),
      { mode: 0o400, flag: "wx" },
    );
    fs.chmodSync(stage, 0o500);
    fs.renameSync(stage, plan.bundle);
  }
  atomicJson(configPath, plan.config);
  readConfig(plan.root);
  const agents = dirname(plan.plistPath);
  fs.mkdirSync(agents, { recursive: true });
  const fd = fs.openSync(
    plan.plistPath,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_TRUNC |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, plan.plist);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (const name of ["agent.out.log", "agent.err.log"]) {
    const log = fs.openSync(
      join(plan.root, name),
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_APPEND |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.fchmodSync(log, 0o600);
    fs.closeSync(log);
  }
  return plan;
}
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== "--device")
    throw new AgentError("INSTALL_USAGE");
  await install(uuid(args[1]));
  process.stdout.write(
    "安裝檔案已準備完成，請依 README 配對後再載入 LaunchAgent。\n",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(
      safeEvent(
        "install_failed",
        error instanceof AgentError ? error.code : "LOCAL_STORAGE_FAILURE",
      ) + "\n",
    );
    process.exitCode = 1;
  });
