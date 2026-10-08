# 收發室收件、案件配對與立體儲位交接（2026-10-08）

本批把收發室整理成一個「登記收件」入口，工作區分收件與交接、寄件、售後待到貨、儲位管理。儲位有固定的立體貨架視圖與平面配置，可新增貨架、格位及調整名稱／配置；點格位能看到物品、案件與目前保管人。這是可合併的開發批，尚未套 migration、建置雲端候選、部署或完成 DEV 人員驗收。

## 固定來源與中央整合

- ERP repo `moztechCEE/ecom-accounting-system-`，branch `codex/mailroom-intake-storage-20261008`，base `745b8843d42e3955e740594f471b1283dc28d553`。
- ERP owned tree `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-intake-storage-20261008`。
- 售後 Source repo `moztechCEE/moztech-after-sales-system`，branch `codex/mailroom-intake-20261008`，base `20f583b6284e93e5516a533733b3833120aaae0d`。固定 Source commit `13be4eac56616902b1b272440d1f37e823d1894f` 已推送並用 ls-remote 核對；對應文件 `docs/mailroom-intake-read-20261008.md`。
- ERP固定交付 SHA、遠端 ref 核對及檔案 hashes 隨交付訊息提供；不得用歷史 base 取代最後 cumulative SHA。
- DOA 視窗持有中央整合、intake 唯讀資格、Source staff binding、Claw catalog／generated／manifest 與 DEV 發布。本批沒有修改這些資格區域或三個中央知識檔。
- 本批 `mailroom.service.ts` 只改新增 import、create、itemSnapshot 及 command 寫入連結清理片段；原 list/views/sourceCases/actor/intakeCustomerService 不變。維修 `9b6e9ec3d4872726934cd006ea53679577573dcd` 的 list/views/repairPhoto 要局部合併，不用整檔 ours/theirs。

## 收發人員操作

1. 點「登記收件」，選維修品、退貨品、公司信件、同仁包裹，或「找不到售後案件」。維修／退貨才需要售後案件；信件／包裹填對方公司或寄件人姓名、內容、具体收件同仁，不顯示 SKU／SN。
2. 搜尋來源可用案件／外部參考號、入件物流單號、電話、顧客姓名、申報產品。完整案件／參考號优先，其餘最近更新优先；例如輸入 T 不会誤當空電話而匹配全部案件。來源申報與實收資料分開。
3. 每列是一件實物。來源剩餘數量只預填列數與申報引用；實收名稱、SKU、條碼、SN 不沿用申報當作已收。選既有 ERP Product 帶入產品名稱／SKU／條碼；找不到可手填。SN 只掃描或輸入實物序號，不生成或分配 SN。
4. 選啟用格位，或填臨時位置；接著拍實物與外包裝，再核對最後摘要。售後及待配對物件每件至少一張實收照片，一般信件照片選填。正常相機大圖在裝置上縮圖，原檔上限 30MiB／20M pixels，輸出最大邊1600px且单張≤1MiB；每件最多4張／3MiB，整張收件最多12MiB。
5. 「確認並登記收件」保存實收與照片，仍進入原品項核對／退貨分級；並不代替正式核對、本人簽收、實物搬運、入庫或退款。找不到案件先登記實收與位置，再走原客服補配對交辦。
6. 已核對維修品仍沿指定技師、平板本人驗證、確認簽收的原流程。處理完工後仍由指定收發本人點收，寄回顧客時填物流公司及單號。入件單號、寄回單號分開保存。

## 儲位與寄件

