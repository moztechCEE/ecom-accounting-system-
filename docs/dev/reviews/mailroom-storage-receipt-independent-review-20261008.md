# 收件與儲位整合獨立審查（2026-10-08）

本審查核對 `corely-erp-mailroom-intake-storage-20261008` 的工作樹，基底 HEAD `745b8843d42e3955e740594f471b1283dc28d553`。資料以此次讀到的未提交原始碼為準；審查快照時間為 2026-10-08T11:08:33Z。其他開發者仍在此工作樹整合，以下 SHA-256 用於識別本次讀到的檔案，不代表最後提交或部署版本。

審查方式：後端、schema、migration 與主頁導航採只讀靜態審查；審查者另實作並驗證自己負責的儲位前端。原本發現的儲位重新讀取問題，經整合負責者授權後由審查者修正；主頁 wiring 與收件驗證訊息由整合負責者修改。沒有連接正式或 DEV 資料庫，沒有操作正式資料、執行 migration、通知、退款、庫存或部署。

## 發現與處理

### P2：已掛載的儲位工作台沒有收到外部收件／交接更新 — 已修正並驗證

觸發方式：先進入儲位管理，再登記收件、從物件詳情轉交保管，或切到別頁後回到儲位。主頁為保留配置草稿而維持 `StorageWorkbench` 掛載；原先讀取 effect 只依公司變更，儲位畫面因此可能保留舊件數或已轉出的物品。

修正：`StorageWorkbench.tsx:12-33` 接受 `refreshRevision` 並重新 GET 快照，不重設表單、原始 expectedVersion 或 immutable mutation。`MailroomPage.tsx` 已直接檢查四處 wiring：頁首重新整理（339-343）、进入儲位分頁（364）、物件成功保存（560-562）、成功登記收件（581-587）。首次進入後仍保留掛載（384），未以 remount 取代重新讀取。

實際驗證：native DOM 測試於同一已掛載 component 將 fixture A1 外部收件從 1 件增加為 2 件，revision 更新後恰有一次 GET 且畫面為 2 件；再模擬外部保管轉出，更新後為 0 件，不留 phantom occupant。另一案例在 503 不確定結果期間更新 revision，原貨架編碼、body 和 requestId 仍保留，重試 POST 與原請求完全一致。

### 收件照片的本機驗證原因曾被通用錯誤訊息遮蔽 — 已由整合負責者修正，來源確認

觸發方式：實收产品缺照片，或本次照片超過 12 MB，按下一步。原本 `validatePhotos()` 丟出一般 Error，catch 經 `errorText()` 轉成通用失敗訊息，使用者看不到需要補照片或分批收件的原因。

目前 `ReceiptDrawer.tsx:17,46-54,82` 使用 `ReceiptValidationError`，catch 只對受信任的本機驗證顯示其訊息。伺服器／網路錯誤仍走既有處理。本審查者已核對修正原始碼與整合負責者新增的 receipt DOM 斷言，但未執行該 receipt suite；其實際執行結果由整合負責者另附。

本次限定範圍未發現其他已具體證實、尚未處理的 P1／P2。這不是整個系統、部署或實物作業的驗收結論。

## PASS_SCOPE：實際核對到的邊界

