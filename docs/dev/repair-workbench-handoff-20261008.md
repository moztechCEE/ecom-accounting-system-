# 維修工作台第一批交付（2026-10-08）

此批補上維修案件的當版條件與下一步、原生交接說明。來源旗標為 true 時，畫面仍逐項顯示檢修、CSR、正式報價、顧客同意及必要款項；不把來源放行摘要當作目前技術方案已可執行。原生工作單、實際修理／換機、拒修與原廠處理紀錄保留。

## 版本與所有權

- repo：`https://github.com/moztechCEE/ecom-accounting-system-.git`
- 基底：`f3f14c4104906cc6ca23bd1d38ba4589563b6801`
- 分支：`codex/repair-workbench-20261008`
- worktree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-20261008`
- 維修視窗：`01a117fd-0a9e-7882-a4aa-c9a27d34f1d3`
- DOA 已確認此基底與維修頁／專用測試編輯範圍。指定來源配對為 `20f583b6284e93e5516a533733b3833120aaae0d`，本輪不改來源。
- 原工作樹乾淨且保留；產品提交只在本維修 worktree。本批完整 SHA 由交付訊息與共用 repair-status 記錄，避免在提交檔內自引用。

## 差異與接口

- `RepairWorkbenchPage.tsx` 接入唯讀面板；原 actions payload、request ID 重試、expectedVersion、草稿保護、文件儲存與列印不變。
- 新 `repair-readiness.ts`／`RepairReadinessPanel.tsx` 使用原生資料與既有 `repairStartReady`、`repairReportReady` 作核對依據，不建立另一案件或寫入共同狀態。
- 顯示本人簽收、客服 SENT／ACCEPTED／RESOLVED、接手人、檢修／估價／報價版次、顧客同意（免费也需要）、正數必要款項、維修單版次及 FAIL／未測原因。
- RETURN 公司整新、原件未修退回、原廠取消與實際返還、完工待收發接收分開呈現。原生不支援的處置不改寫為已修理或已完成。
- Timeline 保留既有順序，補顯示 `history.note` 與原生實物紀錄 `version`；已知文書 metadata 只呈現保存單號／文件版次／草稿或提交，其他說明保留原文字与換行。React 文字節點、不解譯HTML、不展開其他資料。

沿用 `GET /mailroom/items?view=repair`、`GET /repair-workbench/items/:id/documents`、`POST /mailroom/items/:id/actions`、既有 document/workflow 與 stock endpoints；原 API prefix 由 client 決定。無 API、DTO、schema、migration、財務、通知、來源或導航變更。後端即時權限／公司／版本／保管／來源放行與庫存 gate 仍決定實際提交結果；畫面提示不替代此門檻。

## 本機驗證

本 worktree 測試共 59/59 通過：既有維修／保管／stock return／navigation 26/26、來源入口12/12、實際React19草稿／確認取消／保存回饋 DOM 1/1；新 readiness 19/19、真React面板DOM 1/1。新測試包含來源改報價／撤款／查詢失敗、免費未同意、CSR失效、本人／權限、報告改版、FAIL／未測、拒修與原廠、RETURN不支援方案及收發已接收待入庫。

完整前端 build（TypeScript + Vite）、五個改動程式／測試檔 lint 與 git diff --check 通過。既有 browser-data 過期／bundle 大小提示仍存在，未為此批更新依賴。桌面1280px與手機390px真React面板無橫向溢出；只用隔離合成資料，未將畫面可見當作DEV操作成功。

可重跑命令（frontend cwd，沿用既有 backend/node_modules 的 ts-node runner）：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test tests/repair-workbench.test.ts tests/repair-stock-return.test.ts tests/repair-navigation.test.ts tests/repair-item-custody.test.ts tests/repair-readiness.test.ts
node --experimental-strip-types --test tests/repair-after-sales-launch.test.ts tests/repair-feedback-dom.test.mjs tests/repair-readiness-dom.test.mjs
npm run build
./node_modules/.bin/eslint src/pages/repair/RepairWorkbenchPage.tsx src/pages/repair/RepairReadinessPanel.tsx src/pages/repair/repair-readiness.ts tests/repair-readiness.test.ts tests/repair-readiness-dom.test.mjs
```

knowledge spec 目前 16/17，唯一失敗是 Page source hash 漂移；依 DOA 指定集中更新順序，本視窗不改共用 catalog／generated／manifest。此項為待整合，不作 PASS。兩個新 source 檔也必須集中列入才有 drift coverage。

