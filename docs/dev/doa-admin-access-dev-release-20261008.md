# 售後工作台帳號與交辦查看權限 DEV 修正

2026-10-08。DEV 已部署；本文件為部署後的文件提交，實際執行版本固定為 `00b76220c25ef9aabb4b955b367a252c61c0aea6`。

## 行為與原因

售後六類入口共用原售後系統的 SSO 人員資格檢查。ERP 的 Super Admin 權限仍須對應到本人同 Email、啟用中的原售後帳號；本次使用者在 Source DEV 缺少該帳號，因此六類入口都被擋住。依本人提供的登入 Email，僅在確認的 Source DEV 資料庫補建一筆本人帳號及一筆技術稽核，完成精確讀回。既有使用者、角色及 ERP／Employee 資料均保留。本人 Email、帳號識別碼、密碼及資料庫連線資訊不寫入 repo。

收發交辦的 GET queue、item detail 及 tasks 原本誤用完整的接手資格檢查，連純查看也要求在職 Employee、Source 寫入資格。新增 `intakeQueueReader`，以伺服器重新讀取的角色、公司範圍與 `mailroom:review` 判斷查看資格：

- Super Admin：固定所選公司的待補建交辦，回傳 `scope: company`。
- 一般獲授權客服：本人受派 SENT 或本人接手 ACCEPTED 交辦，回傳 `scope: mine`。
- 未獲 `mailroom:review`：原本的交辦入口與讀取限制仍生效。

前台依回傳 scope 顯示「公司交辦」或「我的交辦」。錯誤不再顯示為空清單；公司、使用者、查詢與頁碼切換時，較早回應不能蓋掉新的清單或明細。

實際接手、綁案的在職承辦、Source 寫入及案件指派檢查全部保留。`sourceCases`、來源案件寫入、庫存、款項、通知、發票及物流命令沒有修改。`intakeQueueReader` 不能作為讀取所有 Source 案件或媒體的通用授權。

## 部署版本

| 項目 | 固定值 |
| --- | --- |
| ERP runtime | `00b76220c25ef9aabb4b955b367a252c61c0aea6` |
| Cloud Build | `28b0b858-d201-475d-8a76-2051429e85d5`，SUCCESS |
| API 100% revision | `corely-erp-api-dev-doa-00b76220c25e-c` |
| Web 100% revision | `corely-erp-dev-doa-00b76220c25e-f` |
| API image digest | `sha256:667d1650d9e6ce3ff732ed217c649be11e2f4e57a71d4af90425fe13d0182984` |
| Web image digest | `sha256:7e8885081464e6641a0c710f8fa43664f7c1ff4cf518031d06b821df3a68933e` |
| Source DEV runtime | `20f583b6284e93e5516a533733b3833120aaae0d`，維持原部署 |
| Migration | 無；schema、migration 與原服務版本一致 |

DEV：[售後工作台](https://corely-erp-dev-sp5g377smq-de.a.run.app/operations/after-sales/workbench)。切換順序為 candidate API → candidate Web → final Web → 驗證候選配對 → API 100% → 驗證 final Web 與 canonical API → Web 100%。

最後新鮮核對確認兩側上述 100% 流量、主網址載入 `/assets/index-C0vh7VJi.js` 且 SHA256 為 `b0c7666ce471cd18dbe93d5f6fff204ec7cd22ede6ece15725c99b77f16220c8`。九項 Cloud Run 服務狀態與保存的部署狀態一致；七項受保護服務設定／流量及非本工作擁有的 tags 保留。Source DEV 補建本人帳號是另外保存的資料異動，不能誤稱 Source DEV 資料庫完全未變更。正式環境未修改。

## 驗證與界線

- Backend 五套共 134 tests PASS，包含使用真正 actor helper 的查看與接手資格分離案例。
- React／Ant 原生 DOM 共 8 TAP tests PASS，含公司唯讀、本人操作、未保存取消、錯誤與空清單、跨公司／使用者／搜尋／頁碼的延遲回應及 390px 顯示。
- Backend／Frontend production build、build-config type check PASS；範圍 lint 無錯誤。全專案 strict type check 仍有相同 124 個既有錯誤，本次新增與 owned 檔案錯誤為 0。
- 中英文 Claw 指南同步更新，20 knowledge tests 及 generated catalog／source hash check PASS；沒有增加 AI 寫入權限。
- 兩次最終實際登入／頁面驗證各有 5 個全新測試上下文、92 個固定且不重複 checks，全部 PASS。六類原售後建立表單皆實際開啟，但未提交案件。
- CSR 的 `mailroom:review` 與本人交辦 GET 明確驗證；cross-workbench reviewer 沒有該 grant，驗證其無交辦入口、零交辦 request／response，未額外賦予權限。
- 部署 helper 獨立核對與離線 6 正例／109 反例 PASS；UI verifier 39 個離線 guards PASS。初期未通過的 UI 回執保留，不計入完成驗收。

Super Admin 公司 scope 已用真正 backend actor service 與 DOM 案例測試；本人 Source DEV 帳號資格另有精確資料讀回。未代替使用者登入 EASON，仍須由本人重新登入 DEV 核對實際六類入口與「收發交辦」。這批不宣稱真實 LINE／跨品牌通知、匯款、發票、退款、庫存或實物交接已完成業務驗收。

## 私有證據索引

部署證據在 `/private/tmp/corely-doa-admin-access-release-20261008`，本人 Source DEV 補建證據在 `/private/tmp/corely-doa-release-20261008`。資料含限存本機的識別資訊；不要整包提交 repo。

| 證據 | SHA256 |
| --- | --- |
| build context manifest | `beee160690f34ba784653ed6f1873e63bb5b1173f1efb68bf68af0cfa5e6a1f2` |
| 候選配對 UI receipt（309ade） | `9da66f57bbb74010eaa24792d3603dac645d076e37bf8fe6e87e86c260ad39e6` |
| final Web + canonical API UI receipt（5e1023） | `94ed09330124832b43383e214caeb23bc75fe5332e8dde1ae00560353ccd5d11` |
| 92 checks ID 指紋 | `1184d6732ff79c2dd24bbda4276862b90afed714e7ed34563351607aadfcae54` |
| helper 獨立最終 review | `232711d02dfec792bcc078dbb6d2c98e4132819df170d8a95eae691b1a07e187` |
| 最後 live verification | `67f56b7d7855fd687c78fb30f95d09727986aa89dd57cfd8d163453f0bf0597b` |
| Source DEV 帳號 COMMITTED_EXACT_READBACK | `c597a4c158b3a89ca23bee0f9d52c9b1be4170c829ed43550e22fbd618206f1e` |

兩個階段的 immutable acceptance 均保留；current acceptance pointer 指向第二階段。不可重播 provision、deploy operator 或舊驗收檔。

## 後續共同開發與回退

收發新的拍照／產品搜尋／實收／貨架及其兩個 migration，以及維修列表／後續三入口規劃，都未包含於此權限 hotfix。它們需各自固定 source、交叉審查及中央累積整合；不得將這批部署視為那些功能已上 DEV。

回退基準為 API `corely-erp-api-dev-doa-6cc903951d42-c` 與 Web `corely-erp-dev-doa-6cc903951d42-f`。需要時應重新查服務 UID／resourceVersion／設定／流量，以固定舊 revision 重新規劃兩側回退，保留其他工作 tags；不重播舊 spec。回退程式不會自動刪除已補建的本人 Source DEV 帳號。
