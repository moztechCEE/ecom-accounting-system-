# DOA 整合 DOM 與中央雙語知識覆核

日期：2026-10-08。結論：**PASS（本機 DOM 與本次指南／來源雜湊範圍）**；受查範圍未發現新增 P1／P2。未執行 DEV、正式資料、外部通知或實物驗收。本次只新增本協調文件，沒有修改 ERP 產品、測試、中央知識或已提交報告。

## 固定版本與已執行測試

- ERP 工作樹：`corely-erp-aftersales-20261005`。
- 七組 DOM 執行的起始及結束 HEAD 都是 `a3068ffc621971ade8cf100d7b06b1b461ad0296`。
- 後續只讀中央知識覆核 HEAD：`37b069888999d87de14c0b4f04374ea55c81d80b`。
- 七組實際 React DOM fixtures 全部通過：17 個葉測例；Node TAP 含兩個父測例為 **19／19，fail／skip／cancelled 均 0**。沒有重跑測試。
- 原指示的 after-sales-workbench DOM 名稱，實際檔案是 `frontend/tests/after-sales-module-dom.test.ts`；其餘為 workspace-company、repair-readiness、repair-dispatched-page、repair-feedback、mailroom-workbench、mailroom-recipient 的 `-dom.test.mjs`。
- 已提交 ERP 詳細報告：`docs/dev/reviews/doa-integrated-dom-20261008.md`；SHA256 `dc729bfce5c4c86b5d21bdfa51202113d4a06f210f14d8de3c54d48ab93e7030`。依 Root 要求保留其原 bytes。

真實頁面證據包含 Dashboard／Layout／CommandPalette 的公司情境、AfterSalesModulePage／Hub 的六類導向及獨立金融權限、實際 RepairWorkbenchPage 的八種 DISPATCHED 情境與文件、MailroomPage 的取消留稿／busy 接收人／未知寄出 reload 精確核對及 RecipientPicker。售後原頁 iframe 為合成文件；原生客服隊列為受控草稿 harness，API／登入為合成 stub，不能推定真 Source、JWT、Server Action、通知或正式庫存成功。頁面攔截拒絕非本機 fixture 網路；未執行真業務呼叫。

## 前端來源與 manifest 對照

- 已封存的 **52 個受測前端產品／依賴來源**，由 a306 至 37b 全數 SHA256 相同；前端 tracked／staged 差異為空。
- 中央 manifest 共 **209 個來源**；逐一重算實際檔案 SHA256，**drift 0**。其中 **118 個前端來源**亦全部吻合。
- 52 個受測來源有 39 個列入知識 manifest；其餘 13 個是附帶的舊服務／Dashboard 與 Warehouse 依賴，非本次三指南所宣告的來源。這 13 個同樣維持原雜湊；本覆核不擴張中央來源清單。
- `catalog.source.json` SHA256：`f958a586d3a4900e804d31fe6b7d6be1bb0135ffef1d20593dac5a8d19e38ea6`；與 manifest 的 catalogSha256 一致。
- `source-manifest.json` SHA256：`8530261c3543b059eea24160c909667e6f969342558d9f5de66c570cc2c2d6a0`。
- sourceVersion：`sha256:85ac4ab78de250e3c3309929ddab67ec2d57ee86e256a4e37f8c565fff29a759`；79 guides、103 routes、zh-TW／en。manifest 的 reviewedBaseCommit 是歷史基底欄位；本次實際覆核版本是上列 37b。
- 本次是獨立只讀 SHA／內容對照，**沒有重跑 generator、ACL、後端或 DOM 測試**；Root 執行的 20／51 測試不冒認為本代理執行。

## 三指南與原始 boolean 守門

完整逐讀 `catalog.source.json` 的 `mailroom-workbench`、`repair-workbench`、`after-sales-stock` 中英內容。各指南的中英 steps／boundaries 與 `catalog.generated.ts` 精確相同，分別為 14／25、11／11、6／7；引用的 sourcePaths 均存在且列入 manifest。

| 對照 | 已核對內容與來源 |
|---|---|
| 收發 d75 | 取消保留當頁草稿，busy 或未知時鎖定接收人；未知寄出首包於 POST 前存 sessionStorage，以公司＋本人＋物件隔離，只保存窄物流 body／requestId，不保存照片／密碼。儲存失敗不 POST，版本／資格衝突停人工核對；回執精確符合才清除，不將普通草稿說成跨 reload 保存。指南 4564、4590／4626、4652；實作 `mailroom-dispatch-pending.ts:8`、`MailroomPage.tsx:917`、`:1098`、`RecipientPicker.tsx:87`。 |
| 維修 53／2ade | DISPATCHED 是只讀查閱既有技術與寄出紀錄，不能再提示待收發本人點收；已交運、顧客收件與結案分開。records 及 all 包含 DISPATCHED，原件／替換／拒修／原廠的實際處置保留。指南 4748、4760／4799、4811；實作 `repair-readiness.ts:45`、`:169`、`RepairWorkbenchPage.tsx:234`、`mailroom.service.ts:385`。 |
| Source／AI 界線 | PENDING_COMPATIBILITY／DISPATCH_CONSUMER_NOT_CONFIGURED 仍是待相容，既有 DELIVERED／「系統已接收」不當作本次寄出 ACK，不宣稱已通知或顧客已收到。指南 4587／4649、4760／4811；`mailroom.service.ts:898` 明確排除 dispatch／DISPATCHED 的既有進度 outbox。 |
| 三 raw DTO | 平板本人簽收、原件交回／原廠實物交接、退貨正式入庫，以 `@Transform` 取回原始 JSON confirmedItems，避免 main pipe 的 implicit Boolean conversion；`IsBoolean` 拒絕字串／數字。平板及入庫另 `Equals(true)`；RepairWorkflowDto 的 optional boolean 由需要實物確認的 action 檢查 `=== true`，不新增其他 action 的簽收要求。指南 4591／4653、4761／4812、6157／6197 與實作一致。 |
| 庫存只讀投影 | 換機正式 OUT 不重扣，原退貨 IN 保留；dispatch 後目前保管可沿核對的換機案件轉為承運商，不誤顯歷史 IN owner，也不表示已退款、外部過帳或 Source 同步。指南 6158／6198；不可推定庫存流程於本輪 DOM 全面驗收。 |

三個 DTO 完整逐讀：`backend/src/modules/mailroom/mailroom-tablet.dto.ts`、`repair-workflow.dto.ts`、`backend/src/modules/integration/after-sales/after-sales-stock.dto.ts`；並核對 main ValidationPipe 及現行 service 的 `confirmedItems !== true` 判斷。沒有修改／擴張 endpoint、權限、文件、保管或庫存條件。

本批中央變更與上述固定收發／維修整合及三 DTO 守門相符，沒有把本機 PASS、舊同步 ACK、未保存草稿或待相容 consumer 改標成 DEV／外部／實物成功。剩餘發布與正式工作流程驗收仍由 Root 依固定後續 commit／candidate 證據獨立處理。
