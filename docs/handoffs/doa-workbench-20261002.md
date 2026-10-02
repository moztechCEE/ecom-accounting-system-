# DOA 售後維修工作台：DEV 發布與第一版交接

已製作獨立的維修師工作台、認領／本人簽收、兩張電子工作單、客服確認版本及維修交回流程，並於 2026-10-03（台北時間）完成 DEV 發布。DEV 前後端各 100% 流量已切換，正常登入、兩案流程、售後同步及畫面核對通過；正式環境未變更。下方保留本機第一版歷史，最新發布事實以末段「DEV 發布結果」為準，合成資料驗證不代表實物營運驗收。

## 程式來源與工作範圍

- 本次 checkout：`corely-erp-doa-20261002`，分支 `codex/doa-workbench-20261002`。
- 起點：收發室 checkout `corely-erp-mailroom-20261001`，原 HEAD `1ef209eadae2a9a6269c6e5e3a38a25ed540c144`，包含唯讀核對當下尚未提交的收發室修訂。
- 已在本次獨立 clone 保存完整本機收發室基準：`e5adf544`；沒有更改原收發室、售後 checkout。
- 當輪唯讀查到 remote main `a3791c4886bf92025020812d3f30150c974060a6` 已包含於來源歷史。沒有推送或建立 PR。
- 當輪唯讀查到 DEV API／Web 的 100% 流量仍為 `corely-erp-api-dev-access-870e3b18-r`／`corely-erp-dev-access-870e3b18-r`。本次未改流量、部署、雲端資料或發真實通知。完整 preflight 在協調目錄 `artifacts/doa-workbench-20261002/preflight.json`。

## 入口與權限

頁面名稱：**DOA 售後維修工作台**。側欄群組：**DOA 售後維修**。角色名稱：**維修師**，沿用系統角色代碼 `REPAIR_TECHNICIAN`；沒有替任何真實使用者自動授權。

| 側欄功能 | 作業內容 |
|---|---|
| 案件總覽 | 同公司維修案件，以及待到貨／在途售後預告；預告不等於實收 |
| 待認領與簽收 | 認領保留接收人；本人確認實物後才改保管人 |
| 我的檢修 | 本人案件與檢修單／維修單 |
| 客服與付款進度 | 等待客服的交辦與售後來源狀態；案件明細顯示目前版次客服覆核及來源放行 |
| 複驗與交回 | 完成工作單與複驗後交回，等待收發室本人簽收 |
| 檢修與維修紀錄 | 已保存文件、版本與交接歷程 |

技師可查看同公司維修範圍，但只可填寫本人已簽收且仍保管的物件。公司、在職／帳號及角色限制沿用既有檢查。客服從指定待辦閱覽工作單、交回檢測；技師權限不包含客服確認權。一般收發人員的清單、明細、待辦與歷程回應會隱藏完整技術文件，資料庫原版本保留。

## 顧客維修流程

1. 收發室實收、逐件核對，轉維修待認領／簽收。
2. 技師認領，再本人確認實物及位置。認領不改實物保管。
3. 提交檢修單：故障描述、重現、測試條件與逐項結果、原因確定度、診斷、建議維修／替換／送原廠／退回、費用建議及內部估價。
4. 交承辦客服。客服閱覽已提交檢修，回覆時由系統記錄確認人、時間及檢修版次。物件仍由技師保管。
5. 顧客維修含免費方案，開工均需「目前已提交檢修版次的客服確認」及「售後來源 repairAllowed」。ERP 客服覆核不是顧客同意或會計入帳；售後來源仍需另外確認顧客同意與必要款項。
6. 保存實際維修單：處置、料件、工時、逐項複驗、配件；替換另外填品況、SKU、替換 SN、來源及原件去向。實際替換件不能填成原件相同 SN。
7. 已提交文件須互相對應版次／方案，總複驗與逐項測試全部通過，才可交回。收發室本人實物簽收後才成待寄回。

檢修保存新版本會清掉舊客服覆核，需重新交客服。報告綁定檢修版次，舊 PASS 報告不能配新版檢修交付。送原廠或原件退回方案不會被當作已維修／已替換完成；其後續作業由客服安排，尚未新增專用送原廠、拒修退回結案介面。舊等待客服案件無完整工作單時，可退回補檢修，但不取得新版方案施工許可。

公司退貨庫存的 `RETURN / REFURBISHING` 是另一條既有整新路徑：仍需本人工作單、版次及複驗通過，沒有新增顧客付款或客服方案覆核門檻。

## 文件、同步及庫存界線