- 貨架代碼如 A／B、格位如 A1／A2 是固定識別，顯示名稱可編輯。每架可設定收件區或待寄區；沒有把公司未定義的 A/B 區域硬寫死。
- 新架依層／格生成格位；增加架子尺寸後可在空格點新增或用「新增儲位」。編輯平面座標只改畫面配置，不替人搬運實物。
- 有物品的格位或貨架不能停用；縮小貨架不能切掉現存格位。不提供硬刪除歷史儲位。
- 立體貨架與平面區域可切換；搜尋儲位／產品／案件／SN 會標示命中的格位。點格位显示實物、案件、狀態、保管人和位置。
- 舊自由文字位置不猜配成新格位，列為「未配儲位」。只允許目前實際由本人收發保管的物品搬位，保留版本、操作識別與歷程；搬位不產生工作交接、通知、狀態或庫存異動。
- 技師、原廠、物流、已領走或正式庫存持有的物件不算原收發格位占用。新增收件、詳情保存、交接、切回儲位及重新整理會讀取最新占用。
- 寄件工作區目前明確稱「寄回顧客」：只列維修 READY_FOR_DISPATCH／DISPATCHED。WAITING_RETURN_ACCEPTANCE 仍是待收發本人點收；退貨整新交回後是待福利品入庫，不冒充待寄顧客。一般公司對外寄信／包裹未定義，沒有自行加未授權寄件流程。
- 登記或搬位结果未知時保留原 requestId 與原內容，鎖住資料並重試；不能離開去另建一筆。搬位成功但回執丟失後物品已正式交給他人，原 POST 會因現保管權限拒絕；現況可刷新查閱，但沒有另加歷史回執補認領接口，不放寬本人保管 gate。

## 唯讀來源照片与到貨數量

來源照片是 CASE 級附件，不宣稱逐產品對應。使用 JWT→ERP→既有 HMAC Source，先展開 metadata，再按圖懶讀，回 WebP 縮圖，不公開原圖URL／GCS路徑或把token放URL。實收照片另存當件 evidence；維修 native repair-photo 只讀當件 evidence。

全量 awaitingCases／awaitingItems／inTransitCases 與載入清單筆數分開。只有仍缺件且來源物流真為 IN_TRANSIT 才計在途；有案件或單號不等於已寄出。統計超過安全完整計算範圍（5000 scoped open cases）回 complete:false/counts:null；失敗或不完整不能顯示零。

權限沿原 sourceCases：mailroom:read 全類型、原合格承辦CSR、repair_workbench:read 僅 REPAIR。純唯讀 CSR 沒有完整Source案例權限；DOA 最新 intakeQueueReader 只是交辦 company/mine 讀取，不能直接拿來授予全部Source。沒有自行擴權，後續新增assignment/case read scope由中央另定。所有新media/summary在upstream等待後重查當前帳號、公司與讀取權限。DOA已確認此次intake唯讀hotfix不擴此scope，另定CSR Source資格時需按case／assignment重驗。

## API 與資料庫

| ERP 登入 API | 行為 |
| --- | --- |
| `GET /mailroom/product-options?entityId&search` | 活躍同公司 Product 最小投影，最多30；不含成本、庫存、可配SN或產生SN操作。 |
| `POST /mailroom/receipts` | 原路徑新增 sourceVersion、storageLocationId、逐件 productId/barcode/evidence；來源版次、當前產品內容、啟用儲位重查，原 requestId 去重。 |
| `GET /mailroom/storage?entityId&search` | racks、locations/items、unassigned、stored/unassigned counts、canManage。只讀本公司當前收發保管。 |
| `POST /mailroom/storage/racks`、`/racks/:id/update` | 新架／編輯；requestId，更新加 expectedVersion，重試內容相同。 |
| `POST /mailroom/storage/locations`、`/locations/:id/update` | 新格位／名稱啟停；同公司同架、空座標、版本與去重。 |
| `POST /mailroom/storage/items/:id/move` | 本人現保管、expectedVersion、requestId、storageLocationId 或臨時 location；只位置与歷程。 |
| `GET /mailroom/source-summary?entityId` | 完整或明確不完整的全量待到貨／在途數量。 |
| `GET /mailroom/source-cases/:id/attachments`、`/…/:attachmentId/media?entityId` | CASE 級照片metadata／authenticated binary缩圖。 |

