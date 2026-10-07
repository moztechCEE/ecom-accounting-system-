# 售後工作台第一批介面與整合交付（2026-10-08）

## 版本與範圍

ERP 基底 `f3f14c4104906cc6ca23bd1d38ba4589563b6801`，分支 `codex/aftersales-workflow-20261005`。Source 固定 `20f583b6284e93e5516a533733b3833120aaae0d`，本批不修改 Source、schema、migration、金融、物流或庫存的 command。交付固定 SHA 以本文件所在提交及協作回執核對，不用動態分支名當版本證據。

本批為入口及佈局整理。六類服務回到原頁面、表單與按鈕，沿用所有案件子流程、附件、顧客確認、收款退款、發票、物流及操作紀錄。Source 不變可證原碼仍保留，不能因此宣稱所有原按鈕與外部副作用都已實際驗收。原 FAQ／知識庫依使用者要求排除；Claw 操作說明保留。

## 工作台及顯示名稱

| 首頁名稱 | 原類型 | 原流程保留 |
| --- | --- | --- |
| 補寄服務 | RESHIPMENT | 漏寄、缺件、免費／付費、出貨及完成分支 |
| 商品與配件訂購 | PRIVATE_PURCHASE | 一般商品／配件、多件、台港中／海外、幣別、收款、發票及出貨 |
| 檢測與維修 | REPAIR | 回收、途中、實收、原報價／同意、款項、ERP檢修／維修／複驗及寄回 |
| 換貨服務 | EXCHANGE_RETURN | 瑕疵、寄錯、買錯、自寄／收回、補款／運費及換出分支 |
| 退貨退款 | REFUND_PICKUP | 回收、核對、人工退款紀錄、發票處置、特殊召回／報廢分支 |
| 產品問題回報 | CUSTOMER_ISSUE | 新問題、分類、照片、影片、匯入／匯出與工廠說明留底 |

名稱僅改展示，不改 enum、資料庫或既有狀態。案件總覽沿用原「新增案件、進行中、已結束、刪除清單」、搜尋、批次、詳情／編輯、附件及各節點控制。

客服首頁以六類與案件總覽為主；維修交辦、收發交辦分頁保留草稿；原案件概況按需展開。新收發 deep link 在草稿離頁確認後定位指定原收件。發票、收款退款入口使用原專用 read 權限；開啟不授予提交權，也不將普通客服冒充會計。

產品／服務價目、匯入、來源帳號、操作紀錄、設定及庫存沿用既有授權管理入口；目前 Source Product 尚未遷移 ERP 主檔，因此不能直接刪除原價目／保固資料。含管理權限的人可切回「營運管理」；沒有這些權限的作業人員保持精簡工作台。

## 登入、兼任與權限

售後來源啟用且有 `after_sales_cases:read`、ENTITY 公司範圍或 SUPER_ADMIN 的非管理作業人員，可直接進售後工作台；不限定 CSR/Sales 角色名稱。收發／維修工作台仍需各自啟用旗標與讀取權限。兼任者只切換目前有權限的工作台，不改角色或增加權限。

「設為登入預設」儲存在目前瀏覽器，依帳號與公司分 key；不是後端管理員設定或跨裝置偏好。密碼強制變更優先，已撤銷／未知偏好忽略。切台保留網址明確指定公司，避免 query 公司B被 localStorage 公司A覆蓋。個人費用、請假、出勤與本人薪資保留；薪資資料權限仍由後端核對。

Source 仍要求公司範圍與來源有效帳號、來源角色和委派讀寫權限取交集。ADMIN+SELF 不會被前端當作公司範圍，也不以隱藏選單代替後端授權。

## 帳務整合定調

建議後續將 ERP 既有對帳中心增加「售後」來源視圖，而非另建第二本帳。目前 ERP 已有銀行交易、款項、发票、對帳及分錄模型；Source 的 PaymentRecord／InvoiceRecord／RefundRecord 仍為售後金融真實來源，兩者目前未完成逐筆映射。

