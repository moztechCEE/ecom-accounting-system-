# ERP Copilot operating knowledge / ERP Copilot 操作知識

本目錄是從已審閱的 ERP 頁面、controller 與路由設定建立的靜態操作指南。它不註冊 AI 工具，不授權存取資料，也不代表所有模組都支援即時查詢或可由 AI 執行。原本 24 篇指南保留穩定 ID；過期內容可以經來源審閱修正。

This is a static operating catalog based on reviewed ERP pages, controllers and route configuration. It registers no tools, grants no data access, and does not imply live query or execution support for every module. The original 24 guides keep stable IDs; reviewed corrections to stale prose are allowed.

## Coverage / 覆蓋

59 bilingual entries cover 9 navigation groups and 70 route or filter entry points, including all 16 configured WMS portal destinations. The root route is a role-dependent redirect. Employee login/reset routes are aliases of the account-security guide; the separate customer login, procurement request and formal quote routes have dedicated B2B guides. The parameterized warehouse route is expanded from the reviewed WMS and report configuration.

59 篇雙語指南涵蓋 9 個導覽群組及 70 個路由或篩選入口，含全部 16 個 WMS 入口。根路由依角色導向；員工登入與重設密碼列為帳號安全指南入口，獨立的客戶登入、採購需求及正式報價路由另有 B2B 指南。動態儲運路由依已審閱的 WMS 與報表設定展開。

| Group / 群組 | Scope / 範圍 |
| --- | --- |
| Overview / 營運總覽 | Company, period, data freshness and source metrics / 公司、期間、資料狀態與來源指標 |
| Sales / 訂單銷售 | Orders, quotations, customers and B2B procurement / 訂單、報價、客戶與 B2B 採購 |
| After-sales / 售後 | Case workspace, internal cases and unsent quote drafts / 案件、內部紀錄與未發送草稿 |
| Warehouse / 儲運 | ERP workspace and permission-controlled WMS destinations / ERP 工作區與依權限開放的 WMS 入口 |
| Purchasing and inventory / 採購庫存 | Vendors, landed cost, receiving, products, SN, assembly and handover reconciliation / 供應商、到岸成本、收貨、產品、序號、組裝與交運核銷 |
| Finance / 財務會計 | Expenses, approvals, payments, AR, banking, journals, accounts, periods, reconciliation and reports / 費用、審批、付款、應收、銀行、分錄、科目、期間、對帳與報表 |
| People / 人資考勤 | Employee supervisors, attendance, leave review and payroll / 員工主管、出勤、請假審核與薪資 |
| Administration / 系統管理 | Access, companies, reimbursement policies, settings, brands and import preview / 權限、公司、報銷政策、設定、品牌與匯入預覽 |
| Personal and assistant / 個人與助手 | Profile, authentication guidance and AI limits / 個人資料、驗證流程與 AI 邊界 |

## Feature boundaries / 功能界線

