# SN 與標籤工作區交接

> 本文件為 2026-09-19 的歷史紀錄。年份與後續規則已由使用者更新，請優先閱讀 [2026-09-21 規則交接](sn-label-rules-20260921.md)；不可沿用此處舊年份算法。

## 本輪範圍

使用者要求先建基本架構，已確認年份採西元後兩碼，例如 2024 → 24、2026 → 26。
其他流水號、箱號、裝箱對應、匯入及掃箱出庫規則尚待使用者確認。
本輪完成 ERP 前端草稿工作區；沒有正式序號配發服務、資料庫 migration 或庫存異動。

## 協作基線

- 工作目錄：`/Users/moztecheason/ecom-sn-workspace-20260919`
- 獨立分支：`codex/sn-label-workspace-20260919`
- 起點：`origin/codex/operations-corely-20260910` 的 `2ec8282d`。
- 原始目錄仍有售後未提交變更，本輪未操作該目錄的檔案。
- 開始及完成驗證時均執行 `git fetch origin`；遠端 operations 分支仍為 `2ec8282d`，main 仍為 `a3791c48`。
- main 尚未包含 operations 新導覽；不可把整個功能分支直接合入 main 當成只有 SN 的修改。
- 本輪沒有 merge、push、PR 或部署。後續整合前須重查遠端提交、其他工作目錄及部署入口。

## 改了什麼

- 側欄採購庫存新增「SN 與標籤」，路由 `/inventory/sn-labels`，沿用 `inventory:read`。
- 批次草稿：使用既有唯讀產品 API 帶入產品、型號、SKU、條碼；款式與顏色手填，不猜測自由屬性對應。
- 草稿明確標示為瀏覽器本機保存，以公司與使用者分隔 key；最多 100 筆，拒絕損毀資料與偵測跨分頁覆寫。
- 編碼規則與標籤元件放在 `frontend/src/features/sn-labels/`，與頁面、導覽分開。
- 西元後兩碼已確定；編碼年暫由使用者手動指定，不推定下單或製造日期為年份來源。
- SN 僅做格式樣張，`000001` 不代表下一個可用序號、不占號。QR 樣張內容使用 `DRAFT:` 前綴。
- 向量 SVG 標籤：文字及 QR 拖曳、QR 等比縮放、毫米座標、尺寸與字級調整、預覽倍率；彩盒強制保留 QR，機身可關閉。
- SVG 樣張包含草稿標示，匯出設定實際 mm 尺寸並移除編輯把手。文字超界或與 QR 重疊時禁止匯出。
- 裝箱僅估算完整箱與尾箱；正式箱號、箱內 SN、PDF 批次輸出、匯入檔及扣庫存仍未啟用。
- 明確宣告既有 Ant Design 使用的 `@rc-component/qrcode@1.1.0` 為直接依賴，未升級其他套件。

## 已驗證

- `cd frontend && npm run build`：TypeScript 與 production build 通過。
- `npx tsx --test tests/sn-labels.test.ts tests/navigation.test.ts`：14 tests 通過。
- 新增 SN 程式與 fixture 的 ESLint 通過；`git diff --check` 通過。
- 直接用 Node 跑舊 navigation 測試會因既有 extensionless TS imports 失敗；使用 tsx 完整重跑通過。
- 本機 fixture 瀏覽器操作：產品選取、SN `A16LK26000001`、100 件每箱 20 件估算 5 箱、保存與重新整理後開啟、QR 拖曳及等比縮放、文字超界禁止匯出、缺少庫存權限時顯示 403 且選單隱藏。
- 390px 手機斷點已看圖；頁面寬度與可視寬度相等，沒有整頁水平溢出；預覽倍率與列印尺寸分開。
- fixture 所有 `/api/` 請求由本機 middleware 接管，非 GET 回 405；未使用正式帳號、產品或寫入 API。

## 尚未確認

- SVG 下載按鈕已實作，內嵌瀏覽器下載事件等待逾時，未取得可查核的下載檔案；需在一般瀏覽器驗收實際檔案落地、QR 解碼、字型與工廠試印。
- 生產登入／真實產品 API、不同公司切換與正式角色配置未做端到端驗收。
- 目前草稿非伺服器共享資料，不支援跨電腦同步或稽核履歷。瀏覽器資料清除會遺失草稿，離開 SPA 頁面前須按儲存。
- 尚無共用模板庫、多選批次匯出、外箱標籤設計、向量 PDF、倉儲或保固匯入檔。
- 現有 build 的大型 bundle 與 browsers data 過期警告仍存在；瀏覽器亦顯示既有 Ant Design 5 / React 19 相容性提醒。

## 後續架構邊界

規則確認後，建議將 SnRule（版本化編碼規則）、LabelTemplate（版型）、SnBatch（批次）與 SerialAllocation（正式配號）分開。
正式配號須在後端交易中處理計數器、全域或約定範圍的唯一約束、冪等請求、作廢及稽核；不可使用瀏覽器樣張當成正式序號。
Carton 與 CartonItem 應保存每一筆 SN 的實際箱內關係與順序，不能只記錄起訖序號。
生成序號、匯入倉儲／保固、入庫、出庫是不同狀態與權限；單次查詢掃描不可直接扣庫存。
年份取自下單年或製造年仍需確認，不能因已確認 24／26 格式而推定日期來源。

## 重疊檔案與整合方式

- 共享：`frontend/src/App.tsx`、`frontend/src/config/navigation.ts`、`frontend/tests/navigation.test.ts`、`frontend/package.json` 與 lockfile。
- 其餘皆為獨立 SN 檔案；未修改 DashboardLayout、Sidebar 舊元件、後端、資料表、售後或儲運業務邏輯。
- 如果團隊沿用 operations 分支，先 fetch 並檢查上述共享檔案，再以單一 SN commit 整合。
- 若改以 main 作整合基底，必須先解決新版導覽的依賴，不應順便帶入整個 operations 差異。
- 正式發布須走團隊約定入口；本文件不授權直接執行部署腳本。

## 本機預覽

```sh
cd /Users/moztecheason/ecom-sn-workspace-20260919/frontend
npm ci --no-audit --no-fund
npx vite --config tests/sn-preview.config.ts --host 127.0.0.1 --port 4186 --strictPort
```

開啟 `http://127.0.0.1:4186/tests/sn-preview.html`；加上 `?denied=1` 可驗證無權限狀態。
此入口只使用虛構產品，不包含在 production index 中。