先維持 Source 收款退款／開票 command，ERP 視圖引用來源站點、公司、品牌、案件、報價版次、付款請求與已确认入帳、發票提供者／號碼、退款及銀行交易 ID。之後以去重事件及正式 reconciliation 對應，不用案件狀態或末五碼當入帳，不將同一收款在兩邊重複過帳。客服需獨立售後核實收款能力；一般客服的既有 Source 角色目前不當作已具備會計權限。

本批不移轉金融權威、不建立新的付款或發票紀錄、不操作銀行／退款／外部發票。新的「入帳且發票完成後才開工」要求另需明確當版發票證據契約；不是目前只看 consent/payment 的現有 gate 已完成。

## 下一批共用接口缺口

- 收發不符：顧客原申報、不可變客服初審、實收三快照；當版顧客再次確認及失效；resolve_mismatch 與 correct→inspect MATCH 共用後端守門；歸責原因及一次性考績。
- LINE／AI：驗證品牌身份與官方帳號，禁止預設品牌／未驗證舊ID回退。AI已有品牌 conversation／人員指派，尚缺 ERP case binding、領域receiver及持久ACK，不能用既有outbox推定已串通。
- 發票：Source目前單一商戶環境配置；需按品牌選正確商戶，ISSUED不能直接推定是當版真正provider開票成功。款項成功、發票成功、通知成功各自保存、各自重試。
- 維修影片及顧客報告：問題登記的圖／影片保留，不等於ERP檢測項目的影片與顧客摘要已串好。封存不等於刪除財務／追溯；媒體宜外部物件儲存，保留策略另定。
- 出件：收發視窗正在實作獨立outboundShipment及carrier custody，未列入本批接口。Source舊contract未支援時需持久PENDING_COMPATIBILITY，不能標成已通知或顧客已收到。

## 測試、審查與發布

[全量來源功能與操作對照](reviews/source-parity-20261008.md)、[AI接收端架構審查](reviews/ai-service-bridge-20261008.md)及[獨立介面審查](reviews/doa-ui-20261008.md)隨提交保存。Source全量為35pages、23HTTPfiles/25methods、61ServerActions（原60全保留），87 production TSX掃描298 opening sites＋24HelpPanel呼叫及388輸入site；位置數不當實際按鈕／交易通過數。原10/05完整控制矩陣與10/06實際DEV回執為歷史證據，不以歷史驗收代替本批。

目前已實跑34項相關前端測試（employee6、navigation15、repair-navigation4、原after-sales-workbench4、新Hub5）。新增真React/Chromium DOM 8/8通過（7個子情境與父測試，原概況是受控替身，未測真Source授權）；完整frontend/backend build、11個改動程式／測試檔限定lint及diff check通過。雙語知識79指南／103routes／196来源hash生成後check與17/17coverage/drift測試通過。三工作台以固定SHA fetch review，修正後重新核對，最後整合版本再進DEV候選驗收。

本文件建立時未部署。本批不改正式環境；DEV候選、主流量、版本／image、來源配對及回滾需另有實際發布回執。銀行、LINE、ECPAY、ECOUNT及現場交接仍需隔離且逐項驗收。


## 維修固定批整合

DOA UI提交57841c20之後納入維修原587及修訂3e298741（整合cherry-pick 56927f0f／9d73618b），不改維修own內容或shared API。收發修訂固定SHA review PASS，DOA19單元+1真DOM delta PASS；587 P2 FAIL保留。Claw集中使用修後Page/helper/panel並補雙語說明；最後整合SHA及DEV仍須重新審查。收發持久dispatch批次尚未納入，不拿UI整合當出件已完成。

凍結前最後整合驗證：相關前端pure測試87/87、真React/Chromium DOM10/10、knowledge specs17/17；frontend/backend build及維修5檔限定lint、diff通過。知識79篇/103routes/198已審來源，sourceVersion `sha256:d4b56c2b6d3e29fa0725ed3879dad34f01ae5899765f3cd9ac7d1434aad13c45`。受控DOM替身與真Source／DEV實際驗收分開。
