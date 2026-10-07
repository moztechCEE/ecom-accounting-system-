# 維修工作台清單與填單介面交付

2026-10-08，維修工作台開發視窗 `01a117fd-0a9e-7882-a4aa-c9a27d34f1d3`。

## 問題與完成行為

使用者在 DEV `/operations/repair` 指出清單窄欄造成工作單／實物位置直排，開案後資訊雜亂，妨礙辨識產品及填寫檢修。此次將清單改為產品、進度、開啟案件三區；產品名稱為主要入口，同列保留案件號、SN／SKU、實物保管及工作單版次。

案件抽屜標題持續顯示案件號與產品名稱；檢修單分「故障與檢測」「診斷與估價」，維修單分「實際處置」「實際使用零件」「修後複驗」。桌面以工作單為主區、下一步作業為側欄；手機改單欄且工作單先呈現。主要階段／阻擋 Alert 保持可見，詳細核對、待到貨、原件／原廠作業、案件資料與歷程可展開查閱。

收合不銷毀原表單或處置元件。原本人簽收、客服與來源放行、實際處置、列印已保存版本、文件版次及 dirty 離開確認沿用；沒有新增案件、共同狀態、報價／發票／媒體／封存功能。

## 真實工作樹、基底與修改範圍

- Repo／origin：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- Worktree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-ui-cleanup-20261008`。
- 分支：`codex/repair-ui-cleanup-20261008`。
- 起始 ba；doc-only fast-forward 後實作基底為 `264352c5b863d9928a36ab2a9dbecc697f35a028`。該基底已獨立接收審查 SCOPE_PASS，正式回執另存 `docs/dev/reviews/repair-review-doa-ba567582-20261008.md`。
- 此次程式只改 `frontend/src/pages/repair/RepairWorkbenchPage.tsx`、`RepairReadinessPanel.tsx`、`RepairDocuments.tsx`、`repair.css`；測試為既有 `frontend/tests/repair-dispatched-page-dom.test.mjs` 加收合展開，以及新增 `repair-ui-layout-dom.test.mjs`、`repair-documents-ui-dom.test.mjs`。
- Shared navigation/login、services、API、DTO、schema、狀態、財務、來源及中央 knowledge 均未改。此 UI 不包含在已核准 2643 批次，須以新固定提交獨立整合。

## 接口與相容性

清單仍使用相同 queue/company/search/page/pageSize=50 查詢與原生 item ID 開案；Pagination 使用原 Table 的同一 callback。Page、Detail 全部 pre-render statements、event callbacks、儲存／列印函式與表單規則保留；`RepairReadinessPanel` 只增加選用 `compact` 呈現，既有預設展開及 derivation/checks 不變。

獨立 AST 比對 16 項 PASS_SCOPE：查詢／公司／權限／payload／目前版次／來源 gate／dirty／保存／列印／所有 callbacks 維持，DISPATCHED 沒有新增作業路徑。文件子審另對照 77 個 Form／Form.Item／Form.List／Input／InputNumber／Select／Button／替換預留／複驗 props、rules、handlers 相同。上述為本批 dirty bytes 的獨立審查，其他兩視窗仍需 fetch 新固定提交接收，不代簽整合或發布成功。

## 實際驗證

- `npm run build`：最終 CSS 調整後完整 TypeScript＋Vite PASS；既有 browsers data／大 bundle 提醒仍在，沒有更改依賴。
- 此次三個 TSX 與三個 test 的 ESLint：PASS。
- `node --test tests/repair-dispatched-page-dom.test.mjs tests/repair-readiness-dom.test.mjs`：2/2 PASS。保留完整 Page 的 10 情境、工作單／歷程／舊 ACK、terminal 不可操作、records query 及拒修實際紀錄驗證；只新增展開收合區以查可見內容。
- `node --test tests/repair-ui-layout-dom.test.mjs`：最終 1/1 PASS（7.78 秒）。實際 React Page／AntD／repairService，1537×972、1024×972、390×844，桌面含合成 240px sidebar；長產品／SKU／SN、兩個開案入口、兩／三表單分組、page／Drawer 無橫向溢出。取消關閉及 route 離開、切 tab、歷程收合保留同 DOM 與草稿；唯一保存為合成離線 DRAFT API，原 ID／expectedVersion=7／request key 與 body 正確，成功後可乾淨離開。外網與真 HTTP writes 為 0。
- `node --test tests/repair-documents-ui-dom.test.mjs`：5/5 PASS（1 parent＋4 情境，4.69 秒）。實際 React／AntD 文件表單覆蓋付費缺估價金額不送、dirty／busy、完整保存 payload、列印已保存版而非未存稿、維修 outcome／零件／複驗、版次不一致警示、唯讀 disabled、保存失敗可見且保留草稿。由已通過的 `/tmp` probe 保存為無工作樹絕對路徑的專用 test 後重跑；初版 probe 的失敗提示期待值已依既有 errorText 修正，沒有更改產品錯誤處理。外部請求及真 HTTP writes 為 0。
- 新 layout 測試初跑修正 fixture 的 UTF-8 與 AntD showCount textarea 定位；沒有刪除產品驗證。手機作業側欄先呈現的純 CSS 順序經目視後改為表單先，再重跑 PASS。
- `git diff --check`：PASS。
- 未重跑沒有改動的 backend，2643 接收結果另載正式回執；不能把舊 67 pure 或 173 backend 說成本批重新執行。

重跑 cwd 為本 worktree 的 `frontend`：

```sh
npm run build
npx eslint src/pages/repair/RepairWorkbenchPage.tsx src/pages/repair/RepairReadinessPanel.tsx src/pages/repair/RepairDocuments.tsx tests/repair-dispatched-page-dom.test.mjs tests/repair-ui-layout-dom.test.mjs tests/repair-documents-ui-dom.test.mjs
node --test tests/repair-dispatched-page-dom.test.mjs tests/repair-readiness-dom.test.mjs tests/repair-ui-layout-dom.test.mjs tests/repair-documents-ui-dom.test.mjs
```

## 本機視覺證據

六張由新 actual Page 的離線合成測試產生，root 已目視桌面清單／桌面抽屜／手機抽屜；不是 DEV 真登入驗收或真案件。

- `/tmp/corely-repair-ui-layout-20261008-desktop-list.png`
- `/tmp/corely-repair-ui-layout-20261008-desktop-drawer.png`
- `/tmp/corely-repair-ui-layout-20261008-compact-desktop-list.png`
- `/tmp/corely-repair-ui-layout-20261008-compact-desktop-drawer.png`
- `/tmp/corely-repair-ui-layout-20261008-mobile-list.png`
- `/tmp/corely-repair-ui-layout-20261008-mobile-drawer.png`

## 中央 Claw 待 DOA 語意審查與生成

`node scripts/dev/generate-copilot-knowledge.cjs --check` 預期 FAIL，精確列下方四個 owned sources 漂移；未執行 `--write`。四檔已存在 repair guide sourcePaths，無需新增來源。DOA 審查並更新雙語指引後集中生成、check／spec，再對最後整合 SHA 重驗。

中文 steps 增補：

> 案件清單以產品名稱為主，核對同列案件號與 SN／SKU，可點產品名稱或「開啟案件」進入同一實物。詳情頂端保留案件及產品識別，檢修單分「故障與檢測」「診斷與估價」，維修單分「實際處置」「實際使用零件」「修後複驗」。主要阻擋原因持續顯示；詳細條件、原件／原廠作業、實物保管及交接歷程可展開查看。桌面下一步作業在側欄，手機在工作單之後。

English steps addition:

> The case list leads with the product name. Verify its case number and SN/SKU, then open the same physical item using the product link or Open case. The detail header keeps the case and product visible. Inspection groups cover Fault and testing, then Diagnosis and estimate; repair groups cover Actual handling, Parts actually used and Post-repair checks. The main blocking reason remains visible. Expand detailed checks, original-item/factory operations, custody and handoff history as needed. Next actions sit beside the documents on desktop and after them on mobile.

中文 boundaries 增補：

> 收合區只改顯示方式，不刪除實際處置、本人簽收、工作單或歷程；切頁與離開仍須先保存或明確放棄草稿。顯示的下一步與保存回饋仍受原生即時權限、版次、客服及來源放行限制。

English boundaries addition:

> Collapsed sections change presentation only; they do not remove actual handling, personal acceptance, documents or history. Switching or leaving still requires saving or explicitly discarding changes. Next-step guidance and save feedback remain subject to the existing current permission, revision, CSR and source-release checks.

| reviewed source | SHA-256 |
| --- | --- |
| `frontend/src/pages/repair/RepairWorkbenchPage.tsx` | `c6068f67a30d2a49f1d8764aed94272aec143c96c466756a77d1e17d64bc4832` |
| `frontend/src/pages/repair/RepairReadinessPanel.tsx` | `c0acfbd60ed065dc8933656ac1938c339606a406eba98d3837a6716b34de60be` |
| `frontend/src/pages/repair/RepairDocuments.tsx` | `8fec36949097eb39a32672cce1137a05a964c2b4e5d356cfb3c62b53bd73f96e` |
| `frontend/src/pages/repair/repair.css` | `c5b80fa98be751e394a6c3216ba6b06cc88b0dd10dd38b971e4c97703e1c4b7f` |

## 發布與驗收界線

本視窗沒有 deploy、流量變更、migration、真 DB／通知／金流／庫存或正式操作。DOA 統籌新 UI 的固定 SHA 相容性、中央 Claw、最後整合、正常帳號 DEV candidate 可見 UI 與發布；2643 原批次的候選進度獨立保留。成功 build／無 Git 衝突／離線 fixture 不代表真實公司、現場維修、Source/AI dispatch consumer 或通知流程通過。
