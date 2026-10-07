# DOA 對收發 d75ce43 的獨立前端審查

日期：2026-10-08。結論：**PASS（固定前端 delta 與本機整合契約範圍），未發現新增 P1／P2。知識與共同 DEV 驗收尚未通過。**

## 固定來源及所有權

- Repo：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- 實際 HEAD：`d75ce4359df2f2170b65b1acf984aa9f8439cd34`；parent：`dd0b5b4453eb0cf348fd7b3a4b4b39c2ea73d91d`；原開發 base：`f3f14c4104906cc6ca23bd1d38ba4589563b6801`。
- Review tree：`corely-erp-mailroom-review-20261008`（detached）。本輪只新增此文件，沒有編輯產品、tests、helpers、中央 knowledge 或 lockfile；既有 dd 前／後端審查文件不修改。
- 讀取完整前端 delta、兩個新 helper、指定 unit／actual Page DOM fixtures，並核對未變更的 RecipientPicker、SourceCasePicker、mailroom-workflow 與 repair-navigation。後端 DTO／spec delta 僅核對變更範圍，不代簽另一審查者的後端執行結果。
- 使用既有 node_modules symlink；Vite output 與 TypeScript cache 寫 private tmp。沒有 DB、雲端、真 API 業務呼叫、通知或部署操作。

## 三項修正及實際行為

| 核對項目 | 固定來源與結果 |
| --- | --- |
| 前線草稿取消保留 | Page 135–166 行彙整收件／詳情 dirty 與 busy，採 hook modal 的單一確認 owner；close、換件、換動作、取消、路由及 Back 共用守門。actual Page DOM 實際核對保留欄位、Source 預填、照片及物流值；明確放棄才卸載。 |
| busy 收件人鎖定 | 1598 行與 2041 行兩個 RecipientPicker 明確傳 `busy || uncertain`，修正 dd 的 disabled=false 覆蓋 Form context。actual Page DOM 在收件 POST held 時實際驗兩個部門／同仁 combobox disabled，禁止 close／route 且保留原欄位；詳情 picker 同一條件另由程式核對。 |
| 保存／讀圖中不可切換 | Page 159–160 行 busy 先拒切換；1099 行／1899 行 working ref 立即避免重複提交；1698–1725 行讀圖期間亦設 busy。單元涵蓋確認開啟途中開始保存，仍不得放棄。busy 並非已保存／已簽收的證明。 |
| 成功清除與刷新 | 1139、1148、1180、1939 行只有實際成功或精確回執才清除 dirty；普通 refresh 344–346 行只更新清單／待到貨，不卸載開啟詳情。actual DOM 驗保存後乾淨離開。 |
| 未知結果 | 1114–1129、1143–1166 行保留首次 body／requestId，鎖定未知表單；不能因後續 Form serialization 不同另生 key。非 dispatch 草稿／unknown 只保留目前頁面，確認離開後須人工查原操作，未宣稱跨 reload 恢復。 |

舊 `mailroom-dd0b5b4-doa-frontend-20261008.md` 的 FAIL 為歷史結果，本次不改標。busyRecipient、離開草稿與未知寄出保留的修正由本輪獨立測試確認，未沿用作者 PASS。

## session 待核對寄出及重試契約

`mailroom-dispatch-pending.ts` 是窄物流紀錄，不是一般草稿儲存或成功憑證：

- key 以 encodeURIComponent 編碼公司／使用者／item，空範圍拒絕；單元實際核對跨公司／actor／item 讀取隔離及分隔符號不碰撞。
- POST 前保存並 read-back；只容許 entityId、requestId、expectedVersion、dispatch、carrier、tracking、boolean true、bounded note。requestId／version／欄位型別與額外欄位均檢查；損壞或跨 scope 的 envelope 失敗而不删除原紀錄。沒有存照片、密碼、驗證碼、實物快照或金融資料。
- Page 918–936 行恢復原包及 key；不自動 POST。精確回執核對沿用 `mailroom-workflow.ts` 82–91 行的 entity、item、requestId、fromVersion、下一版、操作者及 trim 後物流值。單看 DISPATCHED 不夠。
- 未取得精確回執且 item version／目前保管資格不同，設 pendingConflict，儲存按鈕停用，只可 GET 核對並提示人工處理；不更新 expectedVersion 或另生 requestId。版本相同仍只有明確的原包 retry，後端仍重驗即時權限、公司、保管及資格。
- `clearDraft()` 不删除 session 首包；一般「放棄草稿」後 re-enter／reload 仍恢復原寄出。只有 matchesDispatchReceipt 通過才嘗試删除；删除失敗會顯示待核對警告，回來仍以原回執核對，不視為新操作。

