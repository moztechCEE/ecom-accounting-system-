# 維修接收端：DOA 最後共同固定版 ba567582

日期2026-10-08。送出DOA `01a0f8f7-a9b6-7172-a28a-aafc8b6e8be2`；接收維修 `01a117fd-0a9e-7882-a4aa-c9a27d34f1d3`。

## 固定版本與保護

- Repo `https://github.com/moztechCEE/ecom-accounting-system-.git`；ref `codex/aftersales-workflow-20261005`。
- named explicit fetch、remote tracking、ls-remote同為 `ba567582051cec29765213b3561566d446f264d8`；新detached tree `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-doa-ba567582-20261008`，建立及測後tracked clean。
- own維修原分支88與舊review tree保留。node_modules只symlink既有依賴，probe/cache於/tmp或inline；沒有修改DOA tree、shared、guide或新增root untracked。已讀AGENTS與本批handoff／正式回執。
- 37b完整碼版 `37b069888999d87de14c0b4f04374ea55c81d80b` 至ba只6份docs，產品、tests、guide無差異。

## 結論：PRODUCT_SCOPE_PASS；回執校驗文件1項P2待窄修

最後固定產品組成、維修接收端、三個確認入口、公司／權限及中央雙語知識在下列範圍PASS_SCOPE。原ad/dd/a787 FAIL歷史保留，沒有沿用無Git衝突推定。另發現文檔雜湊聲明不符ba，已要求DOA以新doc-only固定SHA補版本限定，產品相同者不重測未變介面。

| 實際獨立檢查 | 結果 |
| --- | --- |
| 對照最後組成 | 53ec維修source、2ade維修source/test、d75收發source、0c導航／公司／DOA Hub逐組git diff --exit-code空；另16收發／12維修元件byte同值。 |
| 三DTO與受影響service tests | 5 suites／173 PASS：physical-confirmation、repair-workflow、tablet、stock receipt及stock service。 |
| inline真pipe／guard／service probe | 158斷言PASS：51 raw DTO情境、17真confirmPhysical guard、8真service optional、3權限／保管／版本負例；依賴替身、filesWritten/external=0。 |
| frontend pure | 67/67 PASS（employee/navigation/repair-navigation/readiness/mailroom-workbench/draft共59，repair-workbench另8）。 |
| actual frontend DOM | 8/8 TAP PASS：repair完整Page1（10情境，含records公司/view/scope與真保存紀錄）、readiness1、workspace6（父＋5子，真Layout/Dashboard/Palette/context）。API/身份為合成，不等於DEV。 |
| knowledge readonly check | PASS：79 guides、103 routes、209 hashes，drift0；sourceVersion `sha256:85ac4ab78de250e3c3309929ddab67ec2d57ee86e256a4e37f8c565fff29a759`。 |
| knowledge generator/intake specs與ACL | 20/20、51/51 PASS。 |
| handoff hashes與paths | mailroom16產品hash、repair4來源hash一致；guide三篇中英/generated相符。 |
| fixed diff／tracked cleanliness | PASS，正確ba HEAD及clean；沒有編輯產品或guide。 |

## 三DTO、原生接口及知識語意

TabletAccept及ReceiveReturnStock只接受raw JSON true；RepairWorkflow仍optional，需實物確認的return_original/send_factory/receive_factory等動作由原native confirmPhysical要求true，false/null/omitted不能移轉；cancel_factory及claim_customer不新增實物確認義務。原main、業務services、permission/custody/version/request／stock guards對修訂parent無diff。

精確區分新spec：89項為80次直接ValidationPipe及9項真service／合成依賴，本spec沒有HTTP/controller loopback；DOA私有112 HTTP矩陣是另一份送出證據，接收端不冒稱重跑。變更沒有新增endpoint或放寬現實物／庫存條件。

DISPATCHED只能只讀既有檢修／維修／寄出資料，拒修不再要求再次收發簽收；保留原件／換機／原廠的保存處置、原IN歷史、正式OUT唯讀關聯与carrier目前保管。records與all包含DISPATCHED；company query、合法工作台grant及預設同目的地保持。來源/AI的PENDING_COMPATIBILITY與DISPATCH_CONSUMER_NOT_CONFIGURED不轉成ACK；既有DELIVERED不證明本次寄出同步、通知、顧客收件或結案。三篇指南與原始boolean、optional actions、上述界線相符。

