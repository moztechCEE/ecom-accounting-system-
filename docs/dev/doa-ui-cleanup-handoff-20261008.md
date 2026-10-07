# DOA 工作台文字清理交接（2026-10-08）

本批只簡化 ERP 原生售後入口、客服補建收件及共用頂部的指定文字，不改售後流程。工作台保留清楚的頁名、六類入口、案件總覽、原表單、真實紀錄與必要阻擋提示。

## 固定基準與所有權

- 基準：`264352c5b863d9928a36ab2a9dbecc697f35a028`。
- 分支：`codex/doa-ui-cleanup-20261008`。
- 獨立工作樹：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-doa-ui-cleanup-20261008`。
- 遠端：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- 原 `corely-erp-aftersales-20261005` 工作樹在建立與測試後仍為上述基準且乾淨；沒有修改正在交付的 264 版本。
- 依已核對的設計原則 `/Users/moztecheason/Documents/ChatGPT/corely AI/warranty-platform/docs/ui-design-principles.md`，移除長篇教學與重複頁名，同時保留鍵盤、行動版、錯誤及權限提示。

## 本批檔案與操作保留

| 檔案 | 顯示變更 | 保留的行為 |
| --- | --- | --- |
| `frontend/src/pages/after-sales/AfterSalesWorkbenchHub.tsx` | 移除首頁介紹與六張入口的說明文字 | 原 `h2`、`aria-labelledby`、六類按鈕、案件總覽、返回按鈕與依權限顯示的支援入口 |
| `frontend/src/pages/after-sales/workbench-model.ts` | 移除入口 `description` 顯示資料 | 原 sections、case enums、名稱、白名單、ENTITY/SUPER_ADMIN 與各專用授權判斷 |
| `frontend/src/pages/mailroom/CustomerIntakeQueue.tsx` | 移除常駐長教學；縮短按鈕、欄位、成功及放棄提示 | 原本人接手、案件／申報品項選擇、核對依據、版本／數量檢查、requestId、回執查核與未保存提醒 |
| `frontend/src/pages/AfterSalesModulePage.tsx` | 縮短權限、逾時、功能不符、收件返回與重開提示 | 原 launch、同公司與來源就緒驗證、iframe、已掛載草稿、概況、未保存確認及返回同一收件 |
| `frontend/src/components/DashboardLayout.tsx` | 登入偏好回饋縮為「已設為此瀏覽器的登入預設」；只在有權使用的售後首頁隱藏頂部重複頁名 | 原公司／帳號／瀏覽器偏好範圍、工作區切換、導航、手機主選單、內容可存取標題；阻擋頁與其他頁名照舊 |
| `frontend/tests/after-sales-module-dom.test.ts` | 同步兩處權限提示預期文字 | 原真實 Module/Hub/router/modal/guard 回歸情境 |
| `frontend/tests/workspace-company-dom.test.mjs` | 在既有實際 Layout fixture 新增真實 Hub 桌面／手機與 SELF 阻擋檢查 | 原公司快照、同步、查詢切換及側欄搜尋回歸 |

沒有新增另一套 CRUD、API、伺服器偏好、資料表、角色或授權；沒有改 Source、維修工作台、其他收發室頁面、AGENTS 或中央知識檔。`CustomerIntakeQueue.tsx` 是本批明確分配的 DOA 客服交辦介面。

收件表格的「檢視交辦」仍開啟原抽屜；「開啟案件中心」仍前往原案件中心；「確認綁定收件」仍呼叫原 `bind_intake`。縮短成功訊息沒有改變成功判定；保存後重載失敗仍明示「勿重建案件」。保管人、位置、SN、申報數量、版次及已綁定來源仍取自實際紀錄。

## 舊名稱與原資料對照

舊名稱改放交接與 Claw 說明，不常駐顯示在入口下方。

| 目前入口 | 舊名稱 | section | 原 case type |
| --- | --- | --- | --- |
| 補寄服務 | 漏寄補寄 | `reshipments` | `RESHIPMENT` |
| 商品與配件訂購 | 私下購買 | `private-purchases` | `PRIVATE_PURCHASE` |
| 檢測與維修 | 維修 | `repairs` | `REPAIR` |
| 換貨服務 | 來回件 | `exchange-returns` | `EXCHANGE_RETURN` |
| 退貨退款 | 退款派車 | `refund-pickups` | `REFUND_PICKUP` |
| 產品問題回報 | 客戶問題 | `customer-issues` | `CUSTOMER_ISSUE` |

入口沿用原類型清單／功能路由，沒有改原新增表單。選取某張入口不代表替原空白新增表單指定類型；原 Source 空白新增表單的預設 `RESHIPMENT` 並非本批修正範圍，建立時仍須核對案件類型。本批沒有宣稱完成這項自動帶入。

## Claw 交接與已知知識漂移

父整合代理擁有中央知識更新，本批不執行寫入生成器。合併後須依 AGENTS 核對雙語內容與 source hashes，再執行 coverage/drift check：

- `after-sales-customer-workbench`：說明新舊入口對照、授權、案件概況、原表單及未保存操作；常駐教學已移除，不應再描述為畫面介紹段落。
- `after-sales-native-cases`、`mailroom-workbench`、`personal-inbox`：說明「接手交辦 → 案件中心新增或選既有案件 → 回到同一收件綁定」，保留案件建立與實物交接為不同事實、不可重建及核對版次／申報品項的說明。
- `dashboard`：偏好仍限定本人、公司與目前瀏覽器；只縮短成功回饋，沒有全裝置同步或新增授權。
- 現有 catalog 的 sourcePaths 已引用本批五個產品檔案，因此相關 guide hashes 會漂移。除上述主要語意外，`repair-workbench` 及既有 `after-sales-native-*` 依賴亦須由整合生成器重新核對；不因此重新開放已排除的 FAQ 入口。

移除的是常駐說明，沒有刪除動作或資料欄位；詳細工作步驟應由既有「這頁怎麼用」入口提供。中央更新尚未完成，所以此提交尚不是可直接部署的完整知識同步版本。

## 實際驗證

以下命令均在獨立工作樹的 `frontend` 執行：

```sh
node --experimental-strip-types --test tests/after-sales-module-dom.test.ts
node --test tests/workspace-company-dom.test.mjs
node --import /private/tmp/corely-doa-release-20261008/doa-cleanup-ts-resolver.mjs --test tests/after-sales-hub.test.ts tests/mailroom-intake.test.ts
./node_modules/.bin/eslint src/pages/after-sales/AfterSalesWorkbenchHub.tsx src/pages/after-sales/workbench-model.ts src/pages/mailroom/CustomerIntakeQueue.tsx src/pages/AfterSalesModulePage.tsx src/components/DashboardLayout.tsx tests/after-sales-module-dom.test.ts tests/workspace-company-dom.test.mjs
```

- Module DOM：8/8 PASS，skip 0；六類功能／公司路由、專用財務授權、SELF/DEPARTMENT 阻擋、概況與草稿保留／放棄情境。
- 公司／Layout DOM：7/7 PASS，skip 0；原公司隔離情境及新增桌面 1440／手機 390 售後首頁，保留單一可存取標題、六入口與案件總覽、手機主選單、內容無橫向溢出；SELF 阻擋仍有頂部頁名。
- Hub＋客服收件 pure：11/11 PASS，skip 0；六類原枚舉／路由、權限與來源範圍、綁定 payload 與回執核對。私有 TS runner 只處理既有 Vite 無副檔名與型別匯入，不寫產品檔案或替換產品依賴。
- Scoped ESLint 與 `git diff --check`：PASS。

測試使用真實 React 元件及原判斷，auth/API/無關 widgets 或來源邊界受控；只啟動 loopback fixture，外部來源阻擋，沒有真業務寫入。沒有把這些測試宣稱為真正 Source 表單、LINE、收款、發票、庫存或實物驗收。本批未重跑無變動的全面測試／建置，也未操作雲端或資料庫。

## 交付狀態

本批提交為隔離分支的本機固定版本，完成後完整 SHA 由交接訊息提供。尚未 push、合併或部署；須先由父代理審查本批 diff，與其他工作台清理及中央知識更新整合，再走 DEV 驗收。原 264 交付進度由其部署代理獨立處理。
