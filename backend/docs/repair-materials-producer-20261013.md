# 維修材料 producer 候選接口

2026-10-13。schema 主檔、生成 client、migration 套用與發布由中央唯一執行；本文件及 fragment／SQL 都不是已部署或真實庫存驗收。

所有 routes 使用 staff JWT 的 `req.user.id`，不接 client 的 actor、cost、currency、領料人、Source approval 或 receipt JSON。

| Route | Body／query | 權限與結果 |
| --- | --- | --- |
| GET `/repair-workbench/items/:id/materials` | `entityId` | 公司／維修讀取或庫存讀取。返回真 DB allocation 及 server projection，case query 不因未備妥消失。 |
| POST `/repair-workbench/items/:id/materials/allocate` | `entityId,requestId,expectedItemVersion,inspectionRevision,planHash,requirementId` | 主管／`inventory:update` 且 inventory ENTITY scope。本版 submitted materialPlan 決定 Product、Warehouse、完整 quantity；可售足量才 RESERVE。 |
| POST `/repair-workbench/items/:id/materials/receive` | 上述共同版次欄位＋`allocationId,expectedAllocationVersion,quantity,confirmedItems:true` | 現任本人維修師、已簽收原件。quantity 是本次實領，累計不可超 allocated；只記 physical，不減 onhand。已部分耗用後仍可實領原預留餘量。 |
| POST `/repair-workbench/items/:id/materials/consume` | 共同版次＋`allocationId,expectedAllocationVersion,quantity,confirmedItems:true` | 現任本人維修師；客戶 REPAIR 要 fresh current CSR／per-item proposal binding／同版同幣足款／必要實開票。REPAIRING 的 REPAIR／REPLACE 僅扣明確必要耗材；原廠 RETURNED 在 INSPECTING、本人 custody、current factory revision/hash 下可記本地耗材，外廠材料不造 OUT。公司 RETURN 用 `requireRefurbishmentWorkStart` 核對正式開工證據、current CSR APPROVE／plan REPAIR、本版 scope/hash／本人 custody／非未來時間，不單憑 REFURBISHING 狀態。quantity 是實耗，不超已領未用；每 allocation 只准一次 OUT。 |
| POST `/repair-workbench/items/:id/materials/release` | `entityId,requestId,allocationId,expectedAllocationVersion`；如實领余料再加 `returnedQuantity,confirmedReturned:true,returnLocation` | 主管／庫存 ENTITY scope。已領未用餘料須本人實收回庫，returnedQuantity 必須等於 received−consumed。解除預留只調 allocated／available，不造 IN 或反向 OUT。可清理舊檢修版本。 |

數量只接受最多兩位小數字串，不自動四捨五入，單次及需求上限 100,000。重試需保留完全相同 requestId／body；同 actor／entity／requestId 內容不同即 conflict。

原件本身 custody／案件 status 不由材料 API 修改。接收、耗用、歸還都有 actor/time 及 operation immutable result；每 allocation 的 reserve／release／OUT 流水各自唯一。耗用後 activeKey 保留，禁止同 requirement 偷開第二 allocation OUT；未耗用並 RELEASE 才清 activeKey，容許重新正確預留。

`projectionForItem(item,tx?)` 為 server-only 讀取，返回 `allocations,receipt,historicalOutstanding,start,completion`；`hasOutstandingForItem(entityId,itemId,tx?)` 查所有版次未解除預留或未實收回庫責任。當版 NONE 也不可使歷史未結清責任變成 completion READY。此讀取核对既有 RESERVE／OUT／RELEASE 的 entity、Product、Warehouse、allocation reference、quantity 與實領／歸還紀錄；不採 client 或 workflow cache 的 READY flag。

完成材料證據須滿足完整必要量曾由本版指定維修師實領，並且 consumed＋physical returned＝allocated，餘料責任為零。只達部分實領或部分耗用而未歸還不能宣告完成 READY。START 僅判 requiredForStart 的 lines；其餘未到貨不能冒整份 READY，也不能誤擋已備妥的 START subset。

Product 的 purchaseCost／movingAverageCost 沒有對應核定幣別和可信來源，所以本 producer 的 costStatus 先為 UNKNOWN、unitCost／costCurrency／costSourceReference 為 null；不接 client 任意成本，不產生或宣稱總帳分錄。

Prisma fragment 的 inverse fields 由中央加至既有 model：

- Entity：`repairMaterialAllocations RepairMaterialAllocation[] @relation("RepairMaterialEntity")`
- MailroomItem：`repairMaterialAllocations RepairMaterialAllocation[] @relation("RepairMaterialItem")`
- Product：`repairMaterialAllocations RepairMaterialAllocation[] @relation("RepairMaterialProduct")`
- Warehouse：`repairMaterialAllocations RepairMaterialAllocation[] @relation("RepairMaterialWarehouse")`
- InventoryTransaction：`repairMaterialReserve RepairMaterialAllocation? @relation("RepairMaterialReserve")`、`repairMaterialOut RepairMaterialAllocation? @relation("RepairMaterialOut")`、`repairMaterialRelease RepairMaterialAllocation? @relation("RepairMaterialRelease")`

新表由 parameterized SQL 存取，已存在的 inventorySnapshot／inventoryTransaction 則用真 Prisma delegate；不在本工作樹生成 shared client。SQL candidate 尚須中央與實際 schema／migration 對標，包含既有 Product `(id,entity_id)` composite unique，不可直接以本文件宣告已套用。
