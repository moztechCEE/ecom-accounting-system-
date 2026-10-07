# Root 接收回執：中央 6cc90395 知識與流程語意

2026-10-08。由 root 指派的獨立接收代理執行。結論：**PASS_SCOPE_KNOWLEDGE_BINDING_AND_SEMANTICS**；本次範圍未發現阻擋。這是精確固定版的指南／來源綁定及程式只讀語意接收，不是 DEV、正式發布、真實通知或現場業務驗收。

## 固定來源與只讀範圍

- Repository：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- HEAD：`6cc903951d42d3f0e9aa5556598595397734859b`；parent：`c932d30f2d9ce8453f9910d257920d5465145c4e`。
- 使用 root 已準備的 detached checkout：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-review-doa-final-6cc90395-20261008`。本人核對本機 HEAD、parent、origin、detached 與開始／結束 tracked clean。named fetch、FETCH_HEAD、遠端 exact ref 的驗證由 root 提供；本代理沒有再次 fetch、改 FETCH_HEAD 或操作遠端。
- 已讀 AGENTS、`docs/dev/doa-clean-workbench-integration-20261008.md`、c932 final、9cc、db86 與9b7b 接收回執；直接核對三份中英工作台指南及相關原始碼。與 c932 的程式路徑差異只有三個 knowledge 檔；沒有 runtime、API、DTO、schema、migration、tests 或 AGENTS 的新差異。
- 本代理不改產品或產品文件、不跑 `--write`、不安裝依賴。僅寫本回執及私有證據，未使用 parent 準備的 node_modules 連結。生成器測試內部的 write 僅發生在自行建立／清除的合成暫存副本，不寫本產品工作樹。

## 親跑檢查與獨立重算

| 檢查 | 本代理實際結果 |
| --- | --- |
| `node scripts/dev/generate-copilot-knowledge.cjs --check` | PASS：79 中英指南、12 群、103 routes、208 source hashes；原24指南保留。 |
| `node --test scripts/dev/generate-copilot-knowledge.spec.cjs scripts/dev/mailroom-intake-knowledge.spec.cjs` | **20/20 PASS**，fail／skip／cancel／todo 均0，2459.277083ms；17 generator＋3 intake knowledge。 |
| 逐一讀取208個真實 source bytes、SHA256及 sourcePaths closure | PASS：missing=0、drift=0、manifest與所有指南的路徑聯集完全一致。 |
| 獨立 Python 重算 sourceVersion、解析 generated entries | PASS：79 entries 的文字、每篇 sources／hash／version均與 source catalog等價。 |
| path／permissions／aliases／module／group 與 c932 比較 | PASS：全部79 entries 無上述欄位漂移；語意變更只有 dashboard、mailroom、repair、DOA workbench、native cases、native invoices 六篇。 |
| `git diff --check c932d30f2d9ce8453f9910d257920d5465145c4e HEAD` | PASS，exit0。 |
| AGENTS 原發布規則對 base264 | PASS：原 DEV-first 段落及7個 release bullets 的完整前綴原文一致；新全系統UI規則沒有弱化原發布要求。 |

測試使用 Node `v24.19.0` 的 fs、暫存副本、合成修改與子程序生成器；沒有 HTTP／DB／通知／退款呼叫。負向案例確實拒絕 source drift、新 route 遺漏、假 alias／導航、缺英文、遺失原指南、未知 related／重複ID、CSV公式、越界／seed source、遺漏來源section及錯誤web runtime覆核。這20項不是業務API／瀏覽器DOM驗收。

完整 sourceVersion：`sha256:581dc117c5ed2bc3b8a63ac2890a44679971b14a30b270f75833d7c4106ffaa3`。

| 固定檔 | 本代理 SHA256 |
| --- | --- |
| `backend/src/modules/ai/knowledge/catalog.source.json` | `16cd0473f643f6ec4c8fa2fdb22703640082ace974bb35e0751d8cfe28335170` |
| `backend/src/modules/ai/knowledge/catalog.generated.ts` | `ae085644c56c48534f6c6d5edbacc463266fddec6cc39f16698b656438411cad` |
| `backend/src/modules/ai/knowledge/source-manifest.json` | `b9390c2af27f01608054b043b83bd7abcbb76d85a7a14cdaf505848f5a04df89` |
| `frontend/src/pages/mailroom/MailroomPage.tsx` | `1d568fcdc3cdb4f88b276bd804932568542ea2d4a478d835cc9f31d347177e49` |
| `backend/src/modules/mailroom/mailroom.service.ts` | `220b470dd7f3289340aba4c63cebcc463bcda2f3212746f7cf2a3e98fa438b51` |
| `frontend/src/pages/after-sales/AfterSalesWorkbenchHub.tsx` | `0e8362f5d2f506fd767288bdcb7fd113ec1cdc16cedca58b02dc1be323ef5dd0` |
| `frontend/src/components/DashboardLayout.tsx` | `9f0d919c892e1683380c15eae78bffc91d0f682c6937825566b05f7eed86133d` |

Page／mailroom service／Hub／Layout 均與 c932 原 bytes 完全一致。已刪的 `frontend/src/pages/mailroom/MailroomNextStep.tsx` 不存在，catalog sourcePaths 與 manifest sources 均無引用。清單仍有下一步／接收人，detail仍有動作；指南已改成這個操作結構，沒有要求已刪按鈕。

## 三工作台、路由與資格語意

指南主路徑／grants 分別為 `/operations/mailroom`＋`mailroom:read`、`/operations/repair`＋`repair_workbench:read`、`/operations/after-sales/workbench`＋`after_sales_cases:read`，與 `ai-copilot-access.service.ts:133` 起的 guide access表相同。指南不授予新AI寫入或业务權限；公司、功能啟用、指派與每次後端守門仍獨立。

**CSR來源待到貨全類讀取不是只有三個 grants 就放行。** `mailroom.service.ts:184` 的真 `intakeCustomerService` 重新核對 actor／entity，三個 grants，source module資格（同公司、dashboard／cases read、cases write），再查 ENTITY（或SUPER_ADMIN）scope及同公司 active Employee。mailroom中英boundary1先指向完整補建資格，boundary10及DOA中英boundary12明列 employee／entity／module要求。Native候選名單不證明來源帳號已登入或每次來源寫入已獲授權；指南將後續原來源帳號／角色核對分開，沒有假稱候選即完成來源驗證。

**獨立 mailroom read 不被 CSR補建資格卡住。** 真 `sourceCases:281` 在具有 `mailroom:read` 時不呼叫 intake資格，仍核對啟用、actor與entity，再讀來源；指南明確與CSR資格分開。repair-only來源清單只留下REPAIR。兼任CSR／repair遇到資格 Forbidden時，catch只允許具既有repair read者再 fresh actor／entity／repair grant核對；network／DB／503等非Forbidden照原錯誤拋出，不被轉為空清單或假成功。此REPAIR過濾只用於來源待到貨清單，沒有套到 native RETURN整新實物；`canRead:158`＋`isRepairWorkbenchItem`仍保留RETURN原有整新資格。

**收发未載入／過期快照／分頁Retry與指南一致。** `MailroomPage.tsx:585` 起只呈現同公司／同搜尋的成功snapshot；初次失敗無 snapshot，顯示未載入與錯誤；更新失敗保留same-scope舊資料並標未更新，歷史empty只表示上次結果，不宣稱目前零筆。scope切換不借用其他清單，generation阻擋舊答。`refresh:620` 在接管時釋放被取代的moreBusy（624）；loadMore仍以當前generation才更新rows/cursor/pages或清busy（687–718），舊finally不能清新請求；Retry以full refresh重新接管。指南兩語steps2描述相同。這裡是只讀碼核對，不冒稱再次DOM重跑。

**維修指南保留實際操作與守門。** 六queues與`repair-model.ts:47`相同；桌面側欄／手機先表單、儲存／提交／已保存版列印分別描述。`RepairWorkbenchPage.tsx:241`的workflow拒絕在Collapse外可見，253的busy禁止收合；指南沒有把尚未獨立實跑的保存成功後父頁GET失敗聲稱已全面驗收。當版CSR／decision、Source consent/funds、文件、stock／PASS及physical custody仍是各自條件，RETURN公司整新另依原分支。

**DOA保留原來源主單。** Hub與model仍對應RESHIPMENT、PRIVATE_PURCHASE、REPAIR、EXCHANGE_RETURN、REFUND_PICKUP、CUSTOMER_ISSUE六enum；新版中英入口與原名稱／類型皆可追溯。workbench-model仍有ENTITY／SUPER_ADMIN＋dedicated grant，SELF不因指南或UI改名擴權。Layout只在合格工作台位置省去shell重複頁名，Hub仍有h2。native case指南明確原`/cases/new`空表單不會依分類入口自動填類型；RESHIPMENT預設不是六類auto-prefill。本次未執行原來源建案或任何寫入。

## 寄出、通知及帳務邊界

Mailroom兩語steps13／boundaries21、repair末段及DOA兩語新增boundary一致：`PENDING_COMPATIBILITY / DISPATCH_CONSUMER_NOT_CONFIGURED`仍表示Source／AI dispatch consumer待串接。真dispatch contract固定此狀態；Page `1276`「寄出同步：待串接」與`1740`「既有進度同步」分開。舊ACK、無delivery或保存成功不能證明本次寄出同步、顧客通知、顧客收件或結案。

指南保留本人簽收後才轉custody、SENT／ACCEPTED／RESOLVED與通知送達／已讀分開、未知結果保留首次body／requestId並要求精確回執、真正物流與raw boolean確認。等級去向不是自動入庫／退款扣款；交換寄出只讀既有POSTED OUT／reservation證明、不二次出庫。品牌LINE身分／OA／會話／承辦人、品牌發票merchant、虛擬帳號自動對帳、影片／顧客報告與新開票放行契約仍待整合。本指南批沒有新增財務帳本、库存movement、退款或真通知操作。

## 歷史與限制

- 9cc原Recipient DOM FAIL、db86 Retry接管busy P2的HOLD／紅探針都保留；本回執沒有覆寫或改標它們PASS。9b7b精確紅轉綠是先前獨立回執的證據，本輪未重跑。
- 沒有重跑backend116、ACL51、Module、公司／Layout、mailroom或repair DOM，也沒有typecheck、lint、Prisma或build執行；中央reported結果及先前byte-identical可承接結果不改稱本代理親跑。
- 未做新的NativeAST比對；本批runtime差異為零及source bytes／208哈希核對，不能取代先前UI修訂各自的AST／DOM回執。
- 沒有Cloud Build／Cloud Run輪詢、部署、traffic、DB、資料映射、production操作或真實第三方呼叫。不署名DEV PASS；本票不授權promotion。角色／公司、Source帳號／接口、品牌LINE／發票／銀行、库存及現場平板／實物交接仍需各自接受證據。

## 精確命令與私有證據

以下均從固定6cc工作樹執行，生成器無node_modules需求：

```sh
git rev-parse HEAD HEAD^
git rev-parse --abbrev-ref HEAD
git remote get-url origin
git status --porcelain=v1
node --version
node scripts/dev/generate-copilot-knowledge.cjs --check
node --test scripts/dev/generate-copilot-knowledge.spec.cjs scripts/dev/mailroom-intake-knowledge.spec.cjs
python3 /var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/knowledge-6cc90395-mailroom-review-3vs5w8y1/verify-evidence.py
git diff --check c932d30f2d9ce8453f9910d257920d5465145c4e HEAD
```

私有證據目錄：`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/knowledge-6cc90395-mailroom-review-3vs5w8y1`。

| 證據 | SHA256 |
| --- | --- |
| `check.log` | `8e81e941d419c141f49e6159d4c90c230c36646b5a017f738bc885748e1ade04` |
| `generator-tests.log` | `ec1f3324b1c21e5d0efd00847534c29eb80eac5bf4716786556b6add6bdd8e57` |
| `verify-evidence.py` | `1387f793a33442172756c99fa997f8df53092c31c5909c8df001531345cbcf66` |
| `independent-hash-review.json` | `f6f50c5468bd09af1c48783832d9e4a592923160b3f2b34ef7e7fb03403b22f2` |

最終範圍判定：**PASS（knowledge coverage／source binding／本次指定流程語意），blocking lines：無。** 固定HEAD不變、tracked clean；本文件位於產品工作樹外。這不是DEV或正式接受。
