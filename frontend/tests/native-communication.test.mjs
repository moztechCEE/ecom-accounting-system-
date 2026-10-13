import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const origin = "https://communication-fixture.invalid";
const dist = fileURLToPath(new URL("../dist", import.meta.url));
const output =
  process.env.DOA_COMMUNICATION_UI_EVIDENCE_DIR ||
  "/private/tmp/doa-communication-offline-20261013";
await mkdir(output, { recursive: true });
const token = (actor) =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor })).toString("base64url")}.fictional`;
const actor = "qa-user",
  entity = "fixture-company",
  caseId = "case-repair";
let createdConfirmations = [];
let posts = [],
  errors = [],
  checks = [],
  confirmationMode = "unknown",
  notificationStatus = "DRAFT",
  readonly = false,
  brand = "MOZTECH",
  feeMode = "PAID",
  amount = 200,
  factory = null,
  selectedType = "REPAIR";
const confirmationKey =
  "corely.doa.pending-confirmation.v1:qa-user:fixture-company:case-repair";
const detail = () => {
  const item = {
    id: caseId,
    number: "SYNTHETIC-UI-COMMUNICATION",
    type: selectedType,
    status: "INSPECTING",
    brand,
    contact: { name: "示意顧客", phone: "0900000000" },
    products: [{ id: "line-a", name: "示意產品", sku: "MOCK-A", quantity: 1 }],
    serialNumber: "MOCK-SN",
    owner: { name: "示意客服" },
    workflow: {
      queue: "csr",
      stageLabel: "待客服確認",
      nextAction: "核對本版報價",
      isLocked: false,
      isOverdue: false,
    },
    updatedAt: "2026-10-13T00:00:00.000Z",
    tasks: [],
  };
  return {
    contractVersion: "corely.doa.tasks.v1",
    item,
    customer: {
      name: "示意顧客",
      phone: "0900000000",
      address: "示意地址",
      email: "qa@example.invalid",
    },
    notes: {},
    details: { repair: { quoteAmount: amount } },
    finance: { payments: [], refunds: [], invoices: [] },
    logistics: { incoming: [], outgoing: [] },
    line: { brand, identityBound: true, notificationEnabled: true },
    history: [],
    canEdit: !readonly,
    canCommunicate: !readonly,
    communication: {
      confirmations: createdConfirmations,
      notifications: [
        {
          id: "notification-a",
          type: "PAYMENT_CONFIRMED",
          brand: "MOZTECH",
          status: notificationStatus,
          payload: { title: "款項進度", text: "示意通知內容" },
          createdAt: "2026-10-13T00:00:00.000Z",
          provider: notificationStatus === "SIMULATED" ? "DEV_STUB" : null,
        },
      ],
      factory,
      sourceActorId: "source-qa-user",
      productBindings: [],
    },
    repairProposals: [
      {
        id: "proposal-a",
        itemId: "item-a",
        status: "PROPOSED",
        planVersion: 1,
        proposal: {
          original: {
            productName: "示意產品",
            sku: "MOCK-A",
            serialNumber: "MOCK-SN",
            sourceItemId: "line-a",
            quantity: 1,
          },
          plan: "REPAIR",
          planVersion: 1,
          planHash: "a".repeat(64),
          proposalHash: "b".repeat(64),
          feeMode,
          amount,
          currency: "TWD",
          summary: "檢測USB端口",
          customerVisibleSummary: "檢测報告",
        },
      },
    ],
    proposalOverflow: false,
  };
};
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 1000 },
});
await context.addInitScript((token) => {
  if (window.top !== window) return;
  localStorage.setItem("access_token", token);
  localStorage.setItem("entityId", "fixture-company");
}, token(actor));
const routeHandler = async (route) => {
  const req = route.request(),
    url = new URL(req.url()),
    path = url.pathname;
  const json = (value, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  if (url.origin !== origin) return route.abort();
  if (path === "/config.js")
    return route.fulfill({
      contentType: "application/javascript",
      body: 'window.__APP_CONFIG__={apiUrl:"/api/v1",afterSalesModuleEnabled:true,mailroomEnabled:true,stagedOperationsEnabled:true,defaultEntityId:"fixture-company",wsUrl:"https://communication-fixture.invalid"}',
    });
  if (path === "/api/v1/users/me")
    return json({
      id: actor,
      email: "qa@example.invalid",
      name: "示意客服",
      salesDataScope: "ENTITY",
      effectivePermissions: [
        "after_sales_cases:read",
        "after_sales_cases:update",
      ],
      roles: [{ role: { code: "CUSTOMER_SERVICE", permissions: [] } }],
    });
  if (path === "/after-sales-app/api/integration/erp/logout")
    return route.fulfill({ status: 204 });
  if (path === "/api/v1/after-sales/tasks/options")
    return json({
      canReadAll: true,
      createTypes: [],
      brands: [{ value: "MOZTECH", label: "MOZTECH" }],
      products: [],
      sourceChannels: [],
      customerKinds: [],
      reasonOptions: {},
      factoryAssignees: [{ value: "source-qa-user", label: "示意工廠承辦" }],
    });
  if (path === "/api/v1/after-sales/tasks")
    return json({ items: [], counts: { mine: 0, all: 0 }, total: 0 });
  if (
    path === "/api/v1/after-sales/tasks/cases/" + caseId &&
    req.method() === "GET"
  )
    return json(detail());
  if (
    path.startsWith("/api/v1/after-sales/tasks/cases/" + caseId + "/") &&
    req.method() === "POST"
  ) {
    const payload = req.postDataJSON();
    assert.equal(req.headers()["x-doa-actor"], actor);
    assert.equal(req.headers().authorization, "Bearer " + token(actor));
    posts.push({ path, payload });
    const command = payload.command;
    if (command.operation === "CREATE_CONFIRMATION") {
      if (confirmationMode === "unknown")
        return json({ message: "確認連結結果尚未確認" }, 503);
      const result = {
        id: command.requestId,
        purpose: command.purpose,
        status: "PENDING",
        revision: 1,
        expiresAt: "2026-10-16T00:00:00.000Z",
        url:
          origin +
          "/customer/confirm/" +
          command.requestId +
          "?token=fictional-safe-link",
      };
      createdConfirmations = [result];
      return json(result);
    }
    if (command.operation === "APPROVE_NOTIFICATION") {
      notificationStatus = "APPROVED";
      return json({ id: "notification-a", status: notificationStatus });
    }
    if (command.operation === "SEND_NOTIFICATION") {
      notificationStatus = "SIMULATED";
      return json({
        id: "notification-a",
        status: notificationStatus,
        providerReceiptId: "DEV-LINE-NOTIFICATION",
      });
    }
    if (path.endsWith("repair-proposals/adopt"))
      return json({ quoteRevision: 2, adopted: true });
    if (path.endsWith("factory-actions")) {
      if (command.action === "ASSIGN")
        factory = {
          id: "factory-a",
          status: "ASSIGNED",
          revision: 1,
          factoryName: command.factoryName,
          assigneeId: command.assigneeId,
          issueSummary: command.issueSummary,
        };
      else if (command.action === "ACCEPT")
        factory = { ...factory, status: "ACCEPTED", revision: 2 };
      else if (command.action === "REPLY")
        factory = {
          ...factory,
          status: "REPLIED",
          revision: 3,
          reply: command.reply,
        };
      else
        factory = {
          ...factory,
          status: "CLOSED",
          revision: 4,
          resolution: command.resolution,
        };
      return json(factory);
    }
  }
  if (path.startsWith("/api/v1/")) return json([]);
  if (path.startsWith("/socket.io")) return route.abort();
  if (path.startsWith("/assets/"))
    return route.fulfill({
      contentType: path.endsWith(".js")
        ? "application/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "image/png",
      body: await readFile(join(dist, path)),
    });
  if (path.startsWith("/brand/")) return route.fulfill({ status: 204 });
  return route.fulfill({
    contentType: "text/html",
    body: await readFile(join(dist, "index.html")),
  });
};
await context.route("**/*", routeHandler);
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.accept());
const url =
  origin +
  "/operations/after-sales/workbench?entityId=" +
  entity +
  "&case=" +
  caseId;
const panel = () => page.locator(".native-case-communication");
const load = async () => {
  await page.goto(url);
  await panel().waitFor();
};
async function check(name, run) {
  await run();
  checks.push(name);
}
try {
  await check(
    "confirmation journal is durable before POST and retry after reload keeps exact UUID/body",
    async () => {
      await load();
      await panel()
        .getByRole("button", { name: "建立顧客確認連結", exact: true })
        .click();
      await panel()
        .getByText("確認連結結果尚未確認", { exact: true })
        .waitFor();
      const saved = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        confirmationKey,
      );
      assert.equal(
        saved.request.requestId,
        posts.at(-1).payload.command.requestId,
      );
      assert.equal(saved.request.operation, "CREATE_CONFIRMATION");
      assert.equal(JSON.stringify(saved).includes("token"), false);
      await page.reload();
      await panel()
        .getByRole("button", { name: "重試確認連結", exact: true })
        .waitFor();
      confirmationMode = "success";
      await panel()
        .getByRole("button", { name: "重試確認連結", exact: true })
        .click();
      await panel().getByRole("textbox", { name: "顧客確認連結" }).waitFor();
      const creates = posts.filter(
        (item) => item.payload.command.operation === "CREATE_CONFIRMATION",
      );
      assert.deepEqual(creates[1].payload.command, creates[0].payload.command);
      assert.equal(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          confirmationKey,
        ),
        null,
      );
    },
  );
  await check(
    "REVIEW amount null cannot be adopted as free repair",
    async () => {
      feeMode = "REVIEW";
      amount = null;
      await load();
      await panel().getByText("維修師尚未確認費用", { exact: true }).waitFor();
      assert.equal(
        await panel()
          .getByRole("button", { name: "採用全部本版提案", exact: true })
          .isDisabled(),
        true,
      );
      const before = posts.length;
      await page.waitForTimeout(100);
      assert.equal(posts.length, before);
      feeMode = "PAID";
      amount = 200;
    },
  );
  await check(
    "proposal adoption includes all current proposal IDs and version",
    async () => {
      await load();
      await panel()
        .getByRole("button", { name: "採用全部本版提案", exact: true })
        .click();
      await page.waitForTimeout(150);
      const adopted = posts.find((item) =>
        item.path.endsWith("repair-proposals/adopt"),
      );
      assert.deepEqual(adopted.payload.command.proposalIds, ["proposal-a"]);
      assert.equal(
        adopted.payload.command.expectedUpdatedAt,
        "2026-10-13T00:00:00.000Z",
      );
    },
  );
  await check(
    "notice must be reviewed before send, SIMULATED never becomes delivered",
    async () => {
      await load();
      await panel()
        .getByText(/^LINE 通知/)
        .click();
      await panel()
        .locator(
          'button[data-operation-action="after_sales.notification.preview"]',
        )
        .click();
      const drawer = page.locator(".ant-drawer-open");
      assert.equal(
        await drawer
          .getByRole("button", { name: "發送 LINE 通知", exact: true })
          .count(),
        0,
      );
      await drawer
        .getByRole("button", { name: "審核通過", exact: true })
        .click();
      await panel().getByText("已審核，待發送", { exact: true }).waitFor();
      await panel()
        .locator(
          'button[data-operation-action="after_sales.notification.preview"]',
        )
        .click();
      await page
        .locator(".ant-drawer-open")
        .getByRole("button", { name: "發送 LINE 通知", exact: true })
        .click();
      await panel().getByText("DEV 模擬完成", { exact: true }).waitFor();
      assert.equal((await panel().innerText()).includes("已送達"), false);
    },
  );
  await check(
    "missing brand and readonly actor expose no actionable LINE commands",
    async () => {
      const before = posts.length;
      brand = null;
      await load();
      assert.equal(
        await panel()
          .getByRole("button", { name: "建立顧客確認連結", exact: true })
          .count(),
        0,
      );
      brand = "MOZTECH";
      readonly = true;
      await load();
      assert.equal(
        await panel()
          .getByRole("button", { name: "建立顧客確認連結", exact: true })
          .count(),
        0,
      );
      assert.equal(posts.length, before);
      readonly = false;
    },
  );
  await check(
    "factory assignment uses Source account ID then accepts exact revision",
    async () => {
      selectedType = "CUSTOMER_ISSUE";
      factory = null;
      await load();
      await panel().getByText("工廠問題交辦", { exact: true }).click();
      await panel()
        .getByRole("button", { name: "交辦工廠", exact: true })
        .click();
      const drawer = page.locator(".ant-drawer-open");
      await drawer.locator("#factoryName").fill("示意工廠");
      await drawer.locator("#assigneeId").click();
      await page.getByText("示意工廠承辦", { exact: true }).click();
      await drawer.locator("#issueSummary").fill("示意產品端口問題");
      await drawer
        .locator('button[data-operation-action="after_sales.factory.submit"]')
        .click();
      await panel().getByText("待接手", { exact: true }).waitFor();
      await panel()
        .getByRole("button", { name: "接手交辦", exact: true })
        .click();
      await panel().getByText("已接手，待回覆", { exact: true }).waitFor();
      const assigned = posts.find(
        (item) => item.payload.command.action === "ASSIGN",
      );
      assert.equal(assigned.payload.command.assigneeId, "source-qa-user");
      const accepted = posts.find(
        (item) => item.payload.command.action === "ACCEPT",
      );
      assert.equal(accepted.payload.command.expectedRevision, 1);
    },
  );
  await check(
    "factory reply and resolution keep owner revisions and complete the case",
    async () => {
      await panel()
        .getByRole("button", { name: "記錄工廠回覆", exact: true })
        .click();
      let drawer = page.locator(".ant-drawer-open");
      await drawer.locator("#reply").fill("已完成端口批次分析");
      await drawer
        .locator('button[data-operation-action="after_sales.factory.submit"]')
        .click();
      await panel().getByText("已回覆，待核定", { exact: true }).waitFor();
      await panel()
        .getByRole("button", { name: "核定結案", exact: true })
        .click();
      drawer = page.locator(".ant-drawer-open");
      await drawer.locator("#resolution").fill("工廠改善下一批端口強度");
      await drawer
        .locator('button[data-operation-action="after_sales.factory.submit"]')
        .click();
      await panel().getByText("已結案", { exact: true }).waitFor();
      const replied = posts.find(
        (item) => item.payload.command.action === "REPLY",
      );
      const closed = posts.find(
        (item) => item.payload.command.action === "CLOSE",
      );
      assert.equal(replied.payload.command.expectedRevision, 2);
      assert.equal(closed.payload.command.expectedRevision, 3);
      assert.equal(closed.payload.command.resolution, "工廠改善下一批端口強度");
    },
  );
  await check(
    "queued confirmation cannot send after another tab switches login token",
    async () => {
      selectedType = "REPAIR";
      await load();
      const holder = await context.newPage();
      await holder.goto(url);
      await holder.evaluate((key) => {
        navigator.locks.request(key, async () => {
          window.held = true;
          await new Promise((resolve) => (window.release = resolve));
        });
      }, confirmationKey);
      await holder.waitForFunction(() => window.held);
      const before = posts.length;
      await panel()
        .getByRole("button", { name: "建立顧客確認連結", exact: true })
        .click();
      await page.waitForTimeout(100);
      assert.equal(posts.length, before);
      await holder.evaluate((other) => {
        localStorage.setItem("access_token", other);
        window.release();
      }, token("other-user"));
      await panel()
        .getByText("登入狀態已變更，連結未送出", { exact: true })
        .waitFor();
      assert.equal(posts.length, before);
      await holder.close();
      await page.evaluate(
        (qa) => localStorage.setItem("access_token", qa),
        token(actor),
      );
    },
  );
  await check("mobile communication panel stays within viewport", async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    await load();
    const width = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth,
      view: innerWidth,
    }));
    assert.ok(width.body <= width.view);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(output, "mobile.png"), fullPage: true });
  });
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(
      {
        pass: true,
        checks,
        scope: "offline synthetic DOM fixtures; no DEV login or live effects",
        postCount: posts.length,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ pass: true, checks: checks.length, evidence: output }),
  );
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(
      { pass: false, checks, error: error.message, errors, posts },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
