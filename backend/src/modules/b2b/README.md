# B2B 客戶採購與價目模組

這個模組提供獨立客戶登入、已發布目錄、客戶專屬價、客戶 PO 需求、人工核庫、固定版次正式報價、客戶接受與確認接單。新價目表另外管理建議售價、常態售價、團購主進貨價、活動價與客戶常用折數。公司主檔使用既有 `Entity`，客戶／供應商使用既有 `Customer`／`Vendor`；外部帳號不建立內部 `User` 或員工角色。

## 啟用與邊界

- 依序檢查及套用既有 B2B migrations 和 `20260929000000_b2b_public_price_books`。本機測試不會替正式或 DEV 資料庫執行 migration。
- 明確設定 `B2B_PORTAL_ENABLED=true` 才開放客戶入口；預設關閉。既有 DEV 公開註冊及外部 webhook 封鎖仍保留。
- `companyCode` 是銷售公司 `Entity.loginCode`，不是客戶代碼。員工 setup 回應的 `company.loginCode` 可用於提供登入資訊。
- 第一期僅台幣公司、一般商品、正式銷貨報價未稅單價加 5% 稅。登入後既有目錄仍讀取其目錄單價或有效客戶固定價；新價目表與客戶成交比例須由員工明確試算並帶入本次報價，不自動疊加活動或團購價。含稅價在沒有核准轉換規則時不能自動帶入未稅報價。
- `B2B_PUBLIC_CATALOG_ENABLED=true` 只啟用匿名 MSRP 目錄 API；單一商品還須在新價目表明確勾選匿名公開，且既有目錄已發布。三者預設均不讓商品匿名可見。
- 新增的免登入採購需求須同時設定 `B2B_PUBLIC_CATALOG_ENABLED=true`、`B2B_PUBLIC_ORDER_ENABLED=true` 與至少 32 字元的 `B2B_PUBLIC_ORDER_RATE_SECRET`；預設關閉。公開 POST 使用經部署確認可信的 `req.ip`、正規化 Email 與公司，在資料庫分別執行 10 分鐘限流；上線前須確認 Cloud Run／反向代理的來源位址設定。免登入查看／接受專屬正式報價仍未實作。
- 外部 session 為隨機 opaque token，資料庫只存 SHA-256 hash，效期 8 小時。每次要求重查帳號、公司及客戶啟用狀態。停用或重設密碼撤銷現有 session。
- 客戶登入與員工 JWT 分離。客戶只能讀所屬公司的已發布商品及自己客戶的需求；目錄不傳成本、精確庫存、供應商或其他客戶資訊。
- 供應商帳號可由員工建立、停用及重設密碼，資料庫限制客戶／供應商擇一關聯。供應商登入、供應商 PO 查詢與其前台尚未實作；供應商帳號無法進入客戶目錄。
- 不會直接發送 LINE、Email 或通知。缺貨可從員工端建立來源關聯採購單，但收貨後仍須重新人工核庫。

## 流程

1. 員工建立客戶帳號、發布商品與目錄價，必要時設定客戶專屬價或新價目表、客戶常用折數。
2. 客戶登入，選商品及數量，填自己的 PO 號送出。伺服器計價並保存快照，狀態為 `pending_stock_review`。不保留、不扣庫。
3. `quotePath` 指向 `/b2b/requests/{id}`，可由業務複製給 LINE。這是須客戶登入且通過歸屬檢查的連結；不是公開、不受限制的 bearer 報價。
4. 員工逐行確認可供數量與交期。全數符合才 `stock_confirmed`；差異進 `needs_adjustment` 並要求原因。核庫不改客戶原始數量、單價或金額，不保留庫存。
5. 員工出具固定版次正式報價，可修改原需求行的數量與未稅單價；增刪 SKU 須建立新需求。舊版被新版取代後不能接受，顧客以獨立帳號登入接受最新有效版本。
6. 員工另行確認接單，必須指定出貨倉與通路。服務核對人工核庫、客戶接受版次與 WMS 前置條件後，在同一資料庫 transaction 以**接受版次的行項、金額及稅額快照**建正式銷單、預留庫存及寫回 `salesOrderId`，變成 `order_confirmed`。資料缺失或不足量失敗時整體回滾；重送不重建訂單。
7. WMS 出貨、晚間核對及正式扣庫由各自流程處理。本模組不把人工核庫當作實際交運。

另有獨立 `/b2b/shop` 免登入頁，只對已同意匿名公開的商品顯示 MSRP。顧客送出的採購需求進入 `B2bGuestInquiry`，伺服器保存 MSRP 快照並回傳不含個資的參考編號；授權員工可人工核實後配對既有客戶主檔，或留原因標記無效。**配對不會自動建立上面流程的 B2B 採購需求、正式報價、銷單或預留。**