| 範圍 | 檢查所得與證據 |
| --- | --- |
| 公司隔離與外鍵 | `schema.prisma:2351-2433` 與兩份 migration 相符。bin→rack、item→bin、item→product 都使用 `(id, entity_id)` compound FK，目標有 compound unique；以 nullable link 保留既有自由文字位置，沒有把舊 A1 文字猜配至新 bin。沒有驗證實際 DB 的 constraint 或 migration application。 |
| 儲位停用／尺寸 | `mailroom-storage.service.ts:416-461,527-552` 在鎖 rack／bin 後驗 version、公司權限與實際占位；有物品不可停用。縮小不得截斷已存在格位。配置更新只更新 rack/bin，沒有搬商品。 |
| 鎖順序 | 儲位命令有 actor/company/requestId advisory lock。更新 bin 與目標移位採 rack→bin。receipt 採收件 request lock→排序來源品項 lock→rack/bin→排序 product `FOR SHARE`→新建 items；避免同一批不同排序的 product lock。停用占位查詢不鎖 item row，所以未見「停用等待 item、move 等待 rack」的循環。這是靜態路徑分析，未做實際 Postgres 並行試驗。 |
| 保管權與移位 | `mailroom-storage.service.ts:575-675` 每次 fresh 授權，限制目前本人保管且 `physicalCustody === MAILROOM`；傳入 item/bin 都限定公司。版本衝突、異公司、他人保管、外部保管均拒絕。move 只更新 bin、位置與 item version，新增一次 `move_storage` audit；沒有改 status、custodian、task、庫存或物流。 |
| requestId 與重試 | 伺服器 command hash 含 operation、target、payload；同 key 換內容／操作會拒絕。前端不確定結果鎖住修改、關閉與 discard，原 path/body/key 保留；4xx 才容許更正。實际 DOM 已驗證 503→原操作重試。 |
| 舊鏈路與占位 | `receiptLinkChanges()` 在 free-text location、真正 custodian 變更、accept/accept_return/dispatch、COLLECTED/DISPATCHED 清 bin link；單純 assign nextUser 不清，因尚未交出實物。產品名稱／SKU 更正會清 productId/barcode；SN-only inspect 不清 catalog identity。Main service 將 helper 結果併入原 command update（1783-1790）。外部 custody／STOCKED 即使有歷史 link，也由 `occupiesMailroomStorage()` 的 status + physical custody 排除；歷史 link 不被當成現存占位。 |
| 收件照片限制 | `mailroom-receipt.contract.ts:12-56` 強制 1–50 件、payload ≤50 MB、維修／退貨／待確認有照片；套用既有圖片 MIME/magic、每件數量／大小限制，解碼總照片 ≤12 MB。驗證於寫入前執行，並非只靠前端。 |
| 案件版本與實收 | `mailroom.service.ts:1037-1210` 先驗 source version，取得來源品項鎖並重新讀來源後再次驗版及剩餘数量。宣告 `declared`、來源 snapshot 與實收資料分開。成功收件為 `RECEIVED` 或同仁包裹 `WAITING_PICKUP`，未自動標記 MATCHED、技師簽收、瑕疵分級或退款。 |
| 結構儲位收件 | `resolveReceiptLocation():67-100` 使用公司 scoped bin，鎖住 rack→bin 並重讀 active；選 ID 時採伺服器 bin code，不信任舊 client location 字串。與停用命令共用順序並持鎖至 receipt commit。 |
| 實物產品與 SN | `validateReceiptProduct():102-124` 鎖同公司 active product，核對名稱、SKU、barcode snapshot；並未從 SKU 找 SN。`ReceiptDrawer.tsx:19-21` 來源預填只綁 sourceItemId，實收產品／SKU／SN 不直接抄成已確認實物；product picker只填 catalog identity，SN 由人員實際輸入。後端只存 row 的实际 SN，未新增序號或扣庫存。 |
| 草稿與導航 | 主頁保留首次 visited storage，`onDraftChange` 報 dirty/busy/uncertain；导航先阻 busy，receipt/storage uncertain 明確阻離開。放棄未保存草稿才 bump `resetDraftRevision`。Storage 的 reset 在 working/unknown 直接返回。快照 refresh 不改 dialog 的原 version。未發現物件導航可靜默抹掉 busy/unknown command 的路徑。 |
| entity 與晚回應 | Storage GET 用 generation、currentEntity、mounted 三重檢查，render 也屏蔽其他公司的舊 state。DOM 實際延遲 company A GET、先切 B 後釋放 A，畫面仍為 B 的 bin 且無 A 管理按鈕。Mutation 原 payload 綁 dialog entity。 |

## 已保留的行為限制

移位完成後若 ACK 遺失，而且實物已轉給其他保管人，再以同 requestId POST 重試，伺服器會先驗證「現在是否本人保管」而回 403，不會回傳歷史成功 ACK。`mailroom-storage.service.spec.ts:587-598` 明文保留此規則；這不是本次新增的未授權 replay。

因此本次只證實「仍有當前公司／本人保管權時，精確重試不重複寫入」。不能聲稱已提供跨保管變更的歷史 ACK reconciliation；需要確認時應讀既有物件详情／履歷，不應為重試放寬現有保管權 gate。

