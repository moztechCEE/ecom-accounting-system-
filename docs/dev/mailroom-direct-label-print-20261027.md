# 收發室一鍵列印整合交付

本候選從 ERP `b50a1573fb5166343ad087c43700491140c4e202` 開始，分支 `codex/mailroom-direct-label-print-20261027`。由中央 DOA 負責合併、DEV migration 及部署；本分支不直接操作共享環境。

## 操作與標籤

「全部收件紀錄」單件列印、勾選批印及新收件完成後列印共用相同傳輸。配對設定依 API、公司及登入人員分開保存；本機瀏覽器不保存姓名、電話、問題、配對碼或裝置 token。前端沒有自動重送 POST 或默認退回瀏覽器列印。

伺服器產生 50 × 30 mm PDF：QR、姓名、電話、案件號、產品問題，另有品名／實物標籤。每件實物一頁。QR 四邊留白，線條對齊 203 dpi 整數點，使用受設定的可信任 ERP origin，掃碼仍經原登入及公司權限。

姓名／電話／問題僅由已連結的 Source 案件取得。Source 契約候選為 `7c15b140665b56779a00b515f2f881b264ce3c6d`，父版 `b862a6966cb350edca096d2449f73658e48194f2`；新增 nullable `customerIssue`。REPAIR 對應 faultDescription，REFUND_PICKUP 對應 refundReason，EXCHANGE_RETURN 對應 reasonNote。缺欄位相容 null，非空原文字串含空白、Unicode、換行均保留，只有 PDF 版面縮短。不得拿內部備註、檢測結論或寄件人當顧客欄位備援。

## 後端契約與授權

JWT 端點：

- `GET /mailroom/items/:id/label`、`GET /mailroom/items/:id/label.pdf`：狹義標籤資料與 PDF。
- `GET /mailroom/print-devices?entityId`：同公司已配對裝置。
- `POST /mailroom/print-devices/pair`：`{entityId,name}`；只回一次配對碼與有效期。
- `POST /mailroom/print-devices/:id/revoke`：註冊人撤銷自己的裝置。
- `POST /mailroom/print-jobs`：`{entityId,deviceId,requestId,itemIds,reprintOf?}`；1–50 件唯一物件。
- `GET /mailroom/print-jobs/by-request/:requestId?entityId`、`GET /mailroom/print-jobs/:id?entityId`：本人工作狀態，不回顧客資料或 PDF。

清單與標籤預覽沿用既有 actor、公司及 mailroom:read 讀取規則，不要求新的列印參與員工資格；具合法讀取權且未綁 employee 的 Super Admin／一般唯讀同仁仍可預覽。已停用帳號、必改密碼、已綁但離職及失去原讀取權的拒絕維持原 actor 行為。實際配對、送印、裝置註冊人及輪詢另要求 mailroom:read + mailroom:update 與同公司在職 employee；有／無 employee 的 Super Admin 也受此參與門檻限制。沒有新增全域 ADMIN 旁路，原清單、JWT、角色及 actor 程式保持不變。前端直接送印停用不會一併停用既有預覽及瀏覽器列印。

裝置端點位於固定 `/api/v1/mailroom/print-device/`：`redeem`、`claim`、`jobs/:id/document`、`jobs/:id/receipt`。配對碼 256 bit、五分鐘且一次性，資料庫只存雜湊。裝置 opaque token 30 日到期，只存在 Mac Keychain，資料庫只存雜湊。裝置認證寫入獨立 `req.printDevice`，不建立 `req.user`。

全域 B2bAwareJwtAuthGuard 只認 handler 自有的專屬標記，拒 class／繼承／混用 Public、Source、WMS、HMAC 或 B2B 標記；它完整等待真正裝置驗證後才放行。精確方法與路徑不符直接拒絕。裝置 token 不能使用既有收件、維修、庫存、付款及其他業務 handler。每次工作、領取及提交重驗公司、註冊人現行權限與在職資格；無效 token 不查工作或業務資料。

新增 Prisma `MailroomPrintDevice`、`MailroomPrintJob` 及獨立 SQL migration 草稿 `20261027080000_mailroom_direct_print`。先由 DOA 審查／套用 DEV migration，再部署並啟用：

