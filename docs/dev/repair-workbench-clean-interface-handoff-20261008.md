# 維修低干擾介面與全系統開發約定交付

2026-10-08。使用者要求移除操作頁面的常駐註解、流程旁白和長按鍵文字，並先參考保固系統，再將約定寫入 ERP `AGENTS.md`。本批是前次 UI `28b5` 的後續修訂；前次獨立覆核 FAIL 保留，不能以本機新測試代簽兩台接收或 DEV 驗收。

## 來源、範圍與參考

- 實際 repo/origin：`https://github.com/moztechCEE/ecom-accounting-system-.git`；獨立 worktree `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-ui-cleanup-20261008`，分支 `codex/repair-ui-cleanup-20261008`。
- 本次 delta 基底 `28b5f06c7889085d9246aab7c33ab7090669c7a6`；累積整合基底 `264352c5b863d9928a36ab2a9dbecc697f35a028`。交付版本是本文件同一提交的 HEAD，完整 SHA、push 核對及後續接收結果記於協調區 `repair-status.md`。
- 修改：`AGENTS.md`、七個 owned frontend sources、五個專用 DOM tests、本文件及前次 DOA 覆核原文；沒有改 shared API/service/DTO/schema/model/readiness helper、權限、導航、正式報價、金流、庫存寫入或中央 Claw。DOA 已認領中央指南及 shared UI，收發室認領自己的介面。
- 真正保固 repo `/Users/moztecheason/Documents/ChatGPT/corely AI/warranty-platform`，origin `https://github.com/moztechCEE/warranty-platform.git`，branch `codex/feedback-dev-20260908`，HEAD `6f59aa230bcc841bc261f3125f368a9208a034ca`。設計準則 `docs/ui-design-principles.md` 及 ProductsPage、WarrantiesPage 與該固定版本一致；WarrantyEditor 有他人修改，另以該固定 SHA 讀原模式。保固樹全程只讀。專案目錄 `/Users/moztecheason/Documents/ChatGPT/保固系統` 只有未提交的 `.git`，沒有拿它當產品來源。
- 參考模式：一個頁名與必要操作、工作資料優先、次要資料按需展開、可辨識及清除的篩選、短動詞按鍵；移除工程旁白及靜態背書，同時保留真實 DEV/DEMO、服務錯誤、權限與草稿/儲存/預覽/發布差異。

## 介面行為

`AGENTS.md` 新增全系統 interface rules：既有修正及未來任何功能皆適用，不能把不需要的旁白搬進另一個收合區。源碼註解和技術文件仍保留；產品頁只放工作資料、必要標籤、短操作和當下具體回饋。一般用法由 Claw「這頁怎麼用」提供，基本畫面本身仍須可理解。

- 維修頁移除標題副文、待到貨教學、待客服常駐說明；到貨區按需展開真實資料，沒有重複卡片標題。產品、案件號、SN/SKU、保管、工作單版次與原有實際處置仍可核對。
- 文件移除填單教學、各區常駐說明、庫存與原廠流程旁白、教學 placeholder 及 `Form.Item.extra`；列印也移除頭尾長段流程旁白，內部工作單名稱、真實文件狀態/版次及保存資料仍保留。檢修仍分兩區、維修三區；儲存草稿、提交檢修單、提交維修單及列印明確分開。提示縮為「草稿已儲存／檢修單已提交／維修單已提交」。唯讀、改版、必填及真實失敗仍可見。
- 作業按鍵使用認領案件、簽收實物、開始檢測、送客服確認、開始維修/換機、交回收發室；一個主要下一步，其他用普通按鍵。Disabled 只在按需 Tooltip 說具體欠缺，沒有放寬原 predicates。
- 客服/放行區顯實際版次、方案回覆、當版報價同意及必要款項；只有目前操作未符合條件時在外層顯短阻擋，展開後只列實際失配的估價/報價版本。清單等待原因另核對 CSR 的檢修/估價/報價版次、planHash 和 decision，不一致顯「待客服重新確認」，不誤示已可接手。這是 readonly projection，沒有自行改案件狀態。
- 原件/原廠按鍵縮短，仍分交運、原廠收件、原廠實際寄回、本人返還簽收與複驗交回。取消只記取消事實及原有原因，不代替返還。保留實際承運商、單號、原廠紀錄、本人確認及必填 rules。
- 替換區移除常駐庫存教學，保留真實預留、效期、資格篩選與明確取消。403/網路錯誤使用既有 `errorText`，不能一律說庫存未準備或建議取消；只有本機確定 expired 才說預留過期。
- CustomerRepairQueue 移除常駐分工說明，縮短接手/回覆/方案按鍵；顧客同意不足仍明示當版報價並禁止 APPROVE，DECLINE 原規則不變。此元件的 native request/guard 靜態核對，不宣稱本批獨立實跑客服 queue DOM。
- 已交物流紀錄中的舊 ACK tag 加「歷史」，保留 DELIVERED/PENDING/FAILED 真值及數量，不能當本次寄出同步或顧客通知成功。

