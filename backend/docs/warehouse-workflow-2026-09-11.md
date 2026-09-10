# ERP 建單 → 揀貨 → 裝箱：本機驗收交接

## 狀態與範圍

2026-09-11，本輪已開發原生工作站、ERP 業務建單／選單拋轉、來源端持久命令及聲音回饋。
這是**本機候選，未部署，未正式接通**。瀏覽器用明示的合成資料；跨系統 HTTP 測試使用兩個暫存 PGlite DB 與臨時 RSA keys，不是正式 Cloud SQL、正式登入或實體設備驗收。

- ERP checkout：`/Users/moztecheason/.codex/worktrees/operations-corely-20260910/ecom-accounting-system-`，分支 `codex/operations-corely-20260910`；本輪起點 `60bfdcc5`。
- WMS checkout：`/Users/moztecheason/.codex/worktrees/wms-erp-read-20260910`，分支 `codex/wms-erp-read-20260910`；本輪起點 `dd96237`，業務基準 `9b376526f23c90a907553450630634da4aad8fbf`。
- WMS 本輪本機提交 `0120a59`；ERP 本輪提交可由本文件所在 commit 取得。兩邊均未推送。原 WMS checkout 再次確認仍為 `9b37652` 且 clean。
- 未修改原工作目錄、另一套售後系統、正式 IAM／流量；未 push、未執行雲端 migration 或正式庫存／退款／發票寫入。
- 使用者拒絕現有前端 invoke staging 的授權仍有效。不得公開 staging 或代替使用者新增 invoke grant。
- 已核對本機 repo 的 `.github/workflows/deploy-cloudrun-stack.yml` 會在 push main 觸發部署；沒有 push main／merge／workflow dispatch。本機 commit hooks 僅有 sample，沒有執行外部部署 hook。

## 已完成的主流程

1. 業務「銷售訂單 → 新增訂單」：通路、客戶、日期、商品、數量、TWD 單價。保存 pending ERP 訂單，不自動預留庫存、不產生帳務、也不自動拋單。
2. 建單完成畫面、既有訂單明細、儲運訂單調度均可預覽拋單。調度端搜尋待處理 ERP 單號，不必輸入內部 ID。
3. 預覽內容由後端讀取已保存的 ERP 訂單與明確商品／品牌對照；POST 只收 sourceHash、requestId、公司與訂單 ID，不收瀏覽器自行提供的品項数量。
4. 同公司／訂單唯一的 `wms_dispatch_intents` 保存不可變拋單快照。來源已保存但 HTTP 回應遺失時，保留 unknown；重試沿用已保存 request ID，不再建立第二張來源訂單。
5. 倉儲人員選擇已授權的揀貨／裝箱工作站。不修改帳號角色、不切換別人的身分；ERP 每次查詢重新檢查權限，WMS 每次命令重新核對 worker／brand／station grants。
6. 揀貨站為整頁任務＋大字目前訂單、剩餘件數、掃碼輸入與待核對商品。認領後才允許掃描，全部完成移入裝箱佇列。
7. 裝箱站只呈現符合本人／未認領條件的裝箱任務，逐件第二次核對；最後一件回應已保存才播整單完成訊號，留在本站接下一單。
8. 清單每次請求完成後隔 3 秒再查詢，具取消與失敗重試。來源提供不受搜尋／頁碼影響的 `readyKeys`，新 eligible 任務才通知；首次快照不播報。不宣稱 Socket 即時推送或持久離線通知。

## 防錯與邊界

- HTTP 短效委派綁定 actor／公司／station／method／path／body hash；限制 RS256 與 key strength。瀏覽器拿不到服務私鑰。
- WMS 命令採交易、order/request advisory locks、資料列鎖、內容 revision 核對與持久 request receipts；稽核紀錄與數量變更一併 commit。
- 認領衝突、過期畫面、錯條碼、重複 SN、越權及未解例外均拒絕。命令結果不確定時工作站鎖住並要求重新載入核對，不盲目重刷。
- 需 SN 的品項另外持久記錄 tracking intent。SN rows 遺失或數量異常直接拒絕，不可因 SN 清單變空而降級成一般條碼商品。
- 每個成功 scan 正好增加一件；明細投影驗證 item/SN/total 一致性。完成時間與 SN 更新時間一起保存。
- Read/command 吞吐限制按已驗證身分分開計算；共用 ERP NAT 不會讓少數員工耗盡全站每分鐘 120 次配額。仍有外層 IP 保護與來源容量待測。
- Web Audio 區分揀貨、裝箱、新任務、錯誤、整單完成。語音預設關閉，可在工作站開啟；裝置回饋失敗不能把已保存命令誤判成失敗。
- 建單需 `sales_orders:create`；拋單需 `wms_tasks:read` + `wms_orders:create`；作業另需 `wms_picking:execute` 或 `wms_packing:execute`，再加既有公司 access guard。沒有賦予任何正式使用者這些權限。
- 「裝箱核對完成」不是交付物流、銷貨完成、倉庫實收或可退款。ERP 業務訂單不因包裝核對而直接改成 shipped／completed。

## 必要結構與設定（未套用）

ERP migration：`20260911090000_wms_dispatch_intents`；WMS：既有 021 mapping，以及新增 `022_erp_workspace_commands.sql`。來源完整 migration 序列包含 009 completed_at；不能只執行最後一檔到未建置的 DB。

