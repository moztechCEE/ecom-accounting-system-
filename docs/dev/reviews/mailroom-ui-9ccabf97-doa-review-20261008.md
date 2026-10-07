# Mailroom UI 9ccabf97：DOA 獨立審查

結論：**production interface PASS_SCOPE，未見本批新增 P1／P2；作者原 Recipient DOM fixture 尚有實際 FAIL，不得宣稱兩個原 suite 全 PASS。** 新的 EASON mixed-read／unknown-empty P2 修正仍待作者後續 SHA，9cc 不包含該修復。既有 264 DEV promotion HELD 與各歷史收據保留，本輪不變更其狀態。

## 固定版本與範圍

- Repo `https://github.com/moztechCEE/ecom-accounting-system-.git`。
- named fetch 與 `git ls-remote --heads origin codex/mailroom-ui-cleanup-20261008` 均核對完整 SHA **`9ccabf973e9ee6ee41eb38a289dab371decc893a`**。
- base **`264352c5b863d9928a36ab2a9dbecc697f35a028`**。
- 全新 detached worktree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-ui-review-20261008`；開始／結束 clean，HEAD 未變。parent 264 checkout 未編輯。
- 已讀 `AGENTS.md`、`docs/dev/mailroom-ui-cleanup-handoff-20261008.md`、6 runtime 路徑差異及受影響 DOM fixture。
- 9 個 diff paths：5 runtime 修改、刪除 `MailroomNextStep.tsx`、2 test selectors／圖片路徑調整、1 handoff。沒有 backend、API client、model、guard／pending helper、導航、schema、migration 或 grants 差異。

## Production 對照

主要變動為縮短文案、刪除重複流程帶與教學；detail 保留唯一操作列，`MailroomNextStep` 的重複按鍵刪除後，既有 action list 仍在 `MailroomPage.tsx:1340`；清單下一步仍在同檔 508。收件／信件、SKU／SN、照片、分級、指定實際同仁、來源搜尋／最近／分頁均保留。

本人用 TypeScript AST 比對固定 base／9cc：直接 `api`／`tabletApi` calls 的完整 arguments，以及 Form 的 name／rules／valuePropName／disabled／preserve／initialValues、Button／Select／RecipientPicker／Upload／Checkbox 的 disabled／onClick／onChange／onSearch 完全一致。Page 2 Forms／22 fields、Tablet 1 Form／5 fields。獨立靜態交叉審查亦核對權限、照片、pending、handlers 沒有弱化。

- `MailroomPage.tsx:141` 的 route／close discard gate 仍判斷 dirty／busy；文案改「繼續編輯／放棄草稿」，未改取消／放棄行為。
- `MailroomPage.tsx:887` 的 session pending restore 保留 company＋actor＋item 範圍、原 body／requestId；未知或版本不符不自動再送。
- `MailroomPage.tsx:1069` 的 busy／pendingConflict 及照片守門保留；`1379` 的原请求／人工核對警告、`1692` error、`1696` disabled 儲存仍可見。
- 目前 holder／location 仍使用 current-custody helper（1156、1219）；歷史 IN 欄標為「原退貨入庫紀錄」，不當作目前持有。
- `1239–1244`「寄出紀錄／寄出同步：待串接」與 `1708`「既有進度同步」分開。保存寄出／舊 ACK 不宣稱 Source dispatch consumer、AI 客服、顧客已收件或結案成功。
- Tablet 員編、本人密碼、2FA、嚴格 `confirmedItems===true`、存放位置及 error Alert 均保留。Recipient 具體 userId／部門篩選、資格失效／空名單 disabled 與 aria hint 保留。

## 本人實跑：原 fixture 與診斷分開

全部只使用本機合成 React／Ant Form／MemoryRouter＋Vite middleware；隨機 localhost port、非 127.0.0.1 網路全部 abort。沒有正式或 DEV API 業務呼叫。dependency 僅 symlink parent ignored node_modules，沒有安裝／改 lock。

| 驗證 | 實際結果 |
| --- | --- |
| 原 `mailroom-workbench-dom.test.mjs` | **PASS 1／1，19,814.693ms；0 skip**。含信件欄位、精確同仁、照片必填、取消保留欄位／照片、route／換件／Back、busy recipient、實收不符、技師交回本人簽收、寄出 checkbox、unknown session reload 原 body/key、lost response 後 exact receipt、stale 零 POST、390px drawer bounds。 |
| 原 `mailroom-recipient-dom.test.mjs` | **FAIL 0／1，14,155.665ms；0 skip**。line 123 的 synthetic `#external-person.click()` 被仍開啟的 Ant Select dropdown `Repair · 同名同仁 · R10` 攔截，Timeout 8000ms；尚未走到後續 external reset／資格斷言。不是接收值斷言失敗。原 FAIL log 永久保留。 |
| 私有副本 `recipient-normal-escape-diagnostic.test.mjs` | **DELTA_SCOPE PASS 1／1，10,543.076ms；0 skip**。同一固定9cc產品 imports、所有原 assertions 保留；僅調整私有 fixture root／require 位置，以及兩個 synthetic external-state 按鈕（external-person／external-repair）前正常 Escape 收起 popup。不 force 產品按鍵、不刪斷言。external reset、等效列表保留搜尋、資格改變不清 Form、空名單 disabled 均完成。不能用此票改標原作者 suite PASS。 |
| `git diff --check`／執行後 source＋test hashes | PASS／7 個受測檔完全未變。 |
| build／lint／不變 pure 或 backend tests | 本輪未重跑，不引用作者執行結果作本人 PASS。 |