## 前次 P2 與新回饋介面

原正式回執 [repair-ui-28b5f06c-doa-review-20261008.md](reviews/repair-ui-28b5f06c-doa-review-20261008.md) 原文 SHA256 `5f10cc9d0b75adcf7e576eb02a464b98e987a4bc0d877c5634668ae80b19ce31`；在實際 Page 中重現「送出原廠作業 → pending 時收合 → API reject → failure DOM 隱藏」。前次批次保持 FAIL/HELD 歷史。

新增 UI-only optional props `RepairWorkflowPanel.onFailure(string)`、`onBusyChange(boolean)`。父 Page 在送出期間禁止收合；拒絕或保存成功但 reload 失敗的回饋放在外層，收合後仍可見；當前 context toast 即時提示，獨立元件仍保留本地 Alert。`forceRender` 保留同表單 DOM 和草稿。沒有新增後端接口、command、權限或業務狀態。

## 本機驗證

- 完整 frontend `npm run build`、六個變動 TSX/五個專用 tests eslint、diff whitespace check 通過。只有既有 Browserslist/baseline 資料老化與 bundle size warning，未修改 dependencies。
- Documents DOM 5/5 PASS（parent + 四情境，5.00 秒）：付費估價必填、dirty/busy、完整保存 payload、保存版列印、實際 outcome/parts/QC、版次警示、唯讀及失敗保稿；短 toast 亦實跑核對。
- Workflow feedback DOM 正常模式 10/10 PASS（parent + 九情境），不依賴歷史 Git 物件；`REPAIR_TEST_BASELINE=1` 模式 11/11 PASS，另實際重現 28b5 舊缺陷。實際 Page/Workflow/Stock/services，只有 API/auth/websocket 離線 stub；pending 收合鎖定、失敗外層可見、同輸入 DOM、重試同 requestId、expectedVersion/payload、三種權限限制及五種庫存負向情境通過。
- Terminal 1/1 PASS（十情境），readiness 最終 1/1 PASS（十八情境，2.51 秒），保留實際文件/寄出/歷史 ACK、零 editable 施工入口、當版顧客同意/款項/CSR/QC 阻擋和來源文字 escaping；新增估價/客服報價失配顯真版次且持續 blocked。
- Layout 最終 1/1 PASS（8.63 秒）：兩個開案入口、1537/1024/390 三 viewport、無溢出、長產品/案件/SN/SKU、工作單分組、同 DOM/草稿、取消離開及一次合成保存；新增三種客服版本/決定失配的列表顯示。首批及補跑因手機隱藏 tab、AntD「更 新」及退出動畫 loading accessible name、重複 modal title 的定位器假設失敗；已收窄測試 selector 後通過，沒有縮減原業務斷言。
- 獨立語意核對 SCOPE_PASS：16 payload/gate 宣告、13 API/UUID/permission calls、六個 Page action 分支條件相同；`waitingFor` 另跑十七情境/34 assertions 核對 CSR 估價/報價/decision、來源撤放行、同意/款項與 RETURN/FACTORY。AGENTS 舊發布段落逐字保留。Documents 保存回饋 literal 與列印 HTML 呈現有修改，不能稱整函式 unchanged；原保存 guard/payload/retry、保存版選取/escaping及權限維持。
- 測試只用合成資料；外部請求、真 HTTP writes、瀏覽器 runtime errors 為 0。未部署、未讀寫 DB、未發真通知、未操作付款、發票或庫存。舊 backend/pure 整批驗收沒有在本次文案變動重跑；不把前批 counts 當新批結果。

重跑（cwd `frontend`）：