來源案件照片的 CASE 級附件開關及代理 media route 有後續整合變更。本審查只核對其用途未被當作實收照片或逐產品證據，不主張完整審查該附件 API；其 scope/auth/media 限制與測試由該整合負責者記錄。

## 審查者實際執行的驗證

執行目錄為上述工作樹的 `frontend`。以下均為本機合成資料，沒有真實 business HTTP POST；DOM harness 改寫 api adapter，且中止所有非 `127.0.0.1` 請求。

- 前端 application TypeScript `--project tsconfig.app.json --noEmit --incremental false`：PASS。
- 儲位自有檔案 ESLint：0 errors、0 warnings。
- 儲位 model 測試：3/3 PASS；model 在最後 revision 修正未變。
- `node --test tests/mailroom-storage-dom.test.mjs`：最新 exact source exit 0，4/4 PASS（1 父案例 + 3 子案例，非 4 個獨立場景），15.25 秒。只有 fixture adapter 的 4 次 POST：新增貨架 2 次完全相同重試、rack layout 1 次、單件移位 1 次。
- DOM 包含實際 React／Ant Design 控件、空格鍵盤選擇、品項開啟、舊自由文字位置、平面布局、390px 無 document overflow、busy/unknown/reset、mounted revision、跨公司晚回應；無 force click，無 pageerror／外部請求。
- `git diff --check`：PASS。

未由本審查者跑 backend Jest（整合負責者當時正在跑 targeted suites）、完整主頁/receipt flow、真 API／DB、DEV UI、migration、通知、庫存、實際平板簽收或現場儲位驗收。不可把此文件轉成部署／實物驗收已完成的敘述。

## 審查快照 SHA-256

| 檔案 | SHA-256 |
| --- | --- |
| `backend/prisma/schema.prisma` | `ecc12137ad0c866d21cb1513fba5932713ce045ed3a378bedf1f179284229fa2` |
| `backend/prisma/migrations/20261008090000_mailroom_storage/migration.sql` | `bee97cca3976460d9bfdfc3d624b4483f053d2cce1fb4bbbd35586ca0c8b2c18` |
| `backend/prisma/migrations/20261008091000_mailroom_actual_product/migration.sql` | `73703a92297c0b3effbd070082476b390c9a36f5b3f8849c4bb3f1837f1750b8` |
| `backend/src/modules/mailroom/mailroom-storage.service.ts` | `c64567969a724923c2e70b43942b8966654c20de4d0996d30ce8c5388bab7280` |
| `backend/src/modules/mailroom/mailroom-receipt.contract.ts` | `cb826f36f78007746910abfe481b1143d2e8cc8706debe89600990f5e3bb8e87` |
| `backend/src/modules/mailroom/mailroom.service.ts` | `27fd5560c3ce02cb4b4ecbfbdbbfa3c359ef6e06b856cf2e6aa33dc8d3bc984d` |
| `frontend/src/pages/mailroom/MailroomPage.tsx` | `fbe863ba002450d34d99fce7e556cc0aa167972b4a75884a323004bb93a2323e` |
| `frontend/src/pages/mailroom/ReceiptDrawer.tsx` | `ab8aa07a1b55493fe669c4bf29be37a8b6acfcece57cebc0dbcb0fe7553cedce` |
| `frontend/src/pages/mailroom/StorageWorkbench.tsx` | `0fc7d491abad9379c38ccd6449f594fcdc8e9aac1496848a03e21a2c49d45b32` |
| `frontend/src/pages/mailroom/storage-model.ts` | `f532be6814a2e25d0fe7f08f2f4301c3887ca5bdd2a3de97ae417e776e145aa7` |
| `frontend/src/pages/mailroom/storage.css` | `817570761c7c0a12e6634d4fb0f7268360fb8353a80ff846b15c08dd0df9bc39` |
| `frontend/tests/mailroom-storage.test.ts` | `976db0c6d8882e0cb06a8ec6c7edc54e81e4fba33fa5e8120130b502df13279e` |
| `frontend/tests/mailroom-storage-dom.test.mjs` | `00e960768d01c6ab0fe555571d7534ed109585fd14c9a9bd9da3c49d25446346` |
