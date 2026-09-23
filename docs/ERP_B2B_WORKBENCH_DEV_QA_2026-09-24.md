# B2B 報價、ERP 工作台與 WMS 核銷：配對 DEV 驗收

日期：2026-09-24（台北）。本紀錄只涵蓋隔離的 DEV 合成客戶、商品、員工及交運事件。沒有實物出貨、向客戶或供應商發 LINE、ECOUNT 過帳、正式環境變更，亦沒有切換既有 DEV 主流量。Corely ERP 是正式庫存帳；WMS 保存揀貨、裝箱及交運證據。

## 來源與候選

- ERP branch `codex/b2b-quote-procurement-20260924`，來源 `f1fdcbb7b99fe64b552cee10fbff27b1aea2828c`；WMS branch `codex/wms-workspace-bridge-20260924`，來源 `9073b05338ee74e1ed8c87d793dc2074a898ed68`。兩個 branch 均已推送。ERP Cloud Build `712b0891-967c-47fb-8a93-e0192c4b3824`，WMS Cloud Build `e587e6d0-3bab-41b3-9f51-440001984f46`，均為 SUCCESS。
- 不可變映像 digest：ERP API `sha256:f265224d1f16a6c1a452c2c9542c66f1c09d6b4f766cc507980e083d78848a21`、ERP web `sha256:9a618bea8421cf0feb88c25d4306e31015447a649049e1f078b52c6aad54c509`、WMS API `sha256:5dabbfd55c3a50cc738a6272be6be092fd1aa25f6cbeeb6446090ecc1602a210`、WMS web `sha256:b18fc249a77617218a0126cb20bd279c3cd74d3a508cd1de037c81acaa036cb3`。
- `quote-workbench-v2-0924` 是三服務配對的 0% DEV 標記。ERP API `corely-erp-api-dev-quote-workbench-v2-0924`、ERP web `corely-erp-dev-quote-workbench-v2-0924`、WMS 起始候選 `corely-wms-dev-quote-workbench-v2-0924-config` 均已 Ready。原 DEV 主流量仍是 ERP API `corely-erp-api-dev-b2b-a75132f0b6b3-c`、web `corely-erp-dev-b2b-a75132f0b6b3-f`、WMS `corely-wms-dev-entry-audit2-0923`，各 100%。WMS 35 筆 DEV migration checksum 與來源一致。

## 新合成試單

新需求 `372f3381-5bf0-4436-a3b9-93b4532ebb56` 在專屬 QA 商品庫存 `0／0／0` 時送出。員工人工核庫後建立來源採購單 `fe7b987d-1747-42fb-85c5-051fc28a8b54` 並收貨 2 件；業務重新核庫、出具 V1 正式報價 `9894c807-0d53-41af-beb9-7a9ba758fe95`，客戶 A 登入接受，總額 168 元。此時在庫／預留／可售 `2／0／2`，尚無正式銷單。

業務確認接單後只建立一張銷單 `82b35856-a8f3-4141-9f2d-87122a1564d2` 和 2 件預留，庫存為 `2／2／0`，沒有 OUT。ERP 拋轉到 WMS 原生 intake `3`、order `9`。預揀列印、指派、掃碼及放行完成；ERP 單一登入建立不同的 picker、packer 身分對照。**由 ERP 簽章工作台**讀取 WMS 明細後，兩人各自認領並各掃 2 件。掃碼帶來源行 `itemId`；首筆揀貨與裝箱以原 `requestId` 和舊 revision 重播，數量均沒有增加。WMS 為 2 picked／2 packed，ERP 仍是 `2／2／0`。

WMS 建立兩筆各 1 件、箱號不同的合成交運事件 `85787861-9f08-4c56-b210-16dddd329aa2` 與 `4223c0fd-c2fa-4633-a8e4-b8d686a14f18`。精確 outbox manifest 核對沒有其他未 ACK 事件後，只啟用一個 0% 常駐 DEV worker；兩筆皆各送達一次並取得 ERP inbox 收據。ERP 收件時庫存仍 `2／2／0`，合成核銷員逐筆人工過帳後依序 `1／1／0`、`0／0／0`。唯讀帳證核對為 1 筆 RESERVE 2、2 筆 RELEASE 各 1、2 筆 OUT 各 1、2 筆 posting 各 1；每筆出庫單位成本 20 元、總成本 20 元。兩筆原事件與 posting 原請求重播後，沒有再次扣庫。

測試 worker 已先以停用修訂接管標記並刪除唯一啟用的常駐修訂；隨後在確認 6／6 outbox ACK、重播完成和零 sender 後，把 WMS 0% 標記恢復指向原 `corely-wms-dev-quote-workbench-v2-0924-config`（簽章讀取／命令開啟、sender 關閉）。最終掃描 WMS 34 個修訂，啟用 sender 為 0，原三服務 100% 流量未變。私有逐步收據、0% release provenance、標記復原收據、命令及重播證據在 `/tmp/corely-b2b-workspace-trial-20260924/` 與 `/tmp/corely-paired-workbench-v2-0924/`，憑證及原始請求內容不進 Git。

## 共用 DEV 切流邊界

目前上架的 B2B 商品與 WMS `QA-CORELY` dispatcher grant 都是合成 QA 資料。ERP 商品主檔沒有可直接採信的品牌欄位；不能由商品名稱推定真正的 WMS 品牌對照。若直接把現有候選切成共用 DEV 100%，真正商品可能無法出正式報價或拋單；而 0% 候選的 WMS sender 關閉，交運也不會自動送達 ERP。因此切流須先審核真實商品／品牌對照、具名 dispatcher grant，並以正式 DEV 服務網址建立唯一持續運作的發送器。隔離的 promotion/rollback 腳本會在只有 QA 對照時拒絕切流：`/tmp/corely-b2b-shared-dev-promotion-20260924/`。

供應商帳號已可由採購人員建立、停用及重設密碼，但供應商自助查看採購單入口尚未開放。LINE 目前是複製受權限保護的需求／正式報價連結供人員傳送，沒有自動發訊。ERP 舊管理報表 API 尚無 WMS 對應端點；候選的倉庫頁改走原生 WMS portal，不把舊 API 算作已整合。實體倉管掃碼、物流交接及晚間對帳，仍需具名人員與實物驗收。