原 runner（frontend cwd）：`TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --import /private/tmp/mailroom-9cc-review-apoidgyg/screenshots.mjs --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/<fixture>.test.mjs`。

preload 僅把 screenshot output 改到唯一私有目錄，沒有改 fixture assertions、API mock、產品或 click 行為。作者／d75 圖片沒有覆寫。本人已目視新 desktop dispatch 與 mobile 畫面：教學區減少，carrier holding／物流單號／寄出同步仍可辨認；手機抽屜無水平溢出，較下方紀錄需在抽屜內捲動。這是合成離線圖，不是 DEV UI／現場簽收證據。

## 不可跳過的待項

1. 請作者下一個固定 commit 修正 Recipient synthetic 外部按鈕前的 popup 關閉，重跑原 fixture；本次 FAIL 與 private DELTA_SCOPE PASS 均保留，不覆寫。
2. 既有 EASON mixed-read／unknown-empty P2 等作者新 SHA，再按該差異獨立審查。本輪沒登入 EASON、没實查其公司 mapping，不能當作已解決。
3. 本人只讀 source-manifest 比對為 **5 個現存來源 hash drift＋1 個刪除來源仍被引用**（Page、Recipient、SourceCasePicker、Tablet、CSS；deleted NextStep）。catalog.source／generated／manifest 仍引用 NextStep；因此 knowledge 必須由中央整合後刷新／check，不能宣稱 PASS。本輪沒有 generator `--write` 或 `--check`。
4. 此批尚未整合／部署，264 candidate Ready／83合成角色 UI 票不可移套到9cc。真實接收、權限、Source/AI dispatch、LINE、金融、庫存與通知到達皆未營運驗收。

## Source hashes 與私有證據

| `frontend/src/pages/mailroom/` | 實際 SHA256 |
| --- | --- |
| MailroomPage.tsx | `dd4d316864527f1324cbf49ee5d306ce8297a2cac47a72731507fa81c00fc63b` |
| RecipientPicker.tsx | `ec4d7ceb7f831fa0e6b535028ff9f0f8753fe3dacbb04a2dfe5f75eb5ae2cd02` |
| SourceCasePicker.tsx | `7986be9ec5b50cea0aa7e14b2a40a9d773e9a11aaa0f72866a10af158b77d7fc` |
| TabletAcceptance.tsx | `080da05cb5c1b575f5c86a2f39639436597eba3ee2d3b086958cffe08b42456c` |
| mailroom.css | `28636075d1163ca07e2eb3254ffcb6188a1692be6bd2b6e0d68bae7145832f76` |
| MailroomNextStep.tsx | DELETED；base `081f151d3dfbd94333d42a955e9af23caf052b155dfcf09557514d8d55c28855` |

私有目錄 `/private/tmp/mailroom-9cc-review-apoidgyg`（0700）：

- 原 Page log `page.tap.log`：`586aadb01f4f2aefdced24f73b8cb5e150b79d4246e4871e2a3d099970ae289f`。
- 原 Recipient FAIL `recipient.tap.log`：`f3f65e0b49ddbc296693a5b8074669e525e798cef2727bd27b7ff79029edb708`。
- Private delta fixture：`024650035a0add060d1c2ea9333515b185914cfe58256502aaaebefe4629b728`；PASS log `77119b830dd5dccf6abbaf153ece071d1450f97b86cdf205b82f784519e14350`。
- 本人 AST 對照 `api-form-control-ast.json`：`4475da9606ac3beb81b7c0ef41f3abfaea10d81321367957afdcc996e34dd940`。
- desktop `corely-mailroom-ui-cleanup-20261008-dispatch.png`：`bf06613dbca58bdf02214b61dd3682b7be8db559b9d1ecfae473eff1a76451fc`。
- mobile `corely-mailroom-ui-cleanup-20261008-mobile.png`：`51607d2ba9ffcb5dc91256cce95f5ee5350e208c0f3e3a6a897ca50e66a30489`。

本輪只新增此 coordinator 報告及私有離線證據；產品／作者測試／中央知識／root state／部署／DB／真實通知／庫存完全未修改，沒有提交或推送。
