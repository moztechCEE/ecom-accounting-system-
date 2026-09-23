# B2B 客戶採購入口第一版

這個模組提供獨立客戶登入、已發布目錄、客戶專屬價、客戶 PO 需求及價格快照、人工核庫和確認接單。公司主檔使用既有 `Entity`，客戶／供應商使用既有 `Customer`／`Vendor`；外部帳號不建立內部 `User` 或員工角色。

## 啟用與邊界

- 新增 migration：`20260923040000_b2b_customer_portal`。先在指定測試資料庫檢查及套用；本次程式與測試不會替正式或 DEV 資料庫執行 migration。
- 明確設定 `B2B_PORTAL_ENABLED=true` 才開放客戶入口；預設關閉。既有 DEV 公開註冊及外部 webhook 封鎖仍保留。
- `companyCode` 是銷售公司 `Entity.loginCode`，不是客戶代碼。員工 setup 回應的 `company.loginCode` 可用於提供登入資訊。
- 第一期僅台幣公司、一般商品、稅外加 5%；價格來自已發布目錄或目前有效的客戶專屬價。尚未支援多幣別、級距／促銷疊加或其他稅別。
- 外部 session 為隨機 opaque token，資料庫只存 SHA-256 hash，效期 8 小時。每次要求重查帳號、公司及客戶啟用狀態。停用或重設密碼撤銷現有 session。
- 客戶登入與員工 JWT 分離。客戶只能讀所屬公司的已發布商品及自己客戶的需求；目錄不傳成本、精確庫存、供應商或其他客戶資訊。
- 供應商帳號可由員工建立、停用及重設密碼，資料庫限制客戶／供應商擇一關聯。供應商登入、供應商 PO 查詢與其前台尚未實作；供應商帳號無法進入客戶目錄。
- 不會發送 LINE、Email、通知、建立供應商採購單或進行任何外部交易。

## 流程

1. 員工建立客戶帳號、发布商品與目錄價，必要時設定客戶專屬價。
2. 客戶登入，選商品及數量，填自己的 PO 號送出。伺服器計價並保存快照，狀態為 `pending_stock_review`。不保留、不扣庫。
3. `quotePath` 指向 `/b2b/requests/{id}`，可由業務複製給 LINE。這是須客戶登入且通過歸屬檢查的連結；不是公開、不受限制的 bearer 報價。
4. 員工逐行確認可供數量與交期。全數符合才 `stock_confirmed`；差異進 `needs_adjustment` 並要求原因。核庫不改客戶原始數量、單價或金額，不保留庫存。
5. 員工另行確認接單，必須指定出貨倉與通路。服務確認完整人工核庫、價格快照及 WMS 前置條件後，在同一資料庫 transaction 建正式銷單、預留庫存及寫回 `salesOrderId`，變成 `order_confirmed`。資料缺失或不足量失敗時整體回滾；重送不重建訂單。
6. WMS 出貨、晚間核對及正式扣庫由各自流程處理。本模組不把人工核庫當作實際交運。

`needs_adjustment` 不可直接確認接單；第一版須由客戶依協調後條件重新提交需求。尚未實作原報價修訂／版本核准。報價快照目前沒有客戶在線接受動作；確認接單是員工操作。

## API

所有路徑位於 `/api/v1`。外部前台使用自己的 Bearer session，不共用員工 Axios client 或 `access_token`。

| 路徑 | 用途 |
| --- | --- |
| `POST /b2b/portal/login` | `{companyCode,email,password}` → `{token,expiresAt,profile}` |
| `GET /b2b/portal/me` | 客戶 profile；不含 session hash |
| `POST /b2b/portal/logout` | 撤銷當前 session |
| `GET /b2b/portal/catalog` | 已發布且有效的目錄／客戶價 |
| `POST /b2b/portal/requests` | `{requestId,customerPoNumber,note?,items:[{productId,quantity}]}` |
| `GET /b2b/portal/requests` | 最近 100 筆自己客戶需求 |
| `GET /b2b/portal/requests/:id` | 自己客戶的需求／報價快照 |
| `GET /b2b/admin/setup?entityId=...` | 公司代碼、客戶、供應商、商品、帳號、目錄及專屬價 |
| `POST /b2b/admin/accounts` | 客戶帳號；密碼至少 12 字元且 UTF-8 ≤72 bytes |
| `POST /b2b/admin/supplier-accounts` | 供應商帳號準備；沒有開放供應商入口 |
| `PATCH /b2b/admin/accounts/:id` | `{entityId,isActive,password?}`；不允許更換公司／客戶／角色 |
| `PUT /b2b/admin/catalog` | `{entityId,productId,unitPrice,isPublished}` |
| `PUT /b2b/admin/prices` | `{entityId,customerId,productId,unitPrice,isActive,validUntil?}` |
| `GET /b2b/admin/requests?entityId=...` | 公司最近 100 筆需求與人工核庫待辦 |
| `POST /b2b/admin/requests/:id/review` | `{entityId,items:[{id,confirmedQuantity}],reviewNote?,deliveryDate?}` |
| `POST /b2b/admin/requests/:id/confirm` | `{entityId,channelId,warehouseId}`；正式接單及預留 |

內部 API 使用員工 JWT、sales 公司存取檢查及 sales_orders 讀／建權限。`requestId` 必須 UUID v4；相同客戶相同提交鍵、相同內容回傳原快照，不同內容回 409。外部 DTO 拒收 unitPrice、entityId、customerId、內部註記或其他未知欄位。

## 驗證範圍

從 backend 目錄執行：

```sh
npm test -- --runInBand src/modules/b2b src/common/guards/jwt-auth.guard.dev.spec.ts
npm run build
```

- `b2b.service.spec.ts`：身分範圍、專屬價、金額快照、重送、人工核庫、confirm 重送／共用 transaction／失敗不標記／WMS 前置條件。
- `b2b-boundaries.spec.ts`：全域 guard 的客戶／員工分流及未知欄位、異常數量拒絕。
- `b2b.http.spec.ts`：實際 Nest HTTP、DTO、bcrypt、JWT 與客戶 session，從帳號→登入→目錄→PO→核庫→停用。使用明確的記憶體 repository fixture，**不是 Prisma 真資料庫端到端測試**。只監聽本機 127.0.0.1 隨機埠。
- `b2b.migration.cjs`：在暫存 PGlite PostgreSQL engine 套用 migration，驗證 XOR、唯一鍵、外鍵及數量／價格／狀態約束。不連接業務資料庫。

SQL 檢查使用既有可用的 PGlite 套件路徑（或已安裝於本專案）：

```sh
PGLITE_MODULE=/absolute/path/to/node_modules/@electric-sql/pglite node src/modules/b2b/b2b.migration.cjs
```

仍需指定 DEV 資料庫的完整 Prisma migration／transaction 驗收，以及實際帳號、商品、倉庫、通路、WMS 商品對照的操作驗收。單元測試、HTTP fixture、SQL 約束測試與本機 build 各自是不同的驗證範圍。
