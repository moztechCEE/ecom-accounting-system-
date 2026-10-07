# DOA 共用公司上下文與導覽複核（2026-10-08）

## 範圍與版本

- 工作樹：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005`。
- HEAD：`ad406d84679bb7b1a54f08bc4df35aa73fc765c3`。本次審查六個尚未提交的共享前端檔案差異，不是已固定的新 commit／DEV 版本。
- 已讀 AGENTS。Root 同時修改知識文件，另一位 agent 正在準備／執行 DOM 測試；本作者沒有修改產品、測試、知識文件或其他人的檔案，只新增本報告。
- 審查六檔 diff SHA256：`4aa54d53995848021e4366462ea4e9a79eef5e2bf109ea81744a458d0e45bab6`。

## 判定：SCOPE_PASS

在這六檔及必要共用呼叫鏈，沒有發現新的 P1／P2。網址中的非空 `entityId` 優先於瀏覽器公司；Dashboard 的讀取與使用者明確觸發同步使用同一公司，並用 company key 重建快照；切台、側欄及功能搜尋保留公司，而不覆蓋目標自己指定的公司。儲運管理者切換與儲存為登入預設時均進工作站。這些変更沒有新增權限、角色授予、Storage 公司寫入或自動同步業務動作。

| 核對項目 | 原碼結論／具體觸發 | 依據 |
| --- | --- | --- |
| 公司 query 優先 | `?entityId=B` 在 render 時即回 B，不等 effect；storage=A 不會蓋 B。空白／未指定才用原 Storage fallback。storage/focus listeners 只更新 fallback，且 cleanup 移除 listener。 | [useEntityContext.ts](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/hooks/useEntityContext.ts:9>) |
| Dashboard API 公司 | companyId 傳入 resolveEntityId 的 explicit 分支，13 個讀取分支用 resolved 同一 entity；API interceptor 只附 token，不覆寫公司參數。一般同步、廣告同步及發票狀態同步也從 companyId 取公司；此審查沒有按同步按鈕或呼叫服務。 | [DashboardPage.tsx](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/pages/DashboardPage.tsx:344>)、[resolveEntityId](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/services/entities.service.ts:71>)、[API interceptor](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/services/api.ts:80>) |
| A/B 快照隔離 | `<DashboardCompanyPage key={entityId}>` 令 A→B／B→A 都建立新的 state/ref；先前成功快照、partial/stale、financial availability、KPI、日期及錯誤不帶到另一公司。旧 effect cleanup 的 ignore=true 阻止晚回應更新；成功與 catch 路徑都核 ignore。partial/error 只可能保留同一次公司 mount 的資料。 | [remount](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/pages/DashboardPage.tsx:276>)、[state/ref](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/pages/DashboardPage.tsx:288>)、[晚回應守門](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/pages/DashboardPage.tsx:465>)、[catch/cleanup](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/pages/DashboardPage.tsx:570>) |
| 目標公司與其他參數 | helper 只在目前 query 有非空 entityId、且目標没有 entityId 時補入。目標 `?entityId=C` 保留 C；目標 queue／其他 query／hash 保留，不把來源的 intakeItemId 或其他暫態參數全數複製。外部 WarehouseLink 分支不使用此 helper。 | [companyNavigationDestination](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/config/workspaces.ts:19>)、[CommandPalette](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/components/CommandPalette.tsx:33>) |
| 側欄／搜尋／個人頁 | Sidebar、CommandPalette 與 profile 都以目前 location.search 補公司；workspace switch 用同一 helper。沒有修改 visibleNavigation 或可用工作區權限條件。 | [DashboardLayout sidebar](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/components/DashboardLayout.tsx:82>)、[切台](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/components/DashboardLayout.tsx:95>)、[profile](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/components/DashboardLayout.tsx:141>) |
| 儲運管理者目的地 | 有既有 wms_tasks:read 與 overview/report read 的管理者選 warehouse 時進 `/warehouse/workstation`，operationsWorkspace 回 warehouse；同帳號／公司儲存 warehouse preference 後，loginDestination 用同一 destination helper，因此也進 workstation。未儲存 preference 的既有自動登入分支仍為 `/warehouse` 總覽；沒有將這兩個語意混稱。 | [目的地](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/config/workspaces.ts:26>)、[manager predicate](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/config/workspaces.ts:108>)、[登入](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/utils/login-destination.ts:6>)、[Route](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/App.tsx:142>) |
| preference／Storage／權限 | workspaceCompanyId trim query，設定預設依帳號+該公司 key；preference 可用性重查既有 grants，密碼變更仍優先。新增 query 導覽本身不寫 Storage；既有點擊「設為登入預設」、sidebar preference 持久化與無 explicit 公司時 resolveEntityId 初始 fallback 寫入均保留，不可聲稱整頁從未有 Storage 副作用。沒有 backend／grant 變更；前端指定公司不構成後端授權證明。 | [browser preference](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/config/workspaces.ts:73>)、[設定預設](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/components/DashboardLayout.tsx:97>)、[既有 fallback](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/frontend/src/services/entities.service.ts:85>) |

## 本作者實際驗證

- 既有 Node pure suites：`employee-workspaces.test.ts` **7/7**（包含 Root 本輪追加的儲運管理者／目標公司測試）、`navigation.test.ts` **15/15**、`after-sales-workbench.test.ts` **4/4**，合計 **26/26 PASS**。
- 在各 suite 獨立 Node process，使用既有 TypeScript `transpileModule` 記憶體載入，Vite env 設為空測試環境，保留測試自己的 window flags／Storage mock；沒有產生檔案或連線。第一次 CJS loader 未處理 import.meta 而在測試註冊前停下，修正測試載入方式後才取得上述 26 PASS；這不是產品測試失敗。
- `frontend/node_modules/.bin/tsc --project frontend/tsconfig.app.json --noEmit --incremental false`：**PASS，exit 0**；沒有 build／emit。
- 六檔 `git diff --check`：**PASS**。
- **DOM／React 晚回應與實際點擊測試由另位 agent 提供**，本作者沒有執行、借用或把其尚未收到的結果填成 PASS。亦沒有 DEV／正式／API／DB／provider 操作。

## 審查 bytes（未固定新 commit）

| 路徑（相對 ERP worktree） | SHA256 |
| --- | --- |
| frontend/src/hooks/useEntityContext.ts | abe003181b325410c2b9728e70617980421c48bf7d1f378918a2913572e276b0 |
| frontend/src/pages/DashboardPage.tsx | 4407178a88bd8983882956ff82bb771021664da6942131eec5eb88e0c5f9f452 |
| frontend/src/config/workspaces.ts | e88ae442633e34c2c35f7f8908cfb592b5926069932274bf3d45619b5dd7e008 |
| frontend/src/utils/login-destination.ts | fe9151d5a3588f69c6508c583328b5962e0275f53981fdb705b50d5fe5ce3b3d |
| frontend/src/components/DashboardLayout.tsx | b0f03da18164123a8f93d5750c43734c0bca4511ef7171715c668d1467da9736 |
| frontend/src/components/CommandPalette.tsx | 25784ef969924c6c0dfc8f8bbcbea72b8a488721de49a6a98217c0bcb0864f05 |

本結論只針對以上 bytes 的新增邏輯。共用 useEntityContext 的其他舊 caller、全部頁面、後端公司資料 scope、已在途的使用者同步／付款／provider，以及 knowledge 更新不在本輪全面驗收範圍。