```sh
npm run build
node --test tests/repair-dispatched-page-dom.test.mjs tests/repair-readiness-dom.test.mjs tests/repair-ui-layout-dom.test.mjs tests/repair-documents-ui-dom.test.mjs tests/repair-workflow-feedback-dom.test.mjs
REPAIR_TEST_BASELINE=1 node --test tests/repair-workflow-feedback-dom.test.mjs
```

新版合成圖片 `/tmp/corely-repair-clean-copy-20261008-{desktop,compact-desktop,mobile}-{list,drawer}.png` 及 `...-readiness-{desktop,mobile}.png`。Root 已目視桌面清單/抽屜與手機抽屜，沒有橫向溢出，手機先顯主表單。它們不是 DEV 登入或營運驗收證據。

## 中央指南交付與待辦

Root 執行 `node scripts/dev/generate-copilot-knowledge.cjs --check`：**FAIL，精確七個 owned source hash drift**。沒有執行 `--write`；以下七檔已在來源清單，DOA 需審雙語頁面用法後集中生成及測試，不能只更新 hash。原 2643 candidate 批與本 UI 批分開。

| Source | SHA256 |
| --- | --- |
| CustomerRepairQueue.tsx | `c882e9a075024cd80888ddde1418424c6653bd0e61ea23fdb8027e0cebf994b9` |
| repair.css | `9b316c77a01fdd02e823a6032d12706456d7d3861c8ad4f2b1a9f8c46b76f616` |
| RepairDocuments.tsx | `7d9e62fc0e3f66b8453cfc6c67ee20de2b6749b0175416d0fd3e3111a9e65323` |
| RepairReadinessPanel.tsx | `d5083d34857961a32ef4c288b5f0be257b2d970c7f334c515cef5c2b99ac88b7` |
| RepairReplacementStock.tsx | `c907bafd3688ab2913259c9f1bb6024b9fa26c9212c2882e7d37911dbae6ca8e` |
| RepairWorkbenchPage.tsx | `7a90ca43bd50826ee4ed2508701c13df505d09504d51692c973883677d83685b` |
| RepairWorkflowPanel.tsx | `e812edcc4cb1e91a5f34a5fc6c1dc7fed61bd8eaaa949e9230308cd59e227278` |

供 DOA 審查的繁中操作文字，應取代前次 UI 提案中已移除的常駐說明：

> 清單以產品名稱辨識實物，核對案件號與 SN/SKU 後用品名或「開啟案件」開案。主區填寫檢修單或維修單，儲存草稿、提交與列印分開；列印採已保存版。案件操作位於桌面側欄、手機表單後方。「送客服確認」後依目前檢修/估價/報價版次、顧客同意及必要款項等待放行；「客服與放行」可展開實際核對資料。原件與原廠作業、實物交接及同步歷史按需展開，實际工作與版本不刪除。預留獨立保存，放棄工作單草稿不取消預留，不使用時按「取消預留」。登記原廠寄回須有實際物流，取消不等於已返還。作業失敗仍在外層可見；已交物流之同步 tags 標記歷史，不能當本次同步或顧客通知成功。這些呈現不代替後端本人/公司權限、當版同意/款項、庫存及複驗門檻。

English proposal:

> Identify the physical item by product name, case number and SN/SKU, then open it through the product link or Open case. Use the inspection or repair form in the main area; save draft, submit and print are distinct, and printing uses the saved version. Case actions appear beside the form on desktop and after it on mobile. After Send to customer service, wait for the current inspection/estimate/quote review, customer consent and required payment release. Expand Customer service and release to inspect actual evidence. Original-item/factory operations, physical handoffs and synchronization history expand on demand without deleting work or versions. Reservations persist independently; discarding a document draft does not cancel them. Cancel unused reservations explicitly. Record a factory return only from actual logistics; cancellation is not physical return. Operation failures remain visible outside collapsed details. Dispatched items label prior delivery acknowledgements as history; they do not prove this dispatch synchronization or customer notification. Presentation does not replace backend ownership/company permissions, current consent/payment, stock or QC gates.

待 DOA/收發在 fetch 並核對新完整 SHA 後獨立接收，中央雙語指南/knowledge check、最後整合 SHA 及 DEV 候選/流量驗收仍分開記錄。錄影、發票新 gate、顧客報告及真正封存仍是另批共同契約工作，不在此 UI 提交冒稱完成。
