# B2B 正式報價到 WMS 核銷：配對 DEV 合成驗收

日期：2026-09-24（台北）。此為 DEV 合成客戶、商品、員工與交運紀錄的技術驗收；沒有實物出貨、正式客戶通知、ECOUNT 過帳或正式環境變更。Corely ERP 是正式庫存帳，ECOUNT 僅供查詢或後續核准的會計用途。

## 配對候選與來源

- ERP 來源 `0e57910ffcbda127864ab961420a2ea0da9d115f`；WMS 來源 `ab38d249875c7fdd2a239207fb74cee7e52cce94`。ERP API、ERP web、WMS 的 `quote-pair-0e57910f-0924` 候選皆已建成且 Ready，流量各 0%；三個服務原本的 DEV 穩定修訂維持 100%。報價所需 DEV migration `20260924000000_b2b_formal_quote_procurement` 已套用並核對 checksum；WMS 35 筆 migration 與來源一致。
- 顧客 A 登入後可看到專屬價 80 元與已接受的 V2 報價（2 件、總額 168 元、交期 2026-10-14）；顧客 B 看到同商品 100 元，讀取 A 的報價為找不到；未登入的深連結先導回登入頁。供應商採購單 `f78b852d-ff8f-4b31-b3a6-8ae362b36552` 已收貨，核庫後 V2 才可開立與接受。前段詳細證據見 `ERP_B2B_QUOTE_PROCUREMENT_DEV_QA_2026-09-24.md`。

## 實際 DEV 試單結果

合成需求 `caaa2d95-89c2-47e6-8e05-9bef91200a5d` 經員工確認後，建立唯一銷單 `8a49eaa1-9482-4070-bc13-8c5f986f4a4b` 與 2 件 RESERVE。庫存從在庫／預留／可售 `2／0／2` 變成 `2／2／0`，此時沒有 OUT。WMS 取得同一來源銷單並建立原生 intake `2`、order `8`。預揀列印、指派、條碼掃描與放行完成；WMS picker 與 packer 以 ERP 單一登入的合成帳號各自認領並掃描 2 件，原生 WMS 工作單為 completed。

WMS 建立兩筆各 1 件、箱號各異的合成交運事件 `176c634d-6e89-49ec-b5c0-1bc79f092ca3` 與 `afc470b0-8291-4b35-abee-6ad1606957ab`。發送前共享 outbox 只有這兩筆 fresh pending，無其他未確認事件。固定 DEV worker 以 0% 流量、單一常駐修訂送出，各送達一次並取得不同 ERP inbox ID；ERP 收件後仍維持 `2／2／0`。合成核銷員逐筆人工過帳後，庫存依序 `1／1／0`、`0／0／0`。唯讀資料庫核對：1 筆 RESERVE 2、2 筆 RELEASE 各 1、2 筆 OUT 各 1、2 筆 posting 各 1；每筆單位成本 20 元、出庫成本 20 元。兩筆原始事件與兩筆 posting 各重送一次，皆未新增 OUT 或再扣庫存。

發送器退場已完成：先以新 disabled 修訂接管 0% tag，再刪除舊的 `corely-wms-dev-quote-pair-0e57910f-0924-worker` 常駐修訂；全 WMS revisions 再查為 0 個 enabled sender。DEV 穩定流量始終未切換。第一次 worker 指令因 gcloud 多容器參數順序在本機解析失敗，沒有雲端請求、修訂或事件嘗試；核對後保留失敗收據並以修正的旗標順序一次恢復成功。

## 發現的工作台缺口與修正邊界

舊 ERP 配對候選的工作台揀貨 GET 因 DEV 外連守衛路徑不符回 503，WMS 舊映像也尚無對應的簽章 read／pick／pack 橋接路由。失敗發生在讀取階段；唯讀 DB 確認原生 WMS 工作單仍為 pending、揀貨／裝箱 0，之後才用 ERP 單一登入的原生 WMS API 接續試單。這驗證了**原生 WMS 到 Corely 核銷鏈**，不能視為舊候選的 ERP 工作台揀裝介面已通過。

ERP 與 WMS 的工作台補強在隔離分支實作：嚴格的 DEV 候選外連允許路徑、已簽章工作台讀取與命令、揀裝原生交易收據，以及共用條碼時明確選擇來源列。這些修正須以**新映像、新 0% 配對候選**完成跨服務驗收，才可評估 DEV 主流量。顧客／供應商正式資料、具名員工權限、實物掃碼、真實交運與晚間人員核對仍需營運驗收；本次沒有向客戶或供應商發 LINE 訊息。

本機私有逐步收據與腳本：`/tmp/corely-b2b-paired-trial-20260924/`、`/tmp/corely-b2b-native-pick-recovery-20260924/`、`/tmp/corely-b2b-paired-worker-20260924/`。憑證不在 Git；本文件僅記可審查的合成識別與結果。