## 文件P2：引用的DOM receipt雜湊與ba不符

`docs/dev/reviews/doa-integrated-knowledge-20261008.md:12` 載DOM receipt SHA256 `dc729bfce5c4c86b5d21bdfa51202113d4a06f210f14d8de3c54d48ab93e7030`，並稱原bytes保留。此值符合37b；ba刪除DOM receipt文末空行後實際為 `b1ef4770ab46f37e811871a407747cf65c3afcfc905ec1e15d777c1eeff9b0de`。root親跑git show37b/hash及ba檔hash重現，不是产品程式回歸。

已交DOA補「37b歷史hash／ba規範化後hash」與版本限定，或恢復原bytes；新固定doc-only提交另核對。沒有自行改DOA固定tree／shared。這項未修前，不稱完整發布回執校驗PASS。

## 接收端重跑命令

backend cwd：

```sh
node_modules/.bin/jest --runInBand --no-cache src/modules/mailroom/physical-confirmation.dto.spec.ts src/modules/mailroom/repair-workflow.service.spec.ts src/modules/mailroom/mailroom-tablet.service.spec.ts src/modules/integration/after-sales/after-sales-stock.receipt.spec.ts src/modules/integration/after-sales/after-sales-stock.service.spec.ts
./node_modules/.bin/jest --runInBand --no-cache --cacheDirectory=/tmp/corely-repair-ba567582-knowledge-acl-20261008 src/modules/ai/ai-knowledge.service.spec.ts
```

frontend cwd（67pure兩次執行，此處為同scope合併命令）：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --loader /tmp/corely-doa-review-env-loader-20261008.mjs --experimental-specifier-resolution=node --test tests/employee-workspaces.test.ts tests/navigation.test.ts tests/repair-navigation.test.ts tests/repair-readiness.test.ts tests/mailroom-workbench.test.ts tests/mailroom-draft.test.ts tests/repair-workbench.test.ts
node --test tests/repair-dispatched-page-dom.test.mjs tests/repair-readiness-dom.test.mjs tests/workspace-company-dom.test.mjs
```

repo root：

```sh
node scripts/dev/generate-copilot-knowledge.cjs --check
node --test scripts/dev/generate-copilot-knowledge.spec.cjs scripts/dev/mailroom-intake-knowledge.spec.cjs
git diff --check 37b069888999d87de14c0b4f04374ea55c81d80b ba567582051cec29765213b3561566d446f264d8
shasum -a 256 docs/dev/reviews/doa-integrated-dom-20261008.md
git show 37b069888999d87de14c0b4f04374ea55c81d80b:docs/dev/reviews/doa-integrated-dom-20261008.md | shasum -a 256
git status --short
```

沒有再測其他未變產品，未操作真DB、provider、JWT、通知、金融、庫存post或實物。DEV candidate只由DOA統籌；本產品SCOPE_PASS不能代簽candidate真登入／可見UI或主流量及營運成功。

使用者另要求維修UI清單／表單cleanup，下一獨立 `codex/repair-ui-cleanup-20261008` 從ba開發，只屬下一批owned UI；未混入本fixed receiving結論。整合者需將本正式回執後續隨產品commit保存，文件SHA由其保存批另定。

## 追加固定doc-only修訂264352c5：最終SCOPE_PASS

DOA新固定 `264352c5b863d9928a36ab2a9dbecc697f35a028`，parent ba；接收端named explicit fetch／remote tracking／ls-remote皆精確同值。`ba..2643`只有上述knowledge receipt一行更正；frontend/src、frontend/tests、backend、scripts空diff，diff check PASS。

已逐讀該行：dc729…明確限定37b歷史，ba EOF規範化後改記b1ef4770…，報告主體／受測版本／產品與tests bytes不變，作者舊執行與DOA集中校正分開。與本接收端先前兩版本實際hash相符，故關閉本文件P2；保留ba原文件校驗待修歷史。

結論：**2643最後fixed composition SCOPE_PASS**。以production/test/guide byte-identical證據對照沿用上述173backend／158probe／67pure／8DOM／20knowledge／51ACL等結果，没有冒稱新SHA全部重跑，也沒有擴測未變介面。candidate登入／可見UI、主DEV流量、SourceAI外部相容及實物仍另驗。owned新布局未包含在2643，後續需獨立提交／接收審查。
