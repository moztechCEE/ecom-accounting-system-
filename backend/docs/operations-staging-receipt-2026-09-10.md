# Corely 營運中心候選收據

## 交付邊界

使用者更正：儲運不是「開啟作業工作台」外連，而是 ERP 內原生作業介面。已移除外部 WMS 入口，改成 `/warehouse` 清單、佇列篩選、搜尋、分頁及站內明細。認領、掃碼、裝箱和交接命令尚未接通，不能宣稱完整整合。

使用者拒絕新增 ERP frontend runtime 對 staging backend 的呼叫授權。本輪沒有執行 IAM 變更，也沒有公開 staging。前端映像已建好，但沒有替換正式前端或提供可登入的雲端聯調頁；本機預覽使用明示合成資料。

## 程式版本與測試

- ERP 隔離分支 `codex/operations-corely-20260910`：`a53e6f47`、`efe71b690191e67c51796180985a245193c196b4` 已推送；沒有推 main 或觸發正式 stack workflow。
- 原 ERP checkout 的既有未提交工作沒有變更。
- WMS 隔離分支 `codex/wms-erp-read-20260910`：`998c164`；基於使用者指定 `9b376526`，只新增独立 read service／測試／文件，未掛載 HTTP、未推送、未部署。原 WMS checkout 和另一套售後系統未修改。
- ERP 後端 38 suites / 166 tests 通過；前端 9 tests、前後端 production build 通過。WMS PGlite 2 tests 通過。
- 本機瀏覽器核對 ERP 內分頁、未取退回篩選、明細抽屜、來源故障提示及恢復；全為合成資料。核對完成、物流中心退回、公司實收三種事實分開呈現。

## 建置

| 項目 | Cloud Build | 結果 |
| --- | --- | --- |
| 最新前端 | `82d5e929-a556-4aa7-bdd6-79b8c2f45f1d` | SUCCESS |
| 最新後端 | `5436309b-d55d-4a86-9026-862af7bcc93b` | SUCCESS |

- 前端 `ops-efe71b69` digest：`sha256:e0e2dc4215d7a96b601c0ff1f001f81a5bc6b7386c24cf22cb1a43d45af5def3`。
- 後端 `ops-efe71b69` digest：`sha256:190f5501a30710e871e74b9ea19c0b33cb146ab0ee1e925fbde403b3dac293e3`。
- 先前 `ops-a53e6f47` 前後端建置也成功，但前端仍是已淘汰的外連版本，不得發佈該前端。

## 僅 staging 資料表更新

- 資料庫限定 `erp_after_sales_staging`；先比對全部 52 筆已套用 migration checksum，拒絕未知或失敗紀錄。
- Dry run `erp-ops-schema-0910-gh4sb` 成功；唯一待套用為 `20260910110000_after_sales_preparation`。
- Apply `erp-ops-schema-0910-xdhxt` 成功，Cloud SQL migration 日誌確認只套用該三表 migration。
- 使用先完成的 `ops-a53e6f47` 後端映像，schema 與最新 `efe71b69` 相同。沒有變更正式資料庫。

## 未完成／阻擋正式切換

- WMS exporter HTTP、服務驗證、可信 company/brand/employee/order mapping 尚未啟用；ERP `/api/v1/wms/workbench/orders` 在來源未核准時明確 503，不以空資料宣稱同步完成。
- 售後 source company binding 仍需確認，沒有因 UI 品牌設定推論正式商戶或公司歸屬。來源 workbench API 版本也仍需驗收。
- 前端到私有 staging 的完整登入／API 聯調未通過，使用者已拒絕新增該 invoke 權限；不以公開服務或借用正式登入憑證繞過。
- 實際認領、SN、裝箱、列印、附件、物流新建、退回實收與售後交接待逐項原流程驗收。
- 沒有正式庫存、退款、開票或 LINE 發送寫入，ECOUNT 仍是庫存主系統。資料搬遷與正式流量切換各自另行驗收。

## 私有 staging 部署結果

- 2026-09-10 19:14（台灣）：`ecom-accounting-backend-after-sales-staging-00003-jxn` Ready=True，承接該私有 staging 服務 100%。使用上述 `efe71b69` immutable 後端 digest；DB 仍為 `erp_after_sales_staging`。
- `SEED_ON_STARTUP=false`、`RUNTIME_SCHEDULES_ENABLED=false`；既有同步關閉設定及服務身分保留。沒有啟動時 migration 或 seed。
- 使用現有操作者身分，只讀探測 `/api/v1/health`、`/api/v1/health/ready` 均 200。僅 Cloud Run 身分、沒有 ERP JWT 的 WMS 路由回 401；匿名 health 回 403。原先誤用無 `/api/v1` 前綴的 health 回 404，非服務故障。
- IAM 只讀查看沒有 frontend service account／allUsers／allAuthenticatedUsers binding；有既存操作者 user invoker binding。本輪未執行 IAM 寫入。
- 此健康檢查不代表公司、品牌、案件、WMS 映射與交易流程驗收。没有應用登入或實際 WMS 來源查詢驗收。
- 正式重新核對：ERP backend `00506-ray` 100%、frontend `00268-mim` 100%、WMS `00010-hug` 100%；各 service generation 509、269、13 不變，其他開發者候選 tag 保留。
- 前端只完成建置，未部署；沒有切換 `erp.corely.cc`。可視驗收入口仍為本機 `/tests/operations-preview.html?screen=%2Fwarehouse`。