- `ERP_DEV_SANDBOX=true`
- `MAILROOM_PRINT_ENABLED=true`
- `ERP_PUBLIC_FRONTEND_URL=https://corely-erp-dev-sp5g377smq-de.a.run.app`

未啟用的環境維持拒絕直接列印，不得用正式環境作備援。

## 工作可靠性與資料保存

工作狀態為 QUEUED → CLAIMED → SUBMITTING → SUBMITTED／FAILED／UNKNOWN。唯一 requestId 與內容指紋提供冪等讀回；Serializable 交易阻擋同公司重疊實物同時排印，UNKNOWN 保留防重印鎖。未知結果只能讀回原工作，不自動改用新 requestId、重建案件、換裝置或重送列印。

裝置工作有固定 profile、文件路徑、SHA256、大小、頁數與到期時間。PDF 上限 2 MiB；提交前已由連接程式持久保存，伺服器在 SUBMITTING、終態及安全到期時清除 PDF。雜湊、狀態、CUPS 工作識別及相關稽核資料保留。SUBMITTING 不會自動退回佇列或轉交另一台裝置。

同裝置／公司／工作已進終態但與本機回執不同時，既有 receipt 路徑回傳具型別的 409 與受限 current 摘要，不改寫終態。連接程式核對工作、裝置、頁數及終態內容，分別持久保存 local 結果與 serverReceipt 後才解除回執阻擋；這不是重送 lp 的授權。一般 409、錯工作、錯裝置或不完整摘要不能解除未知結果。

Mac 連接程式使用原廠驅動及正常 CUPS `lp`，固定佇列 `Xprinter_XP-235B`、50 × 30 mm、203 dpi、Rotation180，不用 raw TSPL、USB backend 或修改全系統預設。持久 journal 在 CUPS 提交前記錄 SUBMITTING 並 fsync，native flock 排除同使用者重複行程。CUPS 已接收但回執遺失時只補回執，不再次呼叫 lp；不確定是否提交時保留 UNKNOWN。Keychain helper 的 token 通道不使用 argv 或普通 stdout。

SUBMITTED 只代表 CUPS 接收；它不證明已出紙、貼上產品或完成簽收。真實 PostgreSQL 併行、Mac 安裝／配對與 DEV 實體列印仍須另驗收。

## Migration 與回復界線

SQL 只建立上述兩張新表、索引及限制，沒有 data seed、既有資料 UPDATE／DELETE 或舊表欄位變更。限制包括公司與裝置複合外鍵、公司／建立人／request 唯一鍵、activeKey 唯一鍵、itemIds GIN、有限狀態／profile／頁數／PDF 大小／雜湊／CUPS 回執及終態 PDF 檢查。來源與實物欄位仍由原流程管理，不把列印工作當案件或庫存紀錄。

回復先停用 MAILROOM_PRINT_ENABLED 並由中央回復應用版本，保留兩張列印表與稽核資料；有工作後不得以 DROP TABLE 當一般回復。已經進入 CUPS 的工作不會因回復應用而撤回，SUBMITTING／UNKNOWN 需逐筆核對，不能再排一次。裝置 token、配對及 Mac 安裝皆獨立於 Cloud 回復，按同版 README 處理並保留原 journal。

## 已知實體設備與放行驗收

使用者已確認 XP-235B USB 原廠驅動的 TEST 05：方向正確、QR 左下且可掃碼；紙張橫寬 50 mm、出紙長 30 mm。這只證明原測試版面，尚未證明本候選的完整中文五欄標籤、長 QR 或按鈕鏈路。

整合後由中央安排獨立 DEV 驗收：同公司原有 DEV 物件 → 列表按一次列印 → 裝置領取同一工作 → CUPS 工作識別 → 真實出紙 → 手機掃回正確物件。核對五欄與長文排版、斷線讀回、重複點擊、撤銷、換公司及失權拒絕。不得重建原維修案或重跑客服審核、同意、付款、開票、維修或簽收。AI 維持等待，不發真實顧客通知。

本地候選未執行 migration、Cloud、正式資料、真實配對、Keychain 寫入、LaunchAgent 安裝／啟動或新列印。安裝與配對操作須等中央審查及 DEV 發布完成；不得把本地通過當成 DEV／實體驗收。
