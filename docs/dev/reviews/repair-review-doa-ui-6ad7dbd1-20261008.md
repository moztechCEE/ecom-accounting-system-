# 維修接收審查：DOA UI 清理固定 6ad7dbd1（2026-10-08）

結論：**PASS_SCOPE**。固定 `264352c5b863d9928a36ab2a9dbecc697f35a028..6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1` 的指定 UI 清理範圍未發現新增 P1／P2。兩組指定離線 DOM 測試合計 TAP 15/15 PASS（13 個葉節點與 2 個外層測試），skip 0。本回執不是整批接收、DEV 或發布 PASS；原 base 264 的 GET 混權限／false-empty P2 與中央知識更新仍待整合處理。

## 固定物件與隔離

- 固定物件與結果完成核對時間：2026-10-08 06:51:42 Asia/Taipei。
- 審查者：維修工作台接收端，獨立子代理 `repair_backend_audit`；根視窗 `01a117fd-0a9e-7882-a4aa-c9a27d34f1d3`。
- Repo 遠端：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- 指定 ref：`refs/heads/codex/doa-ui-cleanup-20261008`。
- 基底：`264352c5b863d9928a36ab2a9dbecc697f35a028`。
- 被審物件：`6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1`。
- 獨立 detached 工作樹：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-doa-ui-6ad7dbd1-20261008`。
- 先由維修自有且乾淨的 `corely-erp-repair-ui-cleanup-20261008` 執行明確 fetch／ls-remote；兩者及 FETCH_HEAD 均核對到完整 6ad SHA，基底祖先檢查 exit 0，再建立獨立 detached 工作樹。沒有 checkout、reset 或修改任何作者／其他視窗工作樹。
- 審查工作樹 HEAD 與上述完整 6ad SHA 相同，開始與結束的 `git status --porcelain=v1` 均為空。僅重用既有被忽略的 node_modules symlink，沒有安裝／更新依賴。

遠端與固定基準核對命令（維修自有乾淨工作樹）：

```sh
git fetch origin refs/heads/codex/doa-ui-cleanup-20261008
git ls-remote --exit-code origin refs/heads/codex/doa-ui-cleanup-20261008
git rev-parse FETCH_HEAD
git merge-base --is-ancestor 264352c5b863d9928a36ab2a9dbecc697f35a028 6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1
git worktree add --detach '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-doa-ui-6ad7dbd1-20261008' 6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1
```

`ls-remote` 實際結果：`6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1 refs/heads/codex/doa-ui-cleanup-20261008`。本回執依遠端與 Git 固定物件核對；作者 handoff 的「尚未 push」描述是提交前狀態，不代替本次接收證據。

已讀固定工作樹的 `AGENTS.md`、`docs/dev/doa-ui-cleanup-handoff-20261008.md`，並核對協調區 README／狀態界線。AGENTS 與基底 byte 相同，DEV、production、來源隔離與中央知識責任沒有被本批改寫。

## 精確差異範圍

共 8 檔，136 insertions／35 deletions：

1. `frontend/src/pages/after-sales/AfterSalesWorkbenchHub.tsx`
2. `frontend/src/pages/after-sales/workbench-model.ts`
3. `frontend/src/pages/mailroom/CustomerIntakeQueue.tsx`
4. `frontend/src/pages/AfterSalesModulePage.tsx`
5. `frontend/src/components/DashboardLayout.tsx`
6. `frontend/tests/after-sales-module-dom.test.ts`
7. `frontend/tests/workspace-company-dom.test.mjs`
8. `docs/dev/doa-ui-cleanup-handoff-20261008.md`

固定範圍中 `frontend/src/pages/repair`、`frontend/src/services`、`frontend/src/config`、`AGENTS.md`、`backend`、`scripts` 均空 diff；沒有 API／schema、repair helper、原生來源或能力權限異動。沒有新增另一份售後案件／CRUD。

## 實際語意核對

- **Hub／權限：** `AfterSalesWorkbenchHub.tsx:18-25` 保留進入前重新檢查與未知功能／未授權 Alert；`:27-40` 保留 `aria-labelledby`、原生 h2、六入口與案件總覽；`:48-49` 支援導航／權限入口沿用原函式。刪除的是常駐介紹與卡片描述。`workbench-model.ts:4-10` 的六組 section／title／caseType identity 相同；`:37-40` 的 ENTITY／SUPER_ADMIN 與專用 permission 條件及全部函式 body 與基底相同。SELF／DEPARTMENT 不會因文字清理取得入口。
- **來源／公司／草稿：** `AfterSalesModulePage.tsx:49-63` 原 integration／company／permission gate、launch payload `{ entityId, section }`、ticket／action 驗證保留；後續 origin、source、visible launch company／section 驗證保留。`:118-123` 仍沿用原目的地及 entityId query，intakeItemId 只在原 workbench／cases 目的地保留；`:124-128` 原 CustomerRepairQueue 掛載、entityId、queue key、forceRender 與各 queue 的 dirty 合併未動；`:130-140` 未保存確認、概況切換、同一收件返回、錯誤與重開 guard 保留。沒有自動建立案件或更改原 Source 空白表單預設類型。
- **客服收件：** `CustomerIntakeQueue.tsx:18` 原 mailroom:review＋integration gate，`:67-75` 本人 claim／bind allowed-action、執行中 guard、entityId／expectedVersion、requestId、bind payload、command 與 receipt 比對仍相同。收件保存後重載失敗的「勿重建案件」提示仍在；`:79-88` 實際版本、保管人、位置、SN、來源與失敗 Alert 保留；`:94-99` 來源公司／可綁狀態、案件類型／版次警告、品項可用數量、必要核對依據與提交 guard 保留。短按鈕仍呼叫原操作。
- **共用 Layout：** `DashboardLayout.tsx:54-55` 新條件同時要求 exact pathname `/operations/after-sales/workbench`、售後工作區可用與 active 售後 label，`:136` 只據此隱藏 shell 重複 title；原 workspace availability 仍檢查 integration／company scope／授權。`:135` 手機主選單及 `:139` ClawHelpButton 保留。其他頁與 SELF 阻擋頁仍有 shell title。本人／公司／目前瀏覽器的登入偏好規則未改，只縮短成功回饋。
- **維修互串：** repair source 與 service 空 diff；Module 原 CustomerRepairQueue mount、company query、dirty callbacks／forceRender 與專用 permission guards 保留。Claw「這頁怎麼用」入口以靜態差異確認保留，沒有宣稱完成點擊／知識內容驗收。

另以固定 Git 物件的 TypeScript AST 執行独立比對（inline Node／TypeScript parser，exit 0）：25 個原生 API／permission／route／request UUID／偏好呼叫文字相同（Module 7、Intake 10、Hub 3、Layout 5）；Intake 6 個 payload／request／permission 宣告相同；Module 4 個 queue mount／company JSX 屬性相同；Hub model 全部函式 body 與 section／title／caseType identity 相同；AGENTS bytes 相同。這是靜態契約比較，沒有將它計入 DOM 測試數量。

## 接收端實跑

工作目錄：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-doa-ui-6ad7dbd1-20261008/frontend`。