- 檢修單及維修單有穩定單號、草稿／已提交、新版次、作者／時間、完整版本快照，並可列印**已保存的內部文件**。不建立不符實際的對客報告。
- 使用既有待辦、通知與 WebSocket；案件清單每 30 秒補取。編輯中的文件不被背景刷新蓋掉；重新載入、關閉或切換可能丟失修改時有確認。這次本機 preview 停用外部及 socket 通知，未驗證真實跨系統推送。
- 既有 outbox 契約維持相容，顯示待發送／對方系統已接收。系統接收與人員實物簽收分開；目前沒有另加人員「已接手客服交辦」狀態或即時內部聊天系統。
- 替換文件保存原件與替換件的 SKU／SN、NEW／REFURBISHED、來源、去向和庫存單據參考。**這是追溯紀錄，不會預留、出庫或扣帳**；合格整新品資格、同 SN 排他預留、取消釋放、WMS 實物作業與正式庫存／成本過帳仍需串接。
- 對客報價、同意／拒絕、會計收款確認及後續虛擬帳號事件的正式操作仍屬售後／AI 客服／會計系統。本版只讀取放行結果，不新增銀行或付款操作。需補跨系統報價及同意版本綁定、對帳事件識別及一次放行保障。
- 機種標準、必要測項、DOA／保固及整新品資格、減免／費率、提醒期限、第二人複驗，仍待公司定調；目前表單保留測試條件與明確判定，不擅自套用數值。

## 已執行驗證

- 後端 7 組針對測試、121 項：競爭認領、公司／角色撤回、本人保管、客服確認版次、報告版次／方案／QC、原平板簽收、重試一致性及完整文件權限。
- 前端相關測試 31 項；前後端完整 build、新文件 API 與頁面 lint 通過。
- 實際本機 HTTP／獨立 PostgreSQL：96 次 API 呼叫、55 項檢查通過。三件合成案件走過原機修理、整新品替換、客服已覆核但款項未放行；包含改版舊同意失效、複驗失敗、重複送出、過期版本、同 SN、缺料件 SKU 及跨角色文件隔離。詳見 `artifacts/repair-local/http-e2e.json`。
- 新文件欄位 SQL 已套用空基準的獨立測試庫，再比對 schema 無差異；角色名稱 SQL 已驗證不改使用者與角色權限關聯。詳見 `artifacts/repair-local/migration-check.json`。未在 DEV 或正式套 migration。
- 本機 CUA 實測認領不移保管、本人簽收才可填表、客服唯讀文件、待款項時不能開始維修，維修單草稿實際保存且仍不放行未付款案件，以及整頁沒有橫向溢出。UI 草稿保存把 held 從 HTTP 檢查點 v4 更新為 v5，沒有改變檢修確認或來源放行。詳見 `artifacts/repair-local/ui-check.json`；畫面證據在 `artifacts/repair-local/`。
- Corely Claw 中英文指南已配合本版流程：67 份雙語指南、11 群組、83 路由；146 筆來源雜湊逐筆一致，13 項產生器及 30 項指南權限測試通過。詳見 `artifacts/repair-local/knowledge-check.json`；指南不新增 AI 資料或操作工具。

## 本機預覽歷史（已停止）

原 `http://127.0.0.1:57656/_repair_fixture` 可切維修師、收發室與客服，已停止服務。後續核對使用 DEV 正常登入。固定本機合成帳號只在 opt-in fixture 生效。

API：127.0.0.1:57654；DB：127.0.0.1:57663/doa_workbench；Web：127.0.0.1:57656。嚴格守衛不接受原收發室 57643 DB。DB cluster／log／socket 已排除版本控制。重啟不覆蓋文件；一次性流程測試重跑保護不會重設已完成案件。

```sh
# backend（專用測試庫須事先存在，不能代換其他 DATABASE_URL）
NODE_ENV=production REPAIR_LOCAL_TEST=true DATABASE_URL='postgresql://local:doa-local-fixture@127.0.0.1:57663/doa_workbench' node -r ts-node/register/transpile-only test/repair-local-fixture.ts
# frontend
REPAIR_LOCAL_TEST=true node scripts/repair-preview.mjs
```

以上為第一版本機驗證紀錄。整合及 DEV 發布已完成如下；正式發布仍需使用者核對 DEV 後另行確認。

## 2026-10-02 DEV 發布準備

使用者另行授權 DEV 發布及收發室視窗協調。已保留收發室凍結來源 `cbd9c3b9`，並合併目前接流量的 DEV API 來源 `9f00b55f`（SN 箱貼）、Web 來源 `870e3b18`。未知的零流量 template 僅保留設定／標籤，建置基底使用已確認來源與成功 build 的 serving digest，避免將未證明 runtime 當成發布基底。

新增固定 DEV 的 scoped migration 工具與候選發布工具，套用範圍只有四項 mailroom／DOA migrations；DB 檢查確認其餘 migrations 已套用，僅保留已知歷史 checksum 例外。SQL 與 ledger 同交易，既有員工角色／權限關聯不變；不跑全庫 migrate deploy 或 seed。

ERP sandbox 保持開啟、全域排程及外部 outbox 關閉。唯一新增連線是固定售後 DEV 的 HMAC GET cases：只讀 `doa-dev-qa-20261002` 合成公司，禁止正式 hostname、其他公司、事件 POST、任意 transport／redirect／socket。配對 DEV secrets 只取固定 version 1；金鑰不進 repo、指南或建置 archive。三個正常 JWT 帳號及員工將供隔離核對，並非本機 bearer fixture。

