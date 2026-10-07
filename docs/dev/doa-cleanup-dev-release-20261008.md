# 售後工作台整理版 DEV 發布回執

2026-10-08 Asia/Taipei。**DEV 主網址已更新**。本批沒有部署正式環境、執行 migration 或操作真實案件、LINE、銀行、發票、退款、庫存或物流。原始私有快照及測試憑證不放入 Git；此文件只保存版本、結果與證據摘要。

## 固定建置與實際主流量

- ERP origin：`https://github.com/moztechCEE/ecom-accounting-system-.git`，分支 `codex/aftersales-workflow-20261005`。
- 實際建置／部署來源：`6cc903951d42d3f0e9aa5556598595397734859b`；最後程式整合基底 `c932d30f2d9ce8453f9910d257920d5465145c4e`。部署後若另存文件，文件提交不是新的 runtime/build。
- Cloud Build：`3d399ff2-4542-4f0e-8ef7-ad3cae897b50`，global，SUCCESS。
- Build context manifest SHA256：`9f394ca4ac14821f00313682af986b2dc50f52a21b6fec6827b0aa59efcbb88d`。
- API image digest：`ac30e3f11f3081c8fb12f241304a30851e893c97be9c65c5ab47b64fe356e968`。
- Web image digest：`51084ac135312f7fe90da3efec442df3d002996915f377906039f5d024f1be4a`。
- API 主 revision：`corely-erp-api-dev-doa-6cc903951d42-c`，100%。Web 主 revision：`corely-erp-dev-doa-6cc903951d42-f`，100%。
- DEV：<https://corely-erp-dev-sp5g377smq-de.a.run.app/operations/after-sales/workbench>。
- Schema/migration 相對原主服務 `f3f14c4104906cc6ca23bd1d38ba4589563b6801` 零差異，沒有執行 migration。

## 依序發布與兩輪只讀 UI

每階段先取九個服務最新 metadata，核對原狀、並行 resourceVersion、設定與保留無關 tags；確認後才外部執行限定 DEV service replace。之後實讀 Ready、image digest、設定及流量，再寫獨立 receipt。沒有修改舊264 helper/state/history。

| 階段 | 實際 record 時間（UTC） | 主流量 |
| --- | --- | --- |
| candidate-api | 2026-10-07 23:29:45.734215 | API 原f3 100%，新API review 0% |
| candidate-web | 2026-10-07 23:30:49.558111 | Web 原f3 100%，新Web review 0% |
| final-web | 2026-10-07 23:31:30.379195 | Web 原f3 100%，新Web final 0% |
| promote-api | 2026-10-07 23:33:19.730580 | 新API 100%，Web 原f3 |
| promote-web | 2026-10-07 23:35:08.437902 | 新Web及新API各100% |

第一輪 reviewWeb + reviewAPI：五個全新 browser contexts，各按一般客服、收發室、維修師、受限主管及390px客服檢查，**83/83 PASS**。原始 receipt `ui-734a6281-6797-4891-88e5-43a0ce074c10/receipt.json` SHA256 `1c2be9e6c4e8d7b057e96ccb195aafd04b014437edf71b789735b9ed07bde63c`，完成 `2026-10-07T23:32:36.128Z`，晚於 final-web Ready record。新的 strict composer 實際接受為 `acceptance-after-final-web`。

API 主流量更新後，第二輪 finalWeb + canonical API 重新登入五個全新 contexts，**83/83 PASS**。原始 receipt `ui-969317e9-7667-4cd4-a089-3baf64c4c635/receipt.json` SHA256 `257a630b8eea5f3445409eef5abfca35cc392bc07836fdbf5667612b33da2556`，完成 `2026-10-07T23:34:19.905Z`，起訖均晚於 promote-api record。新的 strict composer 實際接受為 `acceptance-after-promote-api`，此票才用於 Web 主流量更新。

兩輪各83項是同一既定範圍的兩次部署驗證，不能相加成166項不同功能或真實業務驗收。核對固定 DOADEV 四帳戶、登入預設與可切工作區、帳號／公司瀏覽器偏好、原Source八個入口／六張新增表單、公司與權限、CSR財務入口隱藏、五contexts實際bundle、Source session/iframe ready及版本、桌機／手機無橫向溢出。沒有填單、提交、報價、收款、開票、通知、退款或實物操作；只允許登入、模組啟動及SSO session類POST，業務寫入和外部來源／WebSocket均封鎖。

六類入口名稱整理後仍沿用原表單。原清單「新增案件」不傳type，CSR原空白表單大多預設RESHIPMENT，產品問題回報有其原CUSTOMER_ISSUE設定；Source本身支援合法type query。未把可開啟表單誤報為每個新增入口自動帶入類型。

## 發布後實讀

父任務 `2026-10-07T23:35:35.131585Z` 重新實讀九服務，expected exact、全部 Ready；七個非ERP DEV服務相對INIT identity未變。原Source DEV兩服務revision/digest仍20f，正式與WMS等五個受保護服務不變，所有無關候選tags／runtime設定保留。

實際 stable DEV HTML引用 `/assets/index-BcUz2XHW.js`，HTTP200且bundle SHA256 `35aa5e5676d068d5d0f87fa9b8f942f33286f29f7f5710da71b2d7c13cc7979b`，等批准build manifest。由 stable DEV實讀 `/after-sales-app/api/version`，commit為Source `20f583b6284e93e5516a533733b3833120aaae0d`、revision為 `corely-aftersales-module-dev-as-20f583b6284e-s`。

Source DEV仍主 `moztech-after-sales-dev-as-20f583b6284e-f`；module DEV仍主 `corely-aftersales-module-dev-as-20f583b6284e-s`。其immutable digests分別為 `44b65491c4c4b89d59e1aeb68eab3dc2d677922a745afc797c215aeb06273974`、`4ee1fc7d372fc54a06561d2cce9d261738c4dfde1bc04bbd05d54f5fc7cbce8c`。

## 功能範圍與後續

本批整理六類入口、獨立且可兼任的三工作區、單一頁名和操作優先介面；原建案、案件按鈕及流程、報價、款項、發票、附件、產品／服務價目、匯入與操作紀錄沿用ERP內嵌原Source主單。Native收發保管與簽收、檢修／維修單、複驗、庫存證明維持原接口。原FAQ知識庫從DOA入口排除，Claw頁面操作指南保留。修正已查明的兼任權限GET qualification誤卡、未知清單冒充空清單及分頁／重試busy卡住；沒有重設真人公司、員工、角色或Source承辦映射。

產品的原始盤點、舊FAIL、新修後固定接收、本機窄範圍測試及雙語指南綁定見整合交接與 `reviews`；本文件不將歷史測試重新計為此6cc親跑。私有operator新版actualpins65離線案例及composer73離線案例均有獨立報告；離線工具結果不代替上述實際UI或外部業務。

新跨品牌LINE/AI會話與客服任務接收、獨立品牌開票商戶、銀行／虛擬帳號自動對帳、Source寄出consumer、實際ECOUNT／庫存／物流及真人EASON公司操作仍未驗收。`PENDING_COMPATIBILITY`不是通知成功、顧客收件或結案。對帳建議共用ERP原能力及售後篩選；目前Source財務紀錄仍為實際來源，此批沒有遷帳或第二本帳。

回退參考是原DEV API/Web的 `*-as-f3f14c410490-f` 配對。若需回退，必須重新檢查當時共享DEV狀態、保存無關tags/config與並行版本，再做限定DEV流量變更；本批未執行回退。正式部署及真實品牌／財務／現場驗收另行處理。