```sh
node --experimental-strip-types --test tests/after-sales-module-dom.test.ts
node --test tests/workspace-company-dom.test.mjs
```

| 實跑 | 實際結果 | 覆蓋與邊界 |
| --- | --- | --- |
| Module DOM | TAP 8/8 PASS；7 個葉節點＋1 外層；fail／skip／cancel 0；17.460 秒 | 真 Module／Hub／router／Tabs／modal／guard；六類實際入口與公司 query、財務專用授權、SELF／DEPARTMENT／ADMIN SELF 阻擋、概況切換與 queue dirty 保留／放棄、第二次 intake deep link 的確認。CustomerRepairQueue／CustomerIntakeQueue 是此 fixture 的受控 queue stub，未宣稱測到真 queue 內部或真正來源案件表單。 |
| Company／LayoutHub DOM | TAP 7/7 PASS；6 個葉節點＋1 外層；fail／skip／cancel 0；9.647 秒 | 真 Layout／Hub／Dashboard／CommandPalette／entity hook／router；query B 優先於 stored A、partial B／failed C 不混 A、late A 不覆蓋 B、目前公司 GET／manual sync／搜尋、桌面與手機 390 的單一可存取 h2／六入口／案件總覽／可開手機主選單／無橫向溢出、SELF 阻擋仍有 shell title。Auth、API adapter、無關 widgets 與 Claw help button 為受控邊界。 |

兩組測試都只使用 loopback fixture 與受控 API／auth。外部 origin 被阻擋，真實業務 HTTP 寫入 0；Module fixture 的 synthetic iframe session-form POST 由 localhost route fulfillment 接住，並非 Source 真服務寫入。沒有外部 LINE／金流／發票／庫存／通知。沒有使用或覆寫作者固定 `/tmp` 截圖；本輪沒有產生／人工檢視截圖。測試的 Vite cache 使用個別 mkdtemp 並由 fixture 清除。

執行過的固定範圍檢查（審查工作樹根目錄）：

```sh
git diff --name-only 264352c5b863d9928a36ab2a9dbecc697f35a028 6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1
git diff --stat 264352c5b863d9928a36ab2a9dbecc697f35a028 6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1
git diff --quiet 264352c5b863d9928a36ab2a9dbecc697f35a028 6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1 -- frontend/src/pages/repair frontend/src/services frontend/src/config AGENTS.md backend scripts
git diff --check 264352c5b863d9928a36ab2a9dbecc697f35a028 6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1
git rev-parse HEAD
git status --porcelain=v1
```

上述檢查 exit 0；HEAD 為完整 6ad，status 空。只有依賴資料年齡警告（baseline-browser-mapping／Browserslist caniuse-lite），沒有因警告安裝或更新。沒有重跑作者 pure 11、lint、build 或不變 backend 全面套件，也没有把作者自報結果當作接收端實跑。

## 尚未驗證與共同發布限制

1. base 264 已知的 GET 混權限與 false-empty P2 不在 6ad UI delta 修正范围；本輪沒有將其歸為新引入，也沒有因本窄範圍 PASS 消除整批 hold。收發下一個指定 SHA 與共同最終整合仍須另行接收。
2. 本批五個產品檔案會影響中央 Claw guide source hashes；作者 handoff 指定雙語內容／hash／coverage／drift 由 DOA 集中更新，本固定 6ad 尚未完成。Guide 更新與最終整合 SHA 檢查未在本輪執行。
3. 未驗證真正 Source 表單自動帶入、真 CustomerIntakeQueue／CustomerRepairQueue 內部 DOM、Claw help 點擊、真後端／DB／來源連線、顧客／實物／金流／發票／库存验收，也未验证 Cloud Run revision／traffic。沒有 merge、commit、push、部署或變更正式資料；本次只新建本協調回執。
4. 無 Git 衝突與本輪離線 DOM PASS 不能代替業務流程或發布驗收。最後共同 SHA、知識、必要 DEV 驗收及正式發布界線由 DOA 統籌另行確認。