## 交 DOA 集中更新的 Claw 內容

Guide ID：`repair-workbench`；建議中文 title 同步頁內標題改為「維修工作台」，英文改為「Repair workbench」，ID／path／权限不變。中文 `backend/src/modules/ai/knowledge/catalog.source.json.entries[id=repair-workbench].sections`；英文同一 entry 的 `translations.en.sections`。沒有獨立內容檔，本輪不編輯共同 catalog。維修端已審查本批 Page/helper/panel 与現有 predicates，不變更既有 guide path／alias／permission／related／legacy。

建議中文 steps 增補：

> 案件詳情逐項核對本人簽收、當版檢修、客服接手與方案結果、顧客同意及必要款項、維修單版次與逐項複驗；未完成時顯示阻擋原因與下一步。歷程保留原生實物紀錄版本、操作人與處理說明，實物紀錄、檢修、維修及正式報價版次分別辨識。

對應英文 steps：

> Case details show personal acceptance, current inspection, CSR acceptance and decision, customer consent and required funds, repair-record revision and each verification result. Incomplete checks identify the blocker and next step. History retains the native physical-item version, actor and handling note; item, inspection, repair-record and formal quote revisions remain distinct.

建議中文 boundaries 增補：

> 核對清單與按鈕提示提供目前保存資料的操作指引；實際提交仍由後端即時核對權限、版本、保管、來源放行及庫存證明。歷程說明與系統送達不代替顧客同意、實收款或本人實物簽收。公司 RETURN 整新僅顯示原生已支援的交回條件，不能把不支援的替換或送廠分支改寫為已完成。

對應英文 boundaries：

> Checklist and button guidance assist the operator using current saved data; submission remains subject to current backend permission, version, custody, source-release and stock-proof checks. History notes and delivery records do not replace customer consent, received funds or personal physical acceptance. Company RETURN refurbishment displays only supported native completion conditions; unsupported replacement or factory branches cannot be rewritten as completed work.

請在该 guide 的 sourcePaths 新增 `frontend/src/pages/repair/repair-readiness.ts` 與 `frontend/src/pages/repair/RepairReadinessPanel.tsx`；原 Page 已在清單。最終經審 SHA256 隨下表記錄。整合後只允許本批維修來源與另經 DOA 審查的本批來源漂移，再執行 generator --write、--check 與17項spec。全域 sourceVersion 的刷新為生成器既有行為，不是其他 guide 文案已被重新驗收。

## 共用缺口與下一批

以下是固定基底程式審查，已送 DOA，未在本批變更共享服務：

1. `mailroom.service.ts` 的開工與完工 legacy 路徑在沒有 CSR 時較寬，不能以本前端嚴格提示代替統一 API guard／舊案回補。
2. CSR 核准轉 INSPECTING 後，待款案件不在 waiting 查詢；需共同查詢契約，不造另一付款狀態。
3. RETURN 整新既有可選的 REPLACE／FACTORY／RETURN 缺完整回路；保留已存實際處置，後續由共同契約定合法路徑。
4. 不符重審／顧客再次確認兩條實收路徑、三份快照及初審考績由 DOA 與收發協調；維修不自行解除。
5. 多工作台授權与預設入口由 DOA 修改共享導航；維修前端以原細權限與逐件本人條件操作，不把主管固定為單一角色。

## 跨台回執與發布界線

提交後其他兩台 fetch 指定 ref、核對完整 SHA，再在独立 review worktree 查此 diff 與接收端行為。需保存各自被審 SHA、送出／接收、接口、實際測試、PASS／FAIL／尚待驗證與待辦，不以此文件代簽對方 PASS。合併後最後整合 SHA 需重新核對。

2026-10-08 現查四服務 Ready、100% 流量仍為 ERP f3／來源20f配對；本批新碼尚未部署。DEV 合併／migration／流量由 DOA 統籌。沒有正式環境操作、真實顧客通知、付款、退款、物流或正式庫存異動。現場機種基準、銀行／LINE／供應商／ECOUNT回執及真正搬運另驗。

## 此批已審來源 SHA256（交 DOA 集中更新）

