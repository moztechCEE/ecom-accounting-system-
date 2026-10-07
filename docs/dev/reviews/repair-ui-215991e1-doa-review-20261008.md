# 維修 UI 215991e1 獨立接收覆核

2026-10-08。結論：**本批低干擾 UI／回饋修正 SCOPE_PASS，沒有新 P1/P2 證據。** 舊 `28b5` 的 pending 收合／隱藏失敗 P2 已在本次實際 Page DOM 回歸中修正。此結論不是 DEV、真 API、財務、庫存或實物驗收；原264發布 HOLD、中央指南與後續整合仍由 Root 分別處理。

## 固定來源與保留

- 原 checkout `corely-erp-aftersales-20261005` 開始／結束均為 clean `264352c5b863d9928a36ab2a9dbecc697f35a028`。
- Origin 為 `https://github.com/moztechCEE/ecom-accounting-system-.git`。Explicit fetch `refs/heads/codex/repair-ui-cleanup-20261008`，remote-tracking ref 精確為 `215991e18e5c33c5045921b1668482142dc2f70d`；merge-base 與264相同。
- 新 detached worktree `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-ui-review-215991e1-20261008`，開始／結束 SHA 不變，tracked status clean。
- 舊 detached `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-ui-review-20261008` 保持 clean `28b5f06c7889085d9246aab7c33ab7090669c7a6`；舊協調區 FAIL 報告及 private probe／圖片未覆寫，handoff 收入的原文仍明確是舊 FAIL。
- 完整讀本批 `AGENTS.md`、`docs/dev/repair-workbench-clean-interface-handoff-20261008.md`、七個 owned frontend runtime 與五個專用 DOM tests／相關既有 helpers。沒有 backend、schema、DTO、services、model、readiness/navigation/feedback helper 修改。
- 為離線測試，僅建立 ignored frontend/backend node_modules symlink，復用既有依賴；新增 private screenshot preload 與 AST probe，沒有改產品／測試／lock／knowledge／原 operator 或發布 state。

## 實際 DOM 結果

以固定工作樹的實際 React Page、AntD、原工作單／原件原廠／庫存元件執行，只有 API/auth/websocket 合成 stub。外部請求與實際 HTTP writes 被測試 route guard 禁止；本機 server 只提供測試 assets。

| 本次親跑 | 結果及意義 |
| --- | --- |
| 五個專用 DOM tests 合併 | **18／18 PASS、0 skip、26,132.038ms**：含 workflow 10、Documents 5，以及 Readiness/Layout/Terminal 各1個 parent test。 |
| 新 workflow actual Page | Pending header aria-disabled=true；force click 不收合；重複 submit 不新增 command。403拒絕後外層 Alert 可見；手動收合後仍可見，原 textarea DOM／草稿保留，重新送出使用相同 requestId、entityId、expectedVersion及body。 |
| 三種限制 | 沒有 update、非指派本人、server allowedWorkflowActions 缺動作，均沒有作業按鈕或 POST。沒有新增 grant。 |
| 庫存五負向 | units403、network、reserve403同key重試、release403不清預留及本機 expired 均依真實錯誤顯示；沒有自行推斷庫存未備妥、方案更新或要求取消舊預留。 |
| Documents | 付費正數估價與必填、dirty/busy、完整檢修／維修保存payload、已保存版列印、當版警示、唯讀disabled及失敗保稿。檢修兩區／維修三區保留原輸入与必填。 |
| Readiness | 18個合成情境：免費仍需同意、同版付款／報價、CSR接手／估價與報價失配、unknown amount、draft/submitted、原廠返還複驗舊版、拒修、失敗QC及終態。pending主警示在收合外；資料escaping與390px無溢出。 |
| Layout | 1537／1024／390三寬、長產品／案件／SN／SKU、兩個開案入口、同DOM与草稿、取消關閉／路由離開、單次合成草稿保存、客服估價／報價／decision失配。親目視1024及390抽屜圖片，未見橫向溢出或產品直排狹欄。 |
| Terminal | 四方案 REPAIR／REPLACE／RETURN／FACTORY × refusal/completed 共8，加WAITING_RETURN_ACCEPTANCE／READY_FOR_DISPATCH共10情境；DISPATCHED沒有editable施工入口、不冒稱顧客收件／結案、不填造拒修報告。舊ACK以歷史DELIVERED/PENDING/FAILED保留，未當成本次寄出同步成功。 |
| 可選舊版對照 | `REPAIR_TEST_BASELINE=1` **11／11 PASS、0 skip、11,364.159ms**。其中舊28b5負向控制實際重現pending可收合＋錯誤隱藏；新版同場仍通過。舊bug被重現是該控制測試的預期結果，不是將舊版本改標PASS。 |

精確修復位置：`RepairWorkflowPanel.tsx:31–46` 外傳busy/failure且保留running／JSONbody／requestId；`RepairWorkbenchPage.tsx:241` 外層Alert、`:253` controlled Collapse在busy時disabled及forceRender。獨立元件沒有onFailure時仍保留本地Alert（`RepairWorkflowPanel.tsx:88`）。此次actual Page fault injection是command拒絕，沒有另親跑「command已成功、随后detail reload失敗」；不能將此未執行情境列成actual PASS。

