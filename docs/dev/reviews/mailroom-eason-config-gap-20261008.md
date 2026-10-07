# EASON 待到貨錯誤：唯讀碼證

核對日期：2026-10-08。ERP checkout `corely-erp-aftersales-20261005` clean HEAD `264352c5b863d9928a36ab2a9dbecc697f35a028`；Source checkout `corely-aftersales-workflow-20261005` clean HEAD `20f583b6284e93e5516a533733b3833120aaae0d`。已讀 ERP AGENTS。僅檔案閱讀；未讀 DB、帳號實值、cookie、credential、secret、瀏覽器隱藏狀態，未呼叫端點或變更產品／授權／綁定。

## 結論與兩個 P2

1. **讀取來源清單被補建客服資格額外阻擋。** 精確訊息「接手客服必須是此公司已綁定帳號的在職員工」由 `backend/src/modules/mailroom/mailroom.service.ts:222–227` 的 `intakeCustomerService()` 拋出；核對的是傳入的 `userId` 是否有同公司、在職的 Employee 綁定。`sourceCases():291–296` 對具 `mailroom:review`、`after_sales_cases:read/update` 的**目前 GET 呼叫者**先呼叫這個強門檻，之後才在 `:299–304` 接受原本的 `mailroom:read`／`repair_workbench:read`。因此「原本有讀取權限，同時具有上述 CSR 權限，卻缺員工綁定」會在純清單 GET 被拒，尚未呼叫上游來源。這不是來源案件的指派客服映射錯誤。建議補建專用入口仍保留原門檻；既有讀取者應先沿既有 read 授權，僅依 CSR-only 存取途徑才需 intake 資格。此輪未修改。
2. **GET 失敗後空態誤述為無案件。** `frontend/src/pages/mailroom/MailroomPage.tsx:672–676` 在首次／公司／搜尋／revision 更新先清空 cases 和 cursor；catch `:664–665` 只保存錯誤。畫面仍在 `:727` 顯示「0 筆已載入」，`locale.emptyText :757–765` 顯示「目前沒有待到貨案件」。同時 `:741–749` 有可見警告與原錯誤，並非完全吞錯，但清單未成功讀取不能證明業務筆數為零。建議 UI owner 以失敗／尚未讀取狀態覆蓋空態及筆數，安靜輪詢失敗保留最後成功資料並標示未更新；不更改權限來消除此警告。

## 實際呼叫鏈

| 層 | 精確來源 | 行為 |
| --- | --- | --- |
| 畫面 | ERP `frontend/src/pages/mailroom/MailroomPage.tsx:644–654` | GET `/mailroom/source-cases`，query 帶 entityId、awaiting=true、search／cursor。 |
| Controller | ERP `backend/src/modules/mailroom/mailroom.controller.ts:24–31` | 將目前 `req.user.id` 傳入 `sourceCases()`。 |
| Native gate | ERP `backend/src/modules/mailroom/mailroom.service.ts:281–305` | enabled、fresh actor、company scope，再走上述 conditional intake gate；第305行才開始來源讀取。 |
| 傳輸 | ERP `backend/src/modules/mailroom/mailroom-sync.service.ts:182–197` | 依同 entity 的 AFTER_SALES connection，簽名 GET `/api/integration/mailroom/cases?search=…&awaiting=true…`。 |
| 上游失敗形狀 | 同檔 `:168–172` | 上游非2xx會被改成「上游回應 N，資料尚未同步」，不是本次員工訊息。 |
| Source GET | Source `app/api/integration/mailroom/cases/route.ts:4–21` | HMAC client 驗證、awaiting／cursor驗證，呼叫來源 `cases()`；沒有 ERP Employee 查詢。 |
| Source 投影 | Source `services/mailroom/service.ts:16–21,67–80,98–104,190–196` | client channel＋三種實物流案件；依既有實收投影計算剩餘件數；active Source assignee 僅以員工來源欄位回傳。 |
| 來源客服映射 | ERP `backend/src/modules/mailroom/mailroom.service.ts:313–331` | 另一路依 Source assigneeEmail 比對唯一有效 ERP 使用者＋同公司在職 Employee＋mailroom:review，未匹配回 null；不是 sourceCases GET 的錯誤來源。 |

## 正確設定需要核對的關係（只列契約，未核實 EASON 資料）

- ERP 使用者必須 active、完成密碼設定，若存在 Employee 也必須 active；公司可由 Employee.entityId 或 entityMembership 提供讀取 scope（`mailroom.service.ts:128–160`）。**公司 membership 不等於員工帳號綁定。**
- 補建客服的硬條件是 `Employee.userId === 目前使用者 ID`、`Employee.entityId === query 公司 ID`、`isActive=true`，以及 Native 三權限與 sales ENTITY scope（`mailroom.service.ts:191–227`）。`Employee.userId` 是 optional unique；employeeNo 是人類查核識別，這個 gate 不以員工編號自動配對（`backend/prisma/schema.prisma:1772–1776,1799–1804`）。
- ERP Source module actor 要求設定啟用、`AFTER_SALES_MODULE_ENTITY_ID` 與當前公司相同、有效使用者＋sales ENTITY＋dashboard/cases read 和 cases write（`backend/src/modules/integration/after-sales/erp-module.service.ts:26–60`；intake 對 modules 的核驗在 `mailroom.service.ts:197–206`）。Source account 實際有效性仍須原 SSO/action 契約驗證；Native people 候選不代表已查驗 Source 帳號。
- 真正來源清單連線另由 `MAILROOM_CONNECTIONS` 中同 entity、target=AFTER_SALES 的 entry 提供，要求既有固定 origin/key/signature 配置（`mailroom-sync.service.ts:25–47,109–134`）。本輪未讀設定值，也無必要先更改它來排除此本機 Employee 錯誤。
- `people()` 保留舊 `customerService` flag；新 `intakeCustomerService` 將上述 gate 失敗轉成 false，不會使整份人員名單失敗（`mailroom.service.ts:271–275`）。

## 驗證界線

碼證能說明精確錯誤與清單顯示分支；未宣稱 actual EASON 的 company、user、Employee 或 Source assignee 已知。Root 已詢問本人公司及 CSR employeeNo，應用其回答核對正確關係，勿猜測、替真員工授權、改資料或用合成 QA mapping 代替。未進行 DOM 重現或 HTTP 實測；UI 清理由原 owner 處理。
