# DOA 最後交付範圍複核（2026-10-08）

**來源文義 SCOPE PASS。** 本輪僅讀程式／交接與接收回執，沒有新runtime、cloud、auth、DB或業務操作；發布結果待父任務實際回執，不以本文件代簽。

固定ERP `6cc903951d42d3f0e9aa5556598595397734859b`、Source `20f583b6284e93e5516a533733b3833120aaae0d`，兩checkout實際clean。已核integration交接、source-parity全量邊界附錄、AI bridge全文與維修6cc接收（SHA256 `d2a4917fac20f814fdaaf45e3647fa5e2cf75b1c276d64c6fe2292a5d254eebe`）。沒有重跑未變DOM／業務測試。

## 建議最後交付主文

已整合售後、收發室與維修三個工作區，整理為短名稱、資料優先的操作介面。原售後建案、編輯、工作流、報價、付款、發票、附件、產品／服務價目、匯入與操作紀錄沿用ERP內嵌的原Source頁面與同一主單；收發簽收、檢修／維修單、複驗及庫存追蹤維持Native流程。兼任同仁依現有授權切換，不增加第二套產品／LINE／發票／金融系統。新介面與讀取失敗修正已有本機窄範圍證據；實際DEV狀態另附父任務發布回執。

| 展示名稱 | 原type（未改enum） |
| --- | --- |
| 補寄服務 | RESHIPMENT |
| 商品與配件訂購 | PRIVATE_PURCHASE |
| 檢測與維修 | REPAIR |
| 換貨服務 | EXCHANGE_RETURN |
| 退貨退款 | REFUND_PICKUP |
| 產品問題回報 | CUSTOMER_ISSUE |

「商品與配件訂購」包含原一般商品、海外地址／區域、幣別及發票分支。原FAQ／業務知識庫排除於DOA入口；Source相容頁仍存在，Claw操作指南不等同重做FAQ系統。

## 精確限制與交付字眼

- **新增案件需核對類型。** 六類入口開原類型清單，但原「新增案件」href為 `/cases/new`，沒有傳所選type。Source其實支援合法 `?type=`；空白表單在有cases資格時預設RESHIPMENT，只有repairs資格時預設REPAIR。不能說六入口自動帶入類型，也不能說Source完全不支援type query。證據：Source `features/cases/case-list-view.tsx:388/534`、`app/(dashboard)/cases/new/page.tsx:38–43`；ERP `frontend/src/pages/repair/after-sales-launch.ts:2–14`。
- **角色可兼任，偏好只限本瀏覽器。** 工作區依現有permission與公司／Source交集；偏好key含本人與公司，localStorage不授權、不代表跨裝置全局設定。產品／匯入／管理等資格仍可到「營運管理」；基本售後作業可以保留簡潔工作區。證據：`frontend/src/config/workspaces.ts:61–88`、`frontend/src/pages/after-sales/workbench-model.ts:39–46`、`frontend/src/pages/AfterSalesModulePage.tsx:60–100/124–129`。
- **帳務目前沿原來源，統一對帳是方向。** 可建議共用ERP對帳清單／篩選，避免第二本帳；本輪沒有遷付款／發票紀錄或建立新的金融主表。免費也需當版同意，付費仍需同版／同幣足額confirmed付款及當版客服放行，不能用訊息或匯款回報替代。證據：Source `services/mailroom/service.ts:53–65/89–95`，ERP `backend/src/modules/mailroom/mailroom.service.ts:1545–1557`。
- **保留功能入口≠外部整合已驗收。** 原LINE／付款與發票動作保留，但沒有本輪真實LINE送達、品牌／Provider／顧客對話綁定、分品牌發票商戶、銀行／虚擬帳號或ECOUNT實務驗收。AI bridge仍提案，不能稱AI／LINE與六類售後已串好。實際寄出有Native物流紀錄，`sourceSync=PENDING_COMPATIBILITY`，不等於Source shipping consumer、顧客收到或結案。證據：`docs/dev/reviews/ai-service-bridge-20261008.md:1/75–98/145–169`、`backend/src/modules/mailroom/mailroom.service.ts:1627–1629`。
- **盤點不是所有按鈕都實跑。** 原35頁保留、原60actions保留（current61），current23 HTTP檔／25methods；296是原50檔的相容子集，附錄322是lexical controls＋HelpPanel位置，不是322個可點GUI／交易全部驗收。unsupported exports仍不算可用按鈕；另未部署return/HCT工作樹不合併為current能力。證據：`docs/dev/reviews/source-parity-20261008.md:799–855`。

發佈回執到齊後，最後主文只補實際DEV SHA／流量與已執行的候選／canonical驗收、rollback引用；正式環境與實際人員／品牌／現場操作仍獨立。避免把本機、歷史合成case、只讀畫面或文件來源核對改標成新的金流／通知／庫存完成。

## 本轮核對來源hash

- `docs/dev/doa-clean-workbench-integration-20261008.md`：`9657e2bb2cef03e6da7e67b8fdad1fd2085d26969134b69c1837e306aee197bb`。
- `docs/dev/reviews/source-parity-20261008.md`：`c5cdd51b5f7172dda22dd7cf2ceb2ae2f46f787a222ff06f8016bb07f4313dd1`。
- `docs/dev/reviews/ai-service-bridge-20261008.md`：`1527ff8cbdd08c57a065e51a63d1aee7b4d6e103d89f8b2bca109a3fc67c2468`。
- `frontend/src/pages/after-sales/workbench-model.ts`：`8c9beaef2a4e085ee1d00d28874eef76a955cf26934800a6199f98e4b1535aab`。
- `frontend/src/pages/AfterSalesModulePage.tsx`：`8c911cbe6da50b4847b5e71b5b1c3d513c8ecfc3a51740dfee173d634057be4b`。

AI bridge報告自載的AI／ERP舊盤點SHA仍屬該次證據，不重標為6cc；本輪只核6cc現行Source接入、放行與pending consumer對照。沒有新P1/P2產品finding；以上是防止最後交付過度聲稱的範圍限制。
