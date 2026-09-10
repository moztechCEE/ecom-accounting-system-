import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { Plugin } from "vite";
import {
  parseBrand,
  parseQuote,
  customerQuote,
} from "../../backend/src/modules/integration/after-sales/after-sales-preparation.contract";
// Only mounted by the explicit localhost test config. Stores synthetic preview data, never credentials.
export function preparationFixture(): Plugin {
  const folder = resolve(process.cwd(), "../output/playwright");
  const file = resolve(folder, "after-sales-preparation-fixture.json");
  const defaults = ["MOZTECH", "BONSON", "AIRITY"].map((code) => ({
    code,
    name: code,
    active: true,
    lineOfficialId: "",
    channelId: "",
    liffId: "",
    invoiceLegalName: code === "MOZTECH" ? "" : "萬博創意科技有限公司",
    invoiceTaxId: "",
    invoiceMerchantLabel: code === "MOZTECH" ? "MOZTECH" : "萬魔未來",
    version: 1,
    lineStatus: "not_connected",
    invoiceStatus: "unverified",
  }));
  let state: {
    brands: typeof defaults;
    drafts: any[];
    requests: Record<string, { hash: string; draft: any }>;
  } = { brands: defaults, drafts: [], requests: {} };
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* First fixture start. */
  }
  const persist = () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
  };
  return {
    name: "after-sales-preparation-fixture",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (!url.pathname.startsWith("/api/v1/after-sales/preparation/"))
          return next();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        const send = (status: number, data: unknown) => {
          res.statusCode = status;
          res.end(JSON.stringify(data));
        };
        try {
          if (req.method === "GET") {
            if (url.searchParams.get("entityId") !== "test-entity")
              return send(403, { message: "僅允許測試公司" });
            if (url.pathname.endsWith("/brands"))
              return send(200, state.brands);
            if (url.pathname.endsWith("/quote-drafts"))
              return send(200, state.drafts.slice(0, 100));
            if (url.pathname.endsWith("/case-brand")) {
              const sourceCaseId = url.searchParams.get("sourceCaseId");
              return send(200, {
                sourceCaseId,
                brandCode:
                  state.drafts.find((d) => d.sourceCaseId === sourceCaseId)
                    ?.brandCode || null,
              });
            }
            return send(404, {});
          }
          if (req.method !== "POST") return send(405, {});
          let raw = "";
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 65536) return send(413, {});
          }
          const body = JSON.parse(raw);
          if (body.entityId !== "test-entity")
            return send(403, { message: "僅允許測試公司" });
          if (url.pathname.endsWith("/brands")) {
            const data = parseBrand(body.data);
            const old = state.brands.find((brand) => brand.code === data.code);
            if ((old?.version || 0) !== body.version)
              return send(409, { message: "品牌已被更新，請重新載入" });
            const saved = {
              ...data,
              version: body.version + 1,
              lineStatus: "not_connected",
              invoiceStatus: "unverified",
            };
            state.brands = [
              ...state.brands.filter((brand) => brand.code !== data.code),
              saved,
            ];
            persist();
            return send(200, saved);
          }
          if (url.pathname.endsWith("/quote-drafts")) {
            const input = parseQuote(body.data);
            const hash = createHash("sha256")
              .update(JSON.stringify(input))
              .digest("hex");
            if (state.requests[body.requestKey]) {
              const prev = state.requests[body.requestKey];
              return send(
                prev.hash === hash ? 200 : 409,
                prev.hash === hash ? prev.draft : { message: "重試內容不一致" },
              );
            }
            const brand = state.brands.find(
              (brand) => brand.code === input.brandCode,
            );
            if (!brand?.active)
              return send(404, { message: "品牌不存在或已停用" });
            if (brand.version !== input.brandVersion)
              return send(409, { message: "品牌設定已更新，請重新載入" });
            const n = Number(input.sourceCaseId.replace("fixture-", ""));
            if (
              !/^fixture-\d+$/.test(input.sourceCaseId) ||
              n < 1 ||
              n > 47 ||
              (n - 1) % 6 !== 2
            )
              return send(400, { message: "請選擇未結束的測試維修案件" });
            const previous = state.drafts.find(
              (draft) => draft.sourceCaseId === input.sourceCaseId,
            );
            if (previous && previous.brandCode !== brand.code)
              return send(409, {
                message: "此案件已綁定其他品牌，請使用原品牌",
              });
            const sourceCaseNumber = "TEST-" + String(n).padStart(4, "0");
            const draft = {
              id: randomUUID(),
              createdAt: new Date().toISOString(),
              status: "draft",
              sourceCaseId: input.sourceCaseId,
              sourceCaseNumber,
              brandCode: brand.code,
              brandVersion: brand.version,
              brandSnapshot: brand,
              customerPreview: customerQuote(brand, sourceCaseNumber, input),
              deliveryStatus: "not_sent",
              invoiceStatus: "not_issued",
            };
            state.drafts.unshift(draft);
            state.requests[body.requestKey] = { hash, draft };
            persist();
            return send(200, draft);
          }
          return send(404, {});
        } catch (error) {
          return send(400, { message: (error as Error).message });
        }
      });
    },
  };
}
