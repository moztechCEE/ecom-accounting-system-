# Mailroom case intake / 收發室發起售後案件

This is a sixth-upgrade private guide patch against ERP `ee20e5ced973dc32519bf0fc771e2675660fac41`. Source remains `20f583b6284e93e5516a533733b3833120aaae0d`. It is operating knowledge, not deployment, browser, business-operation or physical acceptance evidence. Fifth guide/source manifests and receipts remain historical.

這是第六輪 ERP 私有指南補丁，基於上述 ERP 版次，售後來源維持上述版次。此文件不證明已部署、已逐按驗收或已完成業務／實物交接。第五輪指南、來源版本與回執保留為歷史，不改標為第六輪目前驗收。

| Stage / 節點 | Responsible actor / 人員 | Meaning / 意義 |
| --- | --- | --- |
| UNMATCHED + RECEIVED | Current mailroom custodian / 目前收發保管人 | Item arrived without a source case / 實物已到，尚未連結主單 |
| SENT | Custodian specifies one qualified CSR / 原保管人指定一位客服 | Intake sent; notification delivery is separate / 已交辦，不等於本人受理 |
| ACCEPTED | Assigned CSR personally accepts / 指定客服本人受理 | Intake work ownership, no custody transfer / 接手補建工作，沒有接收實物 |
| Original source creation or verified existing case / 原頁建案或核對既有案 | Accepted CSR with source create permission / 已受理客服並有來源建案權 | Open original `/cases`, choose New case, create once through `/cases/new` / 原案件入口點新增案件，原頁建案一次 |
| RESOLVED | CSR binds current case, line and version / 客服綁目前案件、品項與版次 | Same NativeID and receipt link to REPAIR/RETURN / 原 NativeID 與收件單綁回主單 |

The CSR needs active same-company employment, `mailroom:review`, `after_sales_cases:read/update`, sales ENTITY scope and valid source-module eligibility. Native people candidates do not prove an active source profile. Module login and every source action still check the existing active source account and role intersection. Clerks and technicians gain no source finance or case-creation authority from this task.

客服須同公司在職，具上述明確權限、sales ENTITY 範圍及有效模組資格。Native 人員候選不代表已核實來源帳號；模組登入及每次來源作業仍檢查既有有效帳號與角色交集。收發與維修師不因補建任務取得來源財務頁或建案權。

Task, source case, notification, technical documents, payment, inventory and physical custody remain separate. Sending, accepting and binding keep the NativeID, original receipt, RECEIVED status, custodian, location and next recipient. RESOLVED is a verified link, not completed repair, refund, funds or delivery. Current source version and receipt capacity must pass. Legacy multi-item receipts require supervisor reconciliation without automatic splitting or duplicate receiving.

任務、主單、通知、技術單、款項、庫存及實物保管分開。交辦、受理與綁回保留原 NativeID、收件單、RECEIVED、保管人、位置與下一位接收人。RESOLVED 代表已核對關聯，不是維修、退款、收款或寄回完成。須核對目前來源版次與可收數量；舊多物件收件單交主管核對，不自動拆單或重收。

For unknown creation, inspect the original source marker/result before proceeding; do not create a second case. For unknown binding, keep the first body and requestId, inspect history and the read-only lastAction/lastRequestId, and retry only the identical request after reconciliation. An already linked case alone is not proof of this request. Safe intake summaries expose no free text, customer finance or technical records.

原建案未知先查原標記／結果，不再建第二張。綁回未知保留首次內容與 requestId，查歷程及唯讀 lastAction／lastRequestId，核清結果後只重試相同請求。已有關聯本身不是本次成功證明。安全摘要不包含自由文字、顧客金融或技術單。

Coverage stays in four existing bilingual entries: `mailroom-workbench`, `personal-inbox`, `after-sales-customer-workbench` and `after-sales-native-cases`. Citations include the actual intake contract/service, mailroom API and final native UI files. Hash generation waits for runtime-owner freeze. This guide patch adds no AI execution tool or migration.

四篇既有中英指南覆蓋完整閉環，來源明列真實 intake 契約／service、收發 API 與最終原生 UI 檔。待 runtime owner 定稿再生成雜湊。此指南不新增 AI 執行工具或 migration。

Visible after-sales, mailroom, repair, inbox and after-sales stock pages refresh the notification list every 15 seconds; other visible pages use 60 seconds. Hidden tabs are silent. Focus/visibility triggers a read, with overlap prevention and failure recovery. Existing socket/read-marking behavior stays separate. Refreshing a list must not overwrite an open detail or form draft. No hidden-tab, all-day idle or personal acceptance claim is made.

可見的售後、收發、維修、待辦及售後庫存頁每 15 秒更新通知清單，其他可見頁為 60 秒；隱藏分頁停止。取得焦點／回到可見時查讀，避免請求重疊並處理失敗。原 socket／已讀語意分開保留；清單更新不覆蓋已開啟詳情或草稿。此處不宣稱隱藏分頁、整日待機送達或人員本人已接手。