## 契約與不漏操作核對

Private TypeScript AST probe對比264，不以刪除中文／正規式去除全邏輯來假稱相同：

- **28個**命名payload／owner／stage／可用動作／eligible bindings、**12個** API/service calls及**40個**依Form name對齊的required rules均相等。
- Page的**6個** `actions.push`條件、action名稱與disabled predicates全相等；認領、本人簽收、開始檢測、送客服、開始維修／換機、完成交回沒有遺失。樣式／短label／主要按鈕選擇是展示差異。
- Workflow TECH_ACTIONS、physical confirmation／tracking條件與payload同原版；RETURN不捏造完工/QC，FACTORY各實物節點沒有合併。REPLACED SKU/品況/SN、正式預留與明確取消仍在工作單。
- CSR接手／回覆門檻與decision payload不變；APPROVE仍要求來源當版顧客同意，DECLINE原規則保留。CustomerRepairQueue 本批僅AST／源碼契約覆核，**沒有親跑其獨立CSR queue DOM**。
- Shared backend/services/models／readiness helper diff為空；修正的waitingFor另核CSR檢修、估價、報價、planHash、decision，实际Layout DOM顯示不一致為「待客服重新確認」。不能用短按鈕文字推論後端放寬。
- AST第一次假設Form rules呈現順序不變，因工時欄移位而失敗；改以Form name+rule對齊。Readiness新增純展示`checks`不列native payload binding，改由其實際DOM驗證。這兩次是private probe分類修正，未改產品或減少業務條件。
- `AGENTS.md` 保留264發布段落完整原bytes前綴。新增規則明確適用全系統、基本操作不依賴教學旁白；保固參考SHA為已給定 `6f59aa230bcc841bc261f3125f368a9208a034ca`，此次不再改／執行保固系統。

## 親跑命令與收據

Cwd：新 detached tree 的 `frontend`。

```sh
node --import /private/tmp/repair-ui-215991-review-fbv7lshj/screenshots.mjs --test tests/repair-workflow-feedback-dom.test.mjs tests/repair-documents-ui-dom.test.mjs tests/repair-readiness-dom.test.mjs tests/repair-ui-layout-dom.test.mjs tests/repair-dispatched-page-dom.test.mjs
REPAIR_TEST_BASELINE=1 node --test tests/repair-workflow-feedback-dom.test.mjs
```

Screenshot preload只轉存圖片路徑，沒有改assertions／API行為，避免覆寫作者 `/tmp/corely-repair-clean-copy-*` 圖。Private dir `/private/tmp/repair-ui-215991-review-fbv7lshj`：

| 檔案 | SHA256 |
| --- | --- |
| screenshots.mjs | `36637784447503d56101aae1bf57184abb1ca3ba9cfc400e05e0d7fa8c6f1200` |
| dom.log | `f224293202d749eb43fa7aabbca89f8f1eef00b7f8ed1ae8ef282f2c3295283d` |
| baseline-feedback.log | `b60da9f06105602ef39d8bb3b804702e777d53389e31458913a6ee244952ec1d` |
| source-contracts.cjs | `e14838aee1f76f317c42ba2070f1d504c354b78d6fcf57fc14f095c997f1549b` |
| source-contracts.json | `7ceab3a9d77806d08539dd1cd75ce10fff0e2c88a403a3259d941b569b971c56` |

`git diff --check 264352c5… HEAD` PASS；沒有重跑不變backend、整build、broad pure tests或作者先前counts。測試輸出只有既有Browserslist/baseline資料老化提醒；沒有更新依賴。

## 中央 knowledge 與發布邊界

只重算manifest 209個sources，精確七個owned runtime drift；**不是generator PASS**，未write。

| runtime | 實際 SHA256 |
| --- | --- |
| CustomerRepairQueue.tsx | `c882e9a075024cd80888ddde1418424c6653bd0e61ea23fdb8027e0cebf994b9` |
| RepairDocuments.tsx | `7d9e62fc0e3f66b8453cfc6c67ee20de2b6749b0175416d0fd3e3111a9e65323` |
| RepairReadinessPanel.tsx | `d5083d34857961a32ef4c288b5f0be257b2d970c7f334c515cef5c2b99ac88b7` |
| RepairReplacementStock.tsx | `c907bafd3688ab2913259c9f1bb6024b9fa26c9212c2882e7d37911dbae6ca8e` |
| RepairWorkbenchPage.tsx | `7a90ca43bd50826ee4ed2508701c13df505d09504d51692c973883677d83685b` |
| RepairWorkflowPanel.tsx | `e812edcc4cb1e91a5f34a5fc6c1dc7fed61bd8eaaa949e9230308cd59e227278` |
| repair.css | `9b316c77a01fdd02e823a6032d12706456d7d3861c8ad4f2b1a9f8c46b76f616` |

Guide仍由中央Root先審中英文用法再生成。Source／AI DISPATCHED pending compatibility、舊ACK、顧客同意／款項、庫存及實物保管界線沒有因本機UI簡化而取得外部驗收。此輪未cloud讀寫／DB／真API／通知／退款／发票／库存mutation，未改原264或private operator state；主DEV仍f3／原264HOLD是Root提供背景，不是本輪雲端實讀證據。