- The current staged-disabled deployment uses the existing after-sales page. New quote and brand routes are labeled `staged` and explain their redirect. / 目前 staged 未啟用時使用既有售後頁；新報價與品牌指南明示導回行為。
- WMS articles describe reviewed ERP entry points, not unreviewed internal WMS workflows. ERP and WMS authorization both apply. / WMS 篇章說明已核對的 ERP 入口，不宣稱了解未審閱的 WMS 內部流程。
- Customer B2B access uses a separate session and company scope. A submitted request is a price estimate; staff must manually review every line and issue a fixed formal quote version. The customer signs in to accept the latest valid version, then sales confirms the order and reserves stock. Request sharing, quote issuance and acceptance do not reserve or deduct stock. Supplier account records exist, but supplier login and customer self-service password reset are not available. / 客戶 B2B 入口使用獨立登入及公司隔離。送出的需求是價格試算；員工須逐行人工核庫並出具固定版本正式報價。客戶登入接受最新有效版本後，業務才確認銷單並預留庫存。分享需求、出具或接受報價均不預留或扣除庫存。供應商帳號可建檔，但供應商登入與客戶自助重設密碼尚未提供。
- A B2B shortage can produce a supplier purchase order linked to its source request lines, up to the unpurchased shortage. Creating or receiving that order does not automatically mark the customer's stock as available; staff must manually re-review the request before quoting. / B2B 缺貨可依尚未採購的缺口建立連回客戶需求明細的供應商採購單；建單或收貨不會自動把客戶需求標為有貨，員工須重新人工核庫後才可報價。
- Purchase-order chargeable weight, freight per kilogram and exchange rate produce a landed-cost estimate before receipt. Only receiving writes inbound stock and its cost record. / 採購單的計費重量、每公斤運費與匯率僅於收貨前產生到岸成本估算；實際收貨才寫入庫存與成本紀錄。
- WMS packing is not final ERP stock deduction. A real handover event with package and logistics evidence enters reconciliation; an authorized employee must approve each line, with source, reservation and stock conflicts blocking posting. / WMS 裝箱不是 ERP 正式扣庫。實際交運及箱件、物流證據進入待核銷後，授權員工須逐行核准；來源、預留或庫存衝突會阻止過帳。
- Spreadsheet import only previews the first worksheet in the browser. Assembly creation and account creation buttons currently lack connected handlers. Notification/security/general-setting tabs are preview-only. / 匯入僅本機預覽；建立組裝工單、新增科目的按鈕尚未接事件；系統通知、安全、一般設定仍為預覽。
- Expense recognition is advisory. Approval, payment recording, bank transfer and journal posting remain distinct. The current Copilot bank tool totals imported transactions, not live bank availability. / 憑證辨識是建議；核准、付款登記、匯款與過帳分開；Copilot 銀行工具只彙總已匯入交易。
- Examples are synthetic form/preview data, not ready-to-run API requests or company records. / JSON 與 CSV 範例是虛構填表或預覽資料，不是真實單據或可執行 API 請求。

## Ownership and contract / 維護與契約

- Author: `backend/src/modules/ai/knowledge/catalog.source.json`.
- Original snapshot: `legacy-entries.json`; keep IDs and document any original route override. Do not rewrite the snapshot to silence checks.
- Exports: `knowledge/index.ts` → `KnowledgeEntry`, `KNOWLEDGE_ENTRIES`, `KNOWLEDGE_SOURCE_VERSION`.
- `title`, `summary`, `category`, `keywords` and `sections` are zh-TW; `translations.en` contains the English counterparts. `related` contains entry IDs, not pre-expanded content.
- The backend must filter the full entry before search, list, detail or AI context. `permissions` are OR; `roles` are OR; both present means both conditions apply. Route authorization remains required. Related guides must be filtered again.
- `availability` is descriptive, not authorization. WMS requires `wms_tasks:read` plus the relevant section permission or role; additional route rules remain in the access service.
- Pathless AI and account-security guides can be read by authenticated users without linking to an admin setting or forcing a password-change screen.

## Review, generate and verify / 審閱、產生與驗證

```sh
node scripts/dev/generate-copilot-knowledge.cjs --check
node --test scripts/dev/generate-copilot-knowledge.spec.cjs
```

`--check` is read-only. It validates both languages, related IDs, resolved nested routes and expanded WMS destinations, original guide IDs/routes, safe examples, and the exact reviewed-source hashes. A failed check identifies changed sources; it must not be “fixed” by blindly regenerating hashes.

`--check` 不寫檔。若來源變動，先讀差異，修改受影響的中英文步驟及資料邊界，確認權限與路由，再執行：

```sh
node scripts/dev/generate-copilot-knowledge.cjs --write
node scripts/dev/generate-copilot-knowledge.cjs --check
```

The generator hashes only the explicitly curated `sourcePaths`, the catalog and the original snapshot. It does not crawl the repository, ingest secrets or build a vector index. `sourceVersion` is a deterministic content hash, not a claim that all repository code was reviewed. `reviewedBaseCommit` records the starting revision; exact per-source hashes identify the files used at generation. Source-manifest coverage is documentation coverage, not operational acceptance or executor coverage.

來源版本只涵蓋明確列入 `sourcePaths` 的已審閱檔案及語料，不代表審閱整個 repo。manifest 的 coverage 是操作文件覆蓋，不等於所有功能已通過現場驗收或已接入 AI 執行工具。