- ERP：既有 `WMS_WORKSPACE_READ_ENABLED`／URL／issuer／audience／private key，加 `WMS_WORKSPACE_COMMANDS_ENABLED`（預設關閉）。
- ERP `WMS_DISPATCH_PRODUCT_BRANDS_JSON`：公司 ID → 商品 ID → 已核准 WMS 品牌碼。不是依產品名稱或綠界帳號名稱推測品牌，尚未填入正式對照。
- WMS：既有 read 委派設定，加 `ERP_WORKSPACE_COMMANDS_ENABLED`（預設關閉）。
- WMS write router 額外要求 `ERP_WORKSPACE_COMMAND_BOUNDARY=isolated-staging`，且 `ERP_WORKSPACE_COMMAND_DATABASE` 必須符合獨立 `wms_erp_staging_*` DB 命名，實際 `current_database()` 也必須相同。測試 NODE_ENV 僅允許暫存 postgres 名稱例外。
- **正式 `corely_wms` 被此 router 明確拒絕**。因舊 WMS routes 尚未完整隔離 ERP-owned 訂單，不可只打開 feature flag 就向共用正式資料表寫入。
- 來源核准 worker／brand／station／order mappings 仍以空表拒絕為預設，不會將原訂單整批 opt-in。

## 驗證

- ERP backend build、42 suites / 179 tests 通過。
- Frontend TypeScript/Vite build、18 tests 通過；含普通／完成／錯誤音效序列、裝置故障隔離、跨頁新任務辨識。
- WMS scoped read＋commands 測試 5 項通過。PGlite adapter 序列化連線測試競爭認領只能一個成功；這不等於已做真實多連線 PostgreSQL 壓測。
- 跨 repo localhost HTTP 測試：ERP bridge → 簽章與 body binding → WMS SQL → ERP projection；兩個暫存 DB 驗證 durable intent、來源成功但回應遺失後重試、查詢公司權限、錯碼、揀完轉裝箱、包裝完成。命令測試檔同時載入兩個來源案例，合計四項。
- 瀏覽器合成單 `TEST-LINE-0911`：業務表單建立兩件配件、預覽拋單；已開著的揀貨站收到新單；錯碼仍 0/2；正確兩次後交接；另一頁已開著的裝箱站收到單，正確兩次後 2/2 完成。全程沒有手動重新整理清單。
- 圖片：`output/playwright/warehouse-pick-20260911.png`、`warehouse-pack-20260911.png`。只含合成資料。
- 既存 Ant Design Input.Search `addonAfter` 警告與 bundle/browserlist 警告仍在；不宣稱全站零警告。錯碼故意測試的 400 與 favicon 404 不當作正式服務故障。

重跑：

```sh
cd /Users/moztecheason/.codex/worktrees/operations-corely-20260910/ecom-accounting-system-/backend
npm run build
node_modules/.bin/jest --runInBand --coverage=false
WMS_WORKSPACE_SOURCE_ROOT=/Users/moztecheason/.codex/worktrees/wms-erp-read-20260910 NODE_PATH=/Users/moztecheason/Documents/moztech-wms-ecpay/backend/node_modules node --test test/wms-workflow-bridge.e2e.cjs test/wms-source-bridge.e2e.cjs
```

## 接下來的阻擋項與未完成範圍

1. **SN 配置來源待使用者確認**：是業務匯入即有 SN，還是揀貨掃描才綁定？ERP SalesOrderItem 尚無可信 SN allocation，所以需 SN 訂單目前被擋下；沒有私自產生序號、從 ECOUNT 借用序號或降級追蹤。
2. 正式員工、公司、商品／品牌、訂單映射，以及雙角色的實際賦權名單；目前 UI 是「選擇已被授予的站」，未建立每日班表／主管當日排班功能，也未要求同單揀貨與裝箱必須不同人（待業務決策）。
3. 建立獨立 staging DB、機密掛載、API invocation 路徑與部署分開核准；既有私有 staging 的限制不能繞過。
4. 舊 WMS 的 direct SQL writers 必須先共用狀態服務或完整阻擋 ERP-owned 訂單，且驗證取消／改單／轉派／exceptions 邊界，才可解除正式寫入禁制。不得把測試 DB 改名當作 production gate 通過。
5. 舊 Excel／多平台自動匯入格式仍需導入同一 ERP canonical dispatch pipeline；本輪完成手動建單與既有 ERP pending 訂單的拋轉，沒有重作全部 Excel 匯入。
6. 混合品牌、組合商品 BOM／服務商品、收件人與地址／物流方式、標籤列印與封箱交接尚未納入本輪契約，對應來源物流、SN 配置與拆单須分項驗收。
7. 出貨完成回寫 ERP、物流追蹤／回呼、未取退回、倉庫掃碼實收、檢驗／退货分类、財務退回／退款／發票仍保持分離與既有禁寫要求。
8. 現場條碼槍尾碼／輸入焦點／連刷、各螢幕尺寸與音量、真實語音播報、印表機及網路中斷恢復、多連線 DB 壓測尚未驗收。
9. 全 WMS 功能 parity 以 `wms-functional-inventory-2026-09-11.md` 為清單；本輪未宣稱 exception審核、附件、留言、批次列印、全部歷史資料遷移或售後整合完成。
