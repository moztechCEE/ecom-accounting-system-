# ERP → existing WMS sections — 2026-09-22

## Confirmed scope
The user explicitly selected: ERP navigation opens the corresponding existing WMS pages and preserves the existing WMS application. This supersedes the earlier native-ERP-only design for this task. It is a navigation integration, not a shared-token login, a rewrite of warehouse commands, or formal ERP/WMS data synchronization.

- ERP worktree `/Users/moztecheason/ecom-erp-wms-links-20260922`, branch `codex/erp-wms-links-20260922`; source `de7cc6cb6ec5eedbf65bf253a1944c8e21f425ba`, based on DEV `918dad81`.
- WMS worktree `/Users/moztecheason/corely-wms-erp-entry-20260922`, branch `codex/wms-erp-entry-20260922`; source `a59954cfe6f1dc9e662bfdefd4e8804192c257d9`, based on the currently served WMS DEV source `c008ee7`.
- No push/merge. Other Codex worktrees remain unchanged, including the dirty warehouse UI release worktree. ERP main `a3791c48`, operations remote `2ec8282d`, WMS main `543c6dd3` inspected. No whole-branch replacement.
- Shared integration files: ERP App, DashboardLayout, navigation, runtime server/config; WMS App, LoginPage, TaskDashboard. Future merges must preserve the existing DEV fixes and this return-path handling.

## Behavior
ERP sidebar and command palette open a new WMS tab. Internal `/warehouse/...` bookmarks also resolve to the matching existing section. Runtime `WMS_PORTAL_URL` enables this mode; when unset, the existing native ERP routes remain available. DEV accepts only the verified WMS DEV origin and never production. No ERP account data or token appears in links.

WMS enforces its existing login, role checks and backend permissions. Missing sessions preserve an allowlisted relative target in the login URL, including after refresh. Login returns to that target. External redirects, API targets, credential query strings and unknown targets are rejected. This does not provision WMS accounts or silently grant WMS roles. Existing WMS users log in once per valid session.

| ERP section | WMS path |
| --- | --- |
| 作業工作台 | `/tasks` |
| 揀貨作業 | `/tasks?group=pick` |
| 裝箱核對 | `/tasks?group=pack` |
| 完成紀錄 | `/tasks?view=completed` |
| 出貨管理 | `/admin` |
| 通路訂單轉檔 | `/admin/marketplace-converter` |
| 預揀與倉庫放行 | `/warehouse-intakes` |
| 儲運分析 | `/admin/analytics` |
| 操作日誌 | `/admin/operation-logs` |
| 例外總覽 | `/admin/exceptions` |
| 刷錯分析 | `/admin/scan-errors` |
| 新品不良分析 | `/admin/defects` |
| 物流查詢 | `/settings/logistics` |
| 團隊公告 | `/team` |
| 儲運人員 | `/admin/users` |
| 儲運設定 | `/settings` |

Order details, comments, SN/quantity verification, exceptions, printing and batch details continue through existing WMS controls; their backend logic and data are not replaced.

## Validation
- ERP: 17 focused navigation/access/error tests passed; production build passed.
- WMS: 246 frontend tests passed, including login destination validation, query filters, existing claim/scan controllers, account-switch isolation, import, printing and other existing regressions. DEV frontend build passed.
- Initial full suite failures came from fixture resolvers missing the newly imported real helper, the new URLSearchParams VM global, and unlinked backend dependencies in the isolated worktree. Updated the fixtures and reused existing installed dependencies; final full suite passes.
- Runtime images are built from the currently deployed immutable frontend bases, replacing only freshly built frontend files and ERP runtime config server. Backend and dependency diffs are asserted empty before packaging.
- Real WMS login requested from the user for authenticated navigation verification; never requested plaintext credentials in chat. No real order claim/scan/import or permission change is part of this navigation acceptance.

## Deployment receipt
Cloud Build `9aa9ff62-f7ef-437d-ba16-0c1ac821f7d2` succeeded. Both DEV frontends are deployed and receive 100% traffic:

- ERP DEV: `corely-erp-dev-00004-lc7`, generation 4, image digest `f508452e2cf5da4951d258e89a34c02513e1532aa71c643070cfcf315eb0825a`.
- WMS DEV: `corely-wms-dev-00019-rss`, generation 37, web image digest `80b5c8bbb447469aecb968137de24113653ce67d9fd58d9b6bf88fc7ecbbaa0b`.
- ERP runtime `WMS_PORTAL_URL=https://corely-wms-dev-sp5g377smq-de.a.run.app`; retained in `scripts/dev/deploy-built.sh` for subsequent DEV releases. This script-only follow-up does not require another frontend build.
- ERP DEV API remains `corely-erp-api-dev-00002-d4n`. WMS DEV API container image remains `3e036925b484f4663d39f37d2fcffdc67de7ce9b161efc1b60ef4692db12ab8b`. Existing DEV databases and external-call restrictions are unchanged.
- Post-release production revisions, traffic and generations match the baseline below. Full readback is in `erp-wms-direct-entry-release-20260922.json`.

Live browser verification: the authenticated ERP TEST session renders all 16 WMS entries. Clicking 揀貨作業 opens a separate WMS DEV tab at `/login?next=%2Ftasks%3Fgroup%3Dpick`; clicking 操作日誌 opens `/login?next=%2Fadmin%2Foperation-logs`. ERP remains on its dashboard. The WMS login form renders and preserves the destination. An initial ERP tab load was blank; one reload rendered the dashboard and links, with no captured browser exception. The blank load was not reproduced or attributed to a confirmed cause.

Authenticated WMS return and warehouse operations remain unverified with a real user session: the browser has no WMS session and the user has not yet completed the requested login. Automated redirect/filter tests passed, but they are not evidence of physical picking, scanning, printing or ERP/WMS data synchronization. No operational records were written during this acceptance.

Production baseline (unchanged after release): ERP API `ecom-accounting-backend-00506-ray` generation 509; ERP web `ecom-accounting-frontend-00270-vob` generation 271; WMS `corely-wms-import-footer-20260917` generation 42. DEV baseline before this release: ERP web generation 3; ERP API generation 2; WMS DEV generation 35. Recheck before any future release; these are timestamped receipts, not authority to replace another agent's newer deployment.
