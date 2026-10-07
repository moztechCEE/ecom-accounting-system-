# 維修 UI 28b5f06c 獨立接收覆核

2026-10-08。結論：**HELD／FAIL（新增 P2 已以離線實際 React Page 重現），待作者新固定 SHA。** 本批 UI 不屬於目前 264／263 候選；不得將此結果歸為該候選故障或把尚未接收的 UI 當已整合。

## 固定來源及邊界

- 實際 ERP origin：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- `git ls-remote origin refs/heads/codex/repair-ui-cleanup-20261008` 及 explicit `git fetch` 的 FETCH_HEAD 均為 `28b5f06c7889085d9246aab7c33ab7090669c7a6`。
- 全新 detached worktree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-ui-review-20261008`；開始／結束 HEAD 均為該 SHA，tracked status clean。
- 實作基底：`264352c5b863d9928a36ab2a9dbecc697f35a028`。diff 精確九檔：四個 frontend runtime、三個 DOM tests、兩個 docs。完整讀交付文件 `docs/dev/repair-workbench-ui-handoff-20261008.md`，核對 runtime diff／相關既有工作流程元件。
- 只新增本協調區報告及 private synthetic probe／screenshots；node_modules 以 ignored symlink 複用。未更動父 working tree、產品／測試／中央 knowledge、lockfile，未 commit／部署／操作 DB、真 API、通知、金流或庫存。

## 新 P2：收合後看不到原件／原廠操作失敗

`frontend/src/pages/repair/RepairWorkbenchPage.tsx:235` 新增可自行收合的 Collapse，包住 `RepairWorkflowPanel`；`forceRender` 留住表單，但不會讓收合內容可見。子元件 `RepairWorkflowPanel.tsx:47` 捕捉失敗只設定內部 failure，唯一錯誤 Alert 在該 Form 內（`:95`），沒有外層 error、header failure badge 或自動展開。

獨立 probe 使用此固定版本的 **實際 RepairWorkbenchPage、RepairWorkflowPanel、AntD 和 data router**。只控制合成身份、資料及 stub API，使用既有取消原廠按鈕，不複製產品收合邏輯。正常輸入並送出後保留 stub promise，使用者收合區塊，等待真實 Collapse 退出動畫完成，再讓 stub API 拒絕：

1. 原提交仍在 pending／busy 時可以收合。
2. 拒絕後 failure 已存在 DOM，但 **isVisible=false**；外層可見 `.ant-alert-error` 數量 **0**。
3. 原 textarea DOM 與草稿保留。只有使用者自行再次展開才看到錯誤。
4. 每次最後成功 probe 只有一個合成 `/repair-workbench/items/layout-primary/workflow` 呼叫，action `cancel_factory`、expectedVersion 7、requestId 存在；外部請求 0、實際 HTTP writes 0、pageerror 0。這只驗證錯誤顯示，不驗證原廠業務是否可執行或後端放行。

此情境會使使用者漏看 API 拒絕；同一路徑的「作業已保存，但重新載入失敗」亦只存在收合內容。後者為 source 推導，未另執行保存成功／reload 失敗模擬。建議作者在操作 pending／失敗時保留可見回饋（例如 busy 時不可收合、失敗自動展開或外層錯誤），並新增此負向 DOM 情境；本代理不修改產品。

## 親跑結果及停止範圍

| 檢查 | 本代理實際結果 |
|---|---|
| `repair-ui-layout-dom.test.mjs` | **1／1 PASS，7,805.657ms**；1537×972、1024×972、390×844 三寬，240px 合成桌面側欄，長品名／SN／SKU、兩個開案入口、兩／三組工作單，頁面／Drawer 無水平溢出；切單／收合歷程保留原 DOM，取消關閉／路由離開留稿，單次離線草稿保存 payload／版次／key 正確。 |
| 新負向 workflow probe | **P2 REPRODUCED**：submit → collapse settled → reject，失敗不可見；展開後可見。收合與展開截图另存 private。 |
| `repair-documents-ui-dom`、`repair-dispatched-page-dom`、`repair-readiness-dom` | 收到 Root／author HOLD 後停止，**本批未執行**；作者報告不代替本代理執行結果。 |
| build／lint／不變 backend／pure | 本批未重跑，HOLD 後不擴張檢查。 |
| 中央 knowledge | 僅重算來源：209 個 manifest entries 中精確 **四個 owned runtime hash drift**；沒有執行 `--write` 或冒稱 generator PASS。 |

layout 執行命令（cwd 為 detached tree 的 frontend）：

```sh
node --import /private/tmp/repair-ui-28b5-review-qgwmsyq2/screenshots.mjs --test tests/repair-ui-layout-dom.test.mjs
```

preload 只把 screenshot 輸出改到獨立 private 目錄，沒有改測試 assertion、產品 component 或 API 行為；SHA256 `f04ce1870cc74516a91137ac676521b4197de0370922b09929099ff5361ef03b`，避免覆寫作者固定 `/tmp` 圖片。layout 六圖皆保存，目視核對 1024px 抽屜及 390px 抽屜。這些均為離線合成資料，沒有 DEV 正常登入。

probe 初期的 API template 尾端換行、既有 browser executable 選擇、實際按鈕全名／loading selector、Collapse 動畫等待問題已在 private harness 修正；它們是 probe 準備／定位失敗，不是額外產品缺陷。較早收合／展開截图保留，不用動畫未完成的展開圖片作可見錯誤證據；最後 `*-final.png` 才目視確認完整展開錯誤。

## 來源與雙語提案

| runtime | 實際 SHA256（與 handoff 一致） |
|---|---|
| RepairWorkbenchPage.tsx | `c6068f67a30d2a49f1d8764aed94272aec143c96c466756a77d1e17d64bc4832` |
| RepairReadinessPanel.tsx | `c0acfbd60ed065dc8933656ac1938c339606a406eba98d3837a6716b34de60be` |
| RepairDocuments.tsx | `8fec36949097eb39a32672cce1137a05a964c2b4e5d356cfb3c62b53bd73f96e` |
| repair.css | `c5b80fa98be751e394a6c3216ba6b06cc88b0dd10dd38b971e4c97703e1c4b7f` |

對照 diff 未新增 API、權限、狀態或後端，原 callbacks／payload／版本／同 body key、保存／列印／表單 rules 仍維持；本批沒有實跑重試，所以同 key 延續是 source diff 結論。Readiness 主 Alert 在收合外；文件 failure／readonly／版次警示及 native action failure 仍可見。既有 terminal ownership predicates 未變，DISPATCHED 保留實際紀錄；因 HOLD 未將 full-page terminal DOM 標為本批 PASS。

handoff 中英新增提案的產品入口、文件識別、表單分組、桌面側欄與手機文件優先皆符合此次呈現；「收合不刪實際處置／表單」成立。但「主要警示持續可見」不能擴及目前 workflow 錯誤。先修 P2，再由 DOA 審新固定 commit、集中更新四來源及雙語指南，才可核對 knowledge drift。既有 Source／AI pending compatibility、舊 ACK 不代表本次 dispatch、正式庫存／款項與實物界線未在本批改動。

## 私有收據與圖片

目錄：`/private/tmp/repair-ui-28b5-review-qgwmsyq2`（0700）。

- `workflow-collapse-failure-final.json`：`1c0dd14c918cebafd1c34f96a891139a2c25997627cad4dad7fe68c91d9f321e`，原初成功 `workflow-collapse-failure.json` 保留且內容 hash 相同。
- 最後 probe `workflow-collapse-probe.mjs`：`ad67be3db62efb94c7534a071fd0e0abff5b24b47e7f3e455a3ba9d0ef9ba6be`。
- `workflow-rejection-collapsed-final.png`：`054a49ef9cf17ca05790f83fa84485b1cf8bc3e5c85154aaafc0073134d17834`。
- `workflow-rejection-expanded-final.png`：`d8a6e251a5edfaa79e1ffba1c14084d622eeaa8c9dda2713ab6ddfa771ff62a7`；目視看到完整錯誤提示。

沒有 P1 證據；新增 P2 尚未修於固定 28b5。**本固定批保持 HELD，等待新 SHA；目前 264／263 candidate 驗收獨立繼續。**