actual Page DOM 實際涵蓋未知失敗、close／action／換件／route 取消保留、確認離開再進入、真正 reload 後同 body／key、commitThenLost 的 GET 精確核對及清除、stale/no-match 保留 key＋禁 POST，以及離開後再次進入的同一 key。helper 單元實際涵蓋 storage quota／read-back 失敗與窄 scope／格式拒絕。

sessionStorage 限目前 tab／browser session；關閉整個 tab、跨裝置、清除 storage 仍不能保證恢復。沒有跨 reload 保存一般欄位或照片的承諾。原生 beforeunload 由未變更的 repair-navigation 34–38 行依 dirty/busy 阻擋並提示；DOM reload 分支接收原生 dialog 後繼續，未另測「使用者取消 native reload」的互動或所有瀏覽器差異，不擴大聲稱。

## 接口與低干擾整合

- API 路徑、命令 action、公司與 expectedVersion 契約沿用 dd。前端仍以既有 action API／receipt API 送出，不新增財務或 Source 寫入 endpoint。
- 寄出 success 文案持續標明「售後／AI 寄出同步待串接」；immutable outbound 的 `PENDING_COMPATIBILITY / DISPATCH_CONSUMER_NOT_CONFIGURED` 警示保留。既有進度 delivery 不是本次 dispatch ACK，UI 不冒稱通知成功、顧客收件或自動結案。
- 相對 dd 的唯一後端 runtime delta 是 confirmedItems 原始 JSON Transform，防止全域 Boolean implicit conversion；本報告不將靜態 DTO 閱讀當成 Controller／Service HTTP 通過。
- 固定 DOA `ad406d84679bb7b1a54f08bc4df35aa73fc765c3` 的 App 171–172 行使用 data router，符合新 useBlocker 前提，且共享 repair-navigation 相對 f3 bytes 未變。這是固定程式契約核對，尚未合併 d75／repair a787／DOA 後重跑完整共同 build 或 DEV。
- 仍只由目前合格本人點件簽收／交運；next recipient 與 custodian、發通知與實物移轉、入件與出件單號、原 IN 與換機 OUT 保持分開。此次沒有二次出庫或 Source 消費端開通。

## 本人實際檢查

| 檢查 | 本輪結果 |
| --- | --- |
| handoff 指定六份前端 unit（target ES2022） | **30／30 PASS，fail 0／skip 0**；包含新增 draft／pending 6 項與既有 24 項。 |
| `node --test tests/mailroom-workbench-dom.test.mjs` | **actual MailroomPage React／AntD DOM 1／1 PASS，fail 0／skip 0**，30.34s；隔離合成 API stub，外部請求 abort，非真 Source／ERP 業務測試。 |
| app／node TypeScript project | **PASS**，cache 私有 tmp。 |
| Page、兩 helper、draft test、Page DOM fixture ESLint | **0 errors／3 既有 Page warnings**（generation／detailGeneration cleanup），沒有新 lint finding。 |
| Vite production build | **PASS**，output `/private/tmp/mailroom-d75ce43-review-dist`；既有 browsers data／大 bundle 提示保留。 |
| `git diff --check dd HEAD` | **PASS**。 |
| generator `--check`（未 write） | **FAIL，known 8 source drifts**；不能標成 coverage／hash PASS。新的 helper 尚未進入该固定 author tree 的 sourcePaths，須集中追加。 |

單元實際命令（frontend cwd）：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test tests/mailroom-draft.test.ts tests/mailroom-workbench.test.ts tests/mailroom-recipient.test.ts tests/mailroom-intake.test.ts tests/notification-refresh.test.ts tests/repair-item-custody.test.ts
node --test tests/mailroom-workbench-dom.test.mjs
```

新 runtime hashes 已實算：Page `b03c57c4a06ac56c4e52b4000692b651f77e753c1e3628916e8cf1f86a28efa5`；mailroom-draft `c87cdd43ad6969109c016b4141f054a521234aae542443393bdd10e91064dbd4`；mailroom-dispatch-pending `d9e46462a9c000d3b1feca5a5f2930c2071182e1c0de46e8d949d0d363f58c65`。

本次固定前端修正可供集中整合，未新增 P1／P2。發布前仍須合併後的共同 SHA、双語 Claw／sourcePaths／hash check、正常權限 DEV 操作及未知結果對真 API 的回執驗收；本機 DOM 的 stub commitThenLost 不等於真 DB／網路丟回應已驗收。Source／AI dispatch consumer、真實通知、顧客收件、物理交接、正式庫存或 financial provider 均未在此輪操作或驗收。