`needs_adjustment` 不可直接確認接單。原需求需要重新人工核庫後才能出具新版正式報價；客戶接受與員工確認接單是兩個不同動作。已接受但尚未接單的報價可由業務記錄原因撤回，重新核庫後再出新版；已接單不可撤回原報價。

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
| `GET /b2b/portal/requests/:id/quotes/:version` | 登入客戶查看所屬公司的固定版次正式報價 |
| `POST /b2b/portal/requests/:id/quotes/:version/accept` | 登入客戶接受最新有效版次 |
| `GET /b2b/admin/setup?entityId=...` | 公司代碼、客戶、供應商、商品、帳號、目錄及專屬價 |
| `POST /b2b/admin/accounts` | 客戶帳號；密碼至少 12 字元且 UTF-8 ≤72 bytes |
| `POST /b2b/admin/supplier-accounts` | 供應商帳號準備；沒有開放供應商入口 |
| `PATCH /b2b/admin/accounts/:id` | `{entityId,isActive,password?}`；不允許更換公司／客戶／角色 |
| `PATCH /b2b/admin/supplier-accounts/:id` | `{entityId,isActive,password?}`；僅採購權限可管理供應商帳號 |
| `PUT /b2b/admin/catalog` | `{entityId,productId,unitPrice,isPublished}` |
| `PUT /b2b/admin/prices` | `{entityId,customerId,productId,unitPrice,isActive,validUntil?}` |
| `GET /b2b/admin/price-books?entityId=...` | 員工查價目、團購主價與活動價 |
| `PUT /b2b/admin/price-books/:productId` | 設定 MSRP、常態價、團購主價、稅別與獨立 `isPublic` 勾選 |
| `POST /b2b/admin/price-books/:productId/offers` | 建立有起迄時間的活動價 |
| `PATCH /b2b/admin/price-books/:productId/offers/:offerId` | 修改／停用活動價 |
| `GET /b2b/admin/customer-discounts?entityId=...` | 員工查客戶常用成交比例 |
| `PUT /b2b/admin/customer-discounts/:customerId` | 設定客戶常用成交比例與效期 |
| `POST /b2b/admin/customer-discounts/:customerId/preview` | 試算後由員工明確帶入本次報價 |
| `GET /b2b/admin/requests?entityId=...` | 公司最近 100 筆需求與人工核庫待辦 |
| `POST /b2b/admin/requests/:id/review` | `{entityId,items:[{id,confirmedQuantity}],reviewNote?,deliveryDate?}` |
| `POST /b2b/admin/requests/:id/quotes` | 出具或修訂正式報價，保留不可覆寫版次 |
| `GET /b2b/admin/requests/:id/quotes/:version?entityId=...` | 員工查看既有固定版次 |
| `POST /b2b/admin/requests/:id/confirm` | `{entityId,channelId,warehouseId}`；正式接單及預留 |
| `GET /b2b/public/catalog?entityId=...` | 開關及逐品項授權後，只回傳匿名 MSRP 與必要商品識別欄位 |
| `POST /b2b/public/requests` | 雙公開開關及限流設定啟用後，接收匿名採購需求，只回傳不透明參考編號 |
| `GET /b2b/admin/guest-requests?entityId=...` | 員工查待核實／已配對／已標記無效需求 |
| `GET /b2b/admin/guest-requests/:id?entityId=...` | 員工查原始聯絡資料與 MSRP 快照 |
| `POST /b2b/admin/guest-requests/:id/match` | 留身分核實依據並配對同公司的有效客戶 |
| `POST /b2b/admin/guest-requests/:id/reject` | 留原因將無效需求移出待處理清單 |

內部 API 使用員工 JWT；客戶價格與訂單使用 sales 公司存取檢查及 sales_orders 讀／建權限，供應商帳號新增與修改另需 purchasing 公司存取與 purchase_orders 建立權限。`requestId` 必須 UUID v4；相同客戶相同提交鍵、相同內容回傳原快照，不同內容回 409。外部 DTO 拒收 unitPrice、entityId、customerId、內部註記或其他未知欄位。

## 驗證範圍

從 backend 目錄執行：

```sh
npm test -- --runInBand src/modules/b2b src/common/guards/jwt-auth.guard.dev.spec.ts
npm run build
```

- `b2b.service.spec.ts`：身分範圍、專屬價、重送、人工核庫、正式報價 V1/V2 快照、客戶接受、接受版次轉銷單及 WMS 前置條件。
- `b2b-pricebook.service.spec.ts` 與 `b2b-pricebook.migration.cjs`：價目、折數、團購主價不自動套用、匿名公開欄位白名單及隔離 SQL 約束。
- `b2b-guest.service.spec.ts` 與 `b2b-guest.migration.cjs`：匿名受理、三維限流、防重、公開品項白名單、公司隔離、人工配對與無效標記、隔離 SQL 約束。
- `b2b-boundaries.spec.ts`：全域 guard 的客戶／員工分流及未知欄位、異常數量拒絕。
- `b2b.http.spec.ts`：實際 Nest HTTP、DTO、bcrypt、JWT 與客戶 session，從帳號→登入→目錄→PO→核庫→停用。使用明確的記憶體 repository fixture，**不是 Prisma 真資料庫端到端測試**。只監聽本機 127.0.0.1 隨機埠。
- `b2b.migration.cjs`：在暫存 PGlite PostgreSQL engine 套用 migration，驗證 XOR、唯一鍵、外鍵及數量／價格／狀態約束。不連接業務資料庫。

SQL 檢查使用既有可用的 PGlite 套件路徑（或已安裝於本專案）：

```sh
PGLITE_MODULE=/absolute/path/to/node_modules/@electric-sql/pglite node src/modules/b2b/b2b.migration.cjs
```

仍需指定 DEV 資料庫的完整 Prisma migration／transaction 驗收，以及實際帳號、商品、倉庫、通路、WMS 商品對照的操作驗收。單元測試、HTTP fixture、SQL 約束測試與本機 build 各自是不同的驗證範圍。
