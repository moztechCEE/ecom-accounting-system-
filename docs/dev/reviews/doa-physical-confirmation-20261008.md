# DOA 實物確認：固定 37b06988 獨立 HTTP 收據（2026-10-08）

**PASS。** 固定 `37b069888999d87de14c0b4f04374ea55c81d80b` 關閉 d75 報告的三個 DTO 同根 P2：原始 JSON 字串 false／true、數字、陣列與物件不再隱式轉 true；合法 boolean true、本人／位置／當版與一次寫入／重試行為保留。舊 d75 收據與原 runner hash 保持不改。

受測 checkout：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005`；開始、結束及測試後均 clean。本輪只新增此 coordination 收據與私有 factory 補充 runner，沒有 ERP untracked 或產品／測試／知識修改。

## 實跑矩陣

兩 runner 先檢完整 HEAD，從 actual main.ts AST 取唯一 ValidationPipe 選項，載真 controller／DTO／service，以 raw JSON 經 loopback HTTP 驗證。只有 authentication、Prisma、Source／worker 使用 existing synthetic fixture；receive_factory 前置由真 service 依序 send_factory→accept_factory→request_factory_return 建立。

| 入口／動作 | 真 boolean true | 其餘 15 值 | 合法效果 |
| --- | --- | --- | --- |
| dispatch | 201 | 400 | 一次 item/action，READY_FOR_DISPATCH→DISPATCHED |
| 平板本人簽收 | 200 | 400 | 真 tablet service 委派 confirmed true；下游 command 為 fixture，不宣稱真 DB custody 更新 |
| return_original | 201 | 400 | CSR DECLINE＋本人保管前提下 WAITING_RETURN_ACCEPTANCE／RETURN_UNREPAIRED |
| send_factory | 201 | 400 | 當版客服／顧客同意／足額款項 fixture 放行後 FACTORY_OUTBOUND／FACTORY_CARRIER |
| receive_factory | 201 | 400 | 原技師从 FACTORY_RETURNING 簽收，INSPECTING／RETURNED／TECHNICIAN |
| RETURN 庫存點收 | 201 | 400 | 合格 RETURN／QC／所有權與庫存權限 fixture 下建一次 IN |

原 runner **64** 矩陣＋factory runner **48**＝**112 次矩陣請求**；return_original 16 個在兩 runner 重複獨立核對，**不同情境為 96 個**。16 值：true、false、string false、string true、空字串、空格、0、1、-1、null、省略、[]、[true]、[false]、{}、{confirmed:true}。

三個維修實物動作的 false／null／省略均確實進真 service，在 `repair-workbench.service.ts:443–446` 回 400「請本人核對實物並確認交接」，零新增 item/history/publish且完整 row不變；其餘 12 非法型別在 DTO拒絕，不進 service。另 true＋空 location 三項均 400且不改 row。

## 重試與守門

- dispatch true exact replay 201／duplicate true，只寫一次；撤 mailroom:update 後同 key replay 403。replacement 只核既有 POSTED／CONSUMED／formal OUT，inventory／reservation／unit／consumeForRepair mutation 0。
- stock true exact replay 201／duplicate true，一次 IN；同 key改位置 409且不再 IN。三維修動作 true exact replay亦各 201／duplicate true，完整 row保持第一次結果，item/history各一次，原 SN／本人保管與未虛構 repair report保持預期。
- `a3068ffc621971ade8cf100d7b06b1b461ad0296..37b06988` 的 main、三個業務 service、ERP module controller/service/contract與 source guard zero diff。公司／sales ENTITY／module grants／origin／section守門不變（`erp-module.service.ts:39–60、84–99`，`after-sales-source.guard.ts:18–44`）；這是 code／diff證據，本輪未重新驗收真 module ticket。
- dispatch sourceSync仍 PENDING_COMPATIBILITY／DISPATCH_CONSUMER_NOT_CONFIGURED；沒有 dispatch outbox、gateway或Source worker呼叫，沒有新增未知 Source事件／AI enqueue。既有 pending相容待辦保持。

## 本人實際執行

| 檢查 | 結果 |
| --- | --- |
| 原 immutable runner，fixed模式 | PASS，64矩陣；dd舊 DTO raw false→true negative control仍重現，37b拒絕 |
| factory補充 runner | PASS，48矩陣＋3空位置負例＋3exact replay |
| DTO／tablet／repair workflow／stock receipt四套 Jest | 4 suites／163 tests PASS，skip 0，約1.78秒；非整個backend |
| backend tsc noEmit／incremental false | PASS |
| git diff --check／ERP clean | PASS |
| 三 DTO bytes對manifest | 全匹配，sources=209；只核hash，不執行generator |

HTTP精確重跑命令：

```sh
node /private/tmp/corely-doa-release-20261008/verify-physical-confirmation-http.cjs --repo '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005' --sha 37b069888999d87de14c0b4f04374ea55c81d80b --expect-siblings fixed --baseline-sha dd0b5b4453eb0cf348fd7b3a4b4b39c2ea73d91d
node /private/tmp/corely-doa-release-20261008/verify-repair-factory-confirmation-http.cjs --repo '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005' --sha 37b069888999d87de14c0b4f04374ea55c81d80b
```

backend cwd測試命令：

```sh
./node_modules/.bin/jest --runInBand --no-cache --cacheDirectory=/private/tmp/corely-doa-release-20261008/jest-37b-physical-review src/modules/mailroom/physical-confirmation.dto.spec.ts src/modules/mailroom/mailroom-tablet.service.spec.ts src/modules/mailroom/repair-workflow.service.spec.ts src/modules/integration/after-sales/after-sales-stock.receipt.spec.ts
./node_modules/.bin/tsc --noEmit --incremental false -p tsconfig.build.json
```

## 受測 bytes SHA256

| 檔案 | SHA256 |
| --- | --- |
| `backend/src/modules/mailroom/mailroom-tablet.dto.ts:24–30` | `933d1578c3b90eedc970189c69379fc9c7d7e8190acbdbb5f31c6787a949dc5e` |
| `backend/src/modules/mailroom/repair-workflow.dto.ts:27–33` | `d703355ee97eaafc0d2a69f3d344995a0a26653b5ab51f14356588b93825ffbf` |
| `backend/src/modules/integration/after-sales/after-sales-stock.dto.ts:22–28` | `628829c8c078fdb3ec5e39512df9c80d314180ca32ab817298001cf5019315ee` |
| `backend/src/main.ts:32–42` | `4c3ae51ea4a4de15ec4c3fcebfbfd1aa7472b244e44bb5bc21d908bc7a52f4dd` |
| `backend/src/modules/mailroom/physical-confirmation.dto.spec.ts` | `e0b454745c8174859b0b0cb5e8f056ea87f1b086d707633fcaacd99657383aa2` |
| 私有原 runner `verify-physical-confirmation-http.cjs` | `5cbeee3c2510c1205ca33fa53c2e15e5b7788214548f51cd6dfb96e3135cdbff`，未修改 |
| 私有補充 `verify-repair-factory-confirmation-http.cjs` | `7c17a28c4e30508a0d463ac542365f062ab5f0d8aa6f9959d69dc63bd4632d62`，600／node --check PASS |

此範圍未發現仍成立的 P1／P2；後續文件commit不可冒稱已受測SHA，須保持上列產品bytes或另核差異；本輪僅synthetic loopback，未驗真JWT／DB／DEV UI或Cloud、實物／原廠／LINE／付款／發票／退款／外部庫存，私有DEV UI runner未live。