此段保留發布前準備的歷史設定。實際 DEV 已另啟用下述限定合成公司的售後事件回傳；發布結果及界線如下。

## 2026-10-03 DEV 發布結果

- 核對入口：`https://corely-erp-dev-sp5g377smq-de.a.run.app/operations/repair`；收發室入口 `/operations/mailroom`。
- 建置來源 `73e3b6c0e7a3d0b85e98e968303c5e2166722fe1`，Cloud Build `da9c474a-4feb-4b87-82ac-f5c28b947070` 成功。保留凍結收發室 `cbd9c3b9` 與原接流量 API `9f00b55f`／Web `870e3b18` 來源及既有 B2B 預覽。
- API `corely-erp-api-dev-doa-73e3b6c0e7a3-c`、Web `corely-erp-dev-doa-73e3b6c0e7a3-f` 各 100%；所有原標籤保留。API digest `sha256:83a097fa9085b8062d83a1e8805ed0524c3ddc8dd33d7521186f67fe12ecde03`，Web digest `sha256:3b8d0926021eea2ea260206b81033d5e98e9799a83d2ed052d1db637990097a8`。
- 四項 scoped migration 已在 `erp_dev_20260921` 套用：`20261001090000_mailroom_workbenches`、`20261002090000_mailroom_intake_review`、`20261002100000_repair_technician_role`、`20261002110000_repair_documents`。既有使用者角色／權限關聯保留，未跑全庫 seed。
- 合成公司 `DOADEV`／`doa-dev-qa-20261002` 使用正常員工登入與伺服器 JWT：QA7001 維修師、QA7002 收發室、QA7003 限定客服。帳密在版本控制以外的本機私密檔，未放入此文件、Git 或建置 archive。
- 候選正常登入／權限／來源讀取：53 次請求、68 項檢查通過；兩案例正常作業：44 次請求、95 項檢查通過；SN 唯讀預覽：25 次請求、38 項檢查通過，沒有配置 SN 或寫庫存。切換後主入口再次正常登入／讀取：56 次請求、70 項檢查通過。不同測試有重疊，不合計成獨立覆蓋數。
- `DEV-R-001`：免費整新品替換，完成本人簽收、檢修提交、當版客服確認、來源放行、維修報告、逐項複驗及收發室交回簽收；ERP v10 `READY_FOR_DISPATCH`，兩張工作單 v1 已提交。
- `DEV-R-002`：399 元付費方案，檢修及客服確認完成但未入帳；ERP v6 `INSPECTING`，開始維修回應 409、沒有維修報告。未建立假付款或款項放行。
- 售後 DEV HMAC GET／POST 已配對。ERP outbox 16 筆 `AFTER_SALES DELIVERED`，各嘗試一次；售後端 16 個事件與時間軸連續且和 ERP 版本、產品／SKU／SN 一致，其他三件合成來源未推進。首次售後冷啟動曾超過 8 秒 timeout，售後 owner 已將該 DEV service 設 min=1，原 revision／template／traffic 不變，後續讀回正常。
- 外部 AI 客服仍未配對：16 筆 `AI_CUSTOMER_SERVICE PENDING`、attempts=0。全域排程／seed 仍關閉，DEV timer 僅租用限定 QA 公司售後目標，不發真實 AI／LINE 通知。
- CUA 已在 DEV 主入口選 DOADEV、用 QA7001 正常登入，看到六個維修工作台入口、在途 `DEV-R-003`、上述兩件實收案件及已保存工作單。候選畫面另外確認未付款「開始維修」停用及售後已接收／AI 待發送。
- 原本機 API 57654、Web 57656、PostgreSQL 57663 及本輪 Cloud SQL proxy 15442 均已停止，確認無監聽；保留本機資料及證據，後續核對以 DEV 為主。

去敏發布收據、畫面與私密帳號交付檔位於主協調目錄 `artifacts/repair-dev-20261002/`：`release-receipt.json`、`canonical-ui.json`、`dev-repair-workbench.png`、`local-stopped.json`、`DEV-測試帳號.txt`。售後配對收據位於 `artifacts/mailroom-dev-20261002/aftersales-pairing-receipt.json`。這些協調 artifacts 不進 repo。

DEV 回滾來源保留：API `corely-erp-api-dev-sn-9f00b55f-c`、Web `corely-erp-dev-access-870e3b18-r`。如需回滾，先重新盤點當時服務設定及流量，避免覆蓋其他後續發布；本輪沒有回滾或倒退 migration。只切回 HTTP 流量不保證停止仍存活 revision 的 DEV sender；若目的是停止投遞，需一併停用專用 sender／售後 DEV 事件入口。

仍待串接：AI 客服對客報價／同意與拒絕、會計／虛擬帳號入帳事件、報價與同意版本綁定，以及整新品資格、庫存預留／扣帳／成本過帳。替換 SKU／SN 與庫存參考目前只是追溯紀錄。正式服務、WMS 及真實顧客／付款／退款／庫存資料均未變更；公司實物操作驗收另行進行。
