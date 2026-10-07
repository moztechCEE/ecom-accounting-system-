# 收發室介面整理交接（2026-10-08）

使用者要求全系統保留乾淨介面，不在工作畫面常駐冗長教學、工程旁白或重複提示。此批從已核對的整合版整理收發頁面；操作、案件資料及真正阻擋原因仍可見。教學由 Corely Claw「這頁怎麼用」承接，不改成另一個常駐說明折疊區。

## 版本與編輯範圍

- Repo：`https://github.com/moztechCEE/ecom-accounting-system-.git`
- 隔離工作樹：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-ui-cleanup-20261008`
- 分支：`codex/mailroom-ui-cleanup-20261008`
- 基底：`264352c5b863d9928a36ab2a9dbecc697f35a028`；named fetch、FETCH_HEAD、ls-remote 一致，開始時 clean，已讀本版 AGENTS。原收發 d75 工作樹保留。
- 送審完整 SHA 由提交後的訊息與遠端核對提供；不得把基底 SHA 當成此批提交。
- 本批六個 production 路徑：`MailroomPage.tsx`、`RecipientPicker.tsx`、`TabletAcceptance.tsx`、`SourceCasePicker.tsx`、`mailroom.css`，以及刪除僅 Page 使用的 `MailroomNextStep.tsx`，均位於 `frontend/src/pages/mailroom/`。
- 調整兩個既有 actual DOM tests 的文案 selectors 及 screenshot 檔名。此文件為第九個差異檔。
- 不修改 backend、API client、action codes、共享 model、state/guard/pending helpers、schema、migration、權限、導航、維修頁、AGENTS 或共享知識檔。`CustomerIntakeQueue.tsx` 的文案由 DOA 單一編輯。

## 介面結果

1. 頁首保留標題與動作，移除部門眉標、重複流程帶及說明段落。待到貨保留案件、數量、承辦與搜尋。
2. 詳情保留一組操作按鍵、實收／來源品項、目前保管與位置、下一位同仁、實物照片、分級、入件／寄出物流、交辦與歷程；移除重複 NextStep Alert 和 action 教學。產品只顯示一列實收品項，不重複同值的實收名稱；信件／包裹仍顯示內容。
3. 收件、平板與人員／案件選擇器保留必要欄位。信件／包裹仍填寄件人／公司及內容，不顯示 SKU/SN；售後產品欄位不變。智慧搜尋、最近案件、分頁及舊請求取消均未修改。
4. 接收人無候選或資格失效時保留短狀態及 aria-describedby；平板仍驗員編、密碼、兩步驟驗證與實物確認。未把驗證碼錯稱為選填。
5. 寄出紀錄以欄位明列「寄出同步：待串接」；原事件回執另列「既有進度同步」。Source/AI dispatch consumer 仍未接通，不把舊 ACK、保存成功或 DISPATCHED 當成顧客通知、收件或結案。
6. 未保存、忙碌、照片缺漏、結果未知及 stale conflict 仍阻擋，取消／放棄的文字縮短。原寄出 body/requestId 持久保留與精確回執清除條件未變。

## 驗證

本批僅離線 synthetic fixture／只讀比對；不使用正式業務 API、不操作資料、不發通知，不接受實物或寄出。

| 項目 | 結果與證據 |
| --- | --- |
| 前端 app／node tsconfig | PASS，各用獨立 `/tmp/corely-mailroom-ui-cleanup-root-20261008/` build info。 |
| Vite production build | PASS，私有 cache／dist；保留既有大 chunk 與瀏覽器資料版本警示，未更新相依。 |
| Scope lint | 0 errors／4 warnings；三個 Page 與一個 SourceCasePicker 的既有 ref cleanup 警示，該 cleanup 內容未改。 |
| Actual Page DOM | 最後來源 PASS 1/1（46.8s），零 skip；受測 Page hash dd4d3168 與下表一致。保留照片、busy、strict checkbox、保管、取消草稿、跨 reload 原 body/key、stale 零 POST／新 key 及手機尺寸斷言。初版受測後只移除產品重複名稱列，因此僅重跑 Page，不重複累加测试數。 |
| Actual Recipient DOM | PASS 1/1（7.1s），零 skip；保留具體 user ID、部門非指派、外部 reset、資格變動不清 Form、disabled 與無 React 錯誤證據。Recipient 最後版與受測版同 hash。 |
| API／Form 靜態獨立複核 | PASS_SCOPE：production AST 的 API call arguments 與 Form name/valuePropName/rules/disabled/preserve/initialValues 一致；Page 14 calls、22 fields／2 Forms，Tablet 1 call、5 fields／1 Form；公司、raw confirmedItems、2FA、pending、actions／custody 未弱化。最後重複欄位的增量再查 PASS。此為靜態比對，不冒稱新後端測試。 |
| git diff --check | PASS；提交前再核對最終文件。 |
| Knowledge --check | FAIL：首先遇到刪除後仍被 catalog/source-manifest 引用的 MailroomNextStep.tsx，因 ENOENT 中止；不是此批發布 PASS。未 --write。由 DOA 更新下節後，按整合最後 SHA 重跑。 |

兩個 actual DOM fixture 皆使用既有 mkdtemp 獨立 Vite cache／HMR false，依序執行；外網封鎖。命令為 frontend cwd：`TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/<fixture>.test.mjs`。最終有效範圍為兩個 leaf tests 各 1/1，不把重跑累加。

實際 DOM 圖片使用新 `/tmp/corely-mailroom-ui-cleanup-20261008-{dispatch,mobile}.png`，保留原 d75 圖片。最新兩圖已目視（1123×972／390×1124），無抽屜水平溢出；手機 844px 高抽屜以下是較長的背景頁，紀錄須在抽屜內捲動。這些是離線測試畫面，不是 DEV 版本或營運驗收。

## Claw 交付 DOA 的精確變更

中央編輯者需從 `mailroom-workbench.sourcePaths` 刪除 `frontend/src/pages/mailroom/MailroomNextStep.tsx`，同步 generated／manifest；保留 `mailroom-workflow.ts`，清單仍使用它的下一步標題及守門。現有雙語各 14 steps／25 boundaries 已涵蓋移出的教學；不新增 AI write tool 或變更 grants。

- 中文 step 11：`從案件清單查看下一步與接收同仁，進入物件詳情使用可用動作。部門只是篩選，接收人必須是具體同仁；指派或技師認領後仍須本人核對身分及實物簽收，原保管人持有至簽收完成。通知送達與已讀另行追蹤。`
- 英文 step 11：`Read the next step and recipient in the item list, then use the available actions in item detail. A department is a filter; select a specific person. Assignment or technician claim still requires personal identity and physical acceptance. Custody stays with the current holder until acceptance; notification delivery and reading are tracked separately.`
- 中文 step 13 的畫面名稱改為「寄出紀錄」，說明「寄出同步：待串接」與「既有進度同步」分開；原 requestId／精確回執／相同內容重試規則保留。英文對應同改。
- 中文 boundary 16 開頭由「下一步提示」改「清單下一步、人員名單與部門篩選」；英文對應標明 item-list next step，保留每次寫入的權限與照片邊界。
- 可在上述教學中補充「確認簽收」「實物照片」「登記收件」「繼續編輯／放棄草稿」的新短標籤；真正的未接通、忙中或錯誤仍顯示於工作畫面。

五個修改來源的新 SHA-256（並有一個來源刪除）如下，中央仍須自行核對整合最後版後產生 manifest：

| 路徑（frontend/src/pages/mailroom/） | 此批 SHA-256 |
| --- | --- |
| MailroomPage.tsx | `dd4d316864527f1324cbf49ee5d306ce8297a2cac47a72731507fa81c00fc63b` |
| RecipientPicker.tsx | `ec4d7ceb7f831fa0e6b535028ff9f0f8753fe3dacbb04a2dfe5f75eb5ae2cd02` |
| SourceCasePicker.tsx | `7986be9ec5b50cea0aa7e14b2a40a9d773e9a11aaa0f72866a10af158b77d7fc` |
| TabletAcceptance.tsx | `080da05cb5c1b575f5c86a2f39639436597eba3ee2d3b086958cffe08b42456c` |
| mailroom.css | `28636075d1163ca07e2eb3254ffcb6188a1692be6bd2b6e0d68bae7145832f76` |
| MailroomNextStep.tsx | DELETED；原 hash `081f151d3dfbd94333d42a955e9af23caf052b155dfcf09557514d8d55c28855` |

## DEV 與交叉審查邊界

2026-10-08 台灣 06:34:14 只讀 metadata 確認：主 DEV API/web 仍 f3f14c410490-f，Ready、100%；`aftersales-review` 已是 264352c5b863-c，兩服務 Ready，digests 與 Cloud Build e992 的2643完整 SHA一致。上述兩版均不含此批 UI 整理。

使用者要看現況時，已將候選無 entityId 的收發入口開啟，由既有使用者正常登入；不擅自替 EASON 切 DOADEV 或改人員 mapping。既有主 DEV 的 EASON session 顯示承辦客服映射錯誤，待到貨未載入的 0 筆不能作為無案件證據。頁面畫面與 metadata 也不代替角色、現場簽收、Source/AI 或財務庫存端到端驗收。

提交後交 DOA／維修按完整 SHA 獨立接收審查；新修後新 SHA，不覆寫原批回執。DOA 中央合併、Claw、DEV 候選與流量；本視窗不自行部署，亦不把先前2643候選的 Ready／審查套到此批。