Source 新增 HMAC GET `/api/integration/mailroom/summary`、`/api/integration/mailroom/cases/:id/attachments`、`/…/:attachmentId/media`；原cases查詢路徑擴充搜尋，原 receive/staff writes 不改。

兩個增量 migration：

- `20261008090000_mailroom_storage`：兩表 rack/location；MailroomItem 可空 storageLocationId、同公司複合 FK、唯一架碼／格位碼／座標，命令JSON與keys去重。
- `20261008091000_mailroom_actual_product`：MailroomItem 可空 productId／barcode、同公司 Product 複合 FK。既有資料不回填、不猜儲位；不新增重複 Product 唯一索引。

原command改自由位置、簽收／交回／派送時會清除舊storage link；更正產品時清除舊product/barcode link，避免歷史連結與新實物不符。保留原 custody、notification outbox、source aggregate及庫存/財務寫入 gate。寄出原 Source sync 仍 `PENDING_COMPATIBILITY`，不能宣稱 SourceAI／LINE dispatch consumer已完成。

## 驗證與界線

本批保存原生DOM、合成Nest／Prisma／HMAC／GCS fixture與窄單元測試。結果分項交付，不把重覆執行或父子TAP nodes相加當新案例總數。

- Root backend：storage、catalog、receipt contract/security/capacity及原dispatch/tablet/history，8 suites／137 PASS。
- 新媒體proxy／service＋原sync：48 PASS；儲位單獨48、receipt/catalog供方105為重疊分項，不加總。
- 原主工作台DOM1 PASS、待到貨DOM1 PASS；新貨架native4 nodes（parent+3）、純模型3 PASS。新收件flow含相機縮圖、照片限制、未確定結果原payload重試、懶讀／延遲回應与公司隔離，最終8 scenes／9 TAP nodes PASS，70.20秒；真合成PNG 10,322,341 bytes縮成JPEG 806,485 bytes，decoder／FileReader忙碌 guard通過。proof與26檔UI hash在 `evidence/mailroom-intake-storage-20261008/` 保存。
- Frontend app/node 与 backend build-config noEmit、範圍 lint、Prisma validate/generate（私有client、fixture URL、不連DB）及 diff check。不是 full backend strict PASS。
- `reviews/mailroom-storage-receipt-independent-review-20261008.md` 記錄貨架刷新 P2 已修；`reviews/mailroom-review-repair-9b6e9ec3-20261008.md` 是固定維修接收 PASS_SCOPE；Source独立審查另附；修正CaseItem／歷史detail搜尋及>100筆物流的全量在途一致性後，Source35 PASS（24收發案例＋11受影響workflow-binding）。
- 截圖在 `/tmp` 是本輪合成實際渲染驗證，不是 DEV 頁面與正式帳號，也不作不可變的歷史雲端驗收。

未驗真 Postgres SQL／lock競態、migration套用、GCS IAM、真JWT角色、整合雲端runtime及人員實物接受。未部署、修改正式資料、發真LINE／退款／發票或入庫。公司部門整組收件／廣播規則未定，目前選具體同仁。

## 下一步中央發布

中央先完成目前權限hotfix，再按固定Source/ERP commit局部合併維修唯讀變更和本批。採最後 cumulative SHA 重新核 schema/routes/typed Source、套兩migration於DEV、核只允許DEV公司和合成帳號的端到端行為，最后驗新產品/實收相片/申報分離/儲位實占/技師簽收/待到貨數量。

雙語 Claw 變更已在 `mailroom-intake-storage-claw-draft-20261008.json`，僅提案，未改catalog/source-manifest/generated。中央需保留最新權限修正，移除舊兩入口／申報直接帶入實收／無schema變更說法後生成與核hash。本批不代簽知識覆蓋、candidate或DEV live接受。