| sourcePath | SHA256 |
| --- | --- |
| `frontend/src/pages/repair/RepairWorkbenchPage.tsx` | `f01537d363d57a5663e61e8825383df6b31fa1acbe32bb88ccd99d11573f1dab` |
| `frontend/src/pages/repair/repair-readiness.ts` | `4108c5bfe4615dd1b335ac5a3ac8cf88af1d469d4d340d85747df4b71d586968` |
| `frontend/src/pages/repair/RepairReadinessPanel.tsx` | `3c93901a5b3078b1024313f5825960bc7428248c8c2305d1e79c7868c45731f5` |


## 收發端 587 審查修正回執

- 被審版本：`587b077a59982a436726c02e0c286391e5432ebf`；審查視窗 `01a0f1ea-bd9e-70f0-9a41-72e5c4eccc31`，2026-10-08。
- 收發端實跑相關單元39/39與真React DOM1/1，另指出 P2：INSPECTING 可合法存維修草稿／提交單，原 helper 因存在 report 優先顯示完工提示，蓋住開工指引。此項按收發回覆 FAIL，既有測試通過不能覆蓋未測的提示缺口。
- 本修訂將完成件清單依原生作業階段顯示，保留 RETURN／REFURBISHING 不支援分支提示；檢測中既有維修單及實際 outcome 不刪除、不改寫。
- 原廠已本人收回後檢修改版會使CSR失效；即使伺服器不提供 complete_factory，仍顯示返還後交回缺口。這是唯讀證據展示，不新增完成權限。
- 新增 REPAIR／REPLACE × DRAFT／SUBMITTED 開工指引與來源未齊測例；原廠返還後改檢修／失CSR測例。真React DOM同時核對既有文件仍可見、開工指引不被蓋及原廠失效原因。
- 修訂只改 helper、2個專用tests及此文件；原actions/predicates、API、模型、schema、shared导航与dispatch均未變更。新提交SHA由交付訊息及repair-status記錄。
- 修後測試59/59、完整frontend build、此3個改動程式／測試檔lint與diff檢查通過；新固定SHA仍須收發與DOA重審，不能自動沿用587的舊審查。Claw集中更新與最終整合DEV仍待DOA。

## 收發 dispatch 整合前的維修唯讀提示適配

固定審查 DOA `ad406d84679bb7b1a54f08bc4df35aa73fc765c3`、收發 `dd0b5b4453eb0cf348fd7b3a4b4b39c2ea73d91d` 後，跨固定模組 probe 發現既有3e helper在 DISPATCHED＋原RETURN方案仍顯舊拒修交回指引。收發單批的原生維修頁已排除再次簽收／施工，本修订只補維修owned唯讀面板，沒有修改收發dispatch、shared模型、API或任何來源／庫存狀態。

- DISPATCHED 優先顯示「已交物流寄回，待顧客收件」，不沿用舊處置方案的退回指引；明示交運、顧客收件與結案不同。
- 已寄出即不顯本人可作業條件，即使輸入殘留舊editable／custodian／return_original旗標；實際action權限與原生後端仍維持原契約。
- 保留所有檢修、維修及實際處置；不要求在本修訂基底新增 CUSTOMER_CARRIER 型別或 outboundschema，正式保管／物流投影由收發固定批帶入。
- 本次 delta 實跑 readiness20/20（含4方案及殘留旗標）、真React panel DOM1/1、完整frontend build、3改動程式／測試檔lint與diff檢查 PASS。先前59項為3e驗證歷史，不假裝全部已於此新HEAD重跑。Claw因helper改動待DOA在最後整合集中生成，不能只更新hash而略過下列雙語語意。

Claw repair-workbench steps增補（整合收發dispatch後採用）：

- ZH：已交物流寄回的物件只查看既有檢修、維修與寄出紀錄；核對承運商、單號及實際原件／替換品。已交運不表示顧客已收件或案件已結案，後續由收發室與客服依實際結果處理。
- EN: Dispatched items retain inspection, repair and outbound records for review. Verify the carrier, tracking number and actual original or replacement item. Carrier handover does not prove customer receipt or case closure; mailroom and customer service follow the actual outcome.

邊界：本修訂不新增dispatch能力或 Source／AI消費端，不把 PENDING_COMPATIBILITY 轉成功。DISPATCHED目前仍不在repair records隊列、all可查；若要擴充records須由DOA協調共同查詢契約。兩批獨立審查回執保存於本產品docs/dev/reviews；最終共同整合SHA與DEV仍需重驗。
