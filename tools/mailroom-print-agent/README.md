# Corely 收發室 Mac 列印代理（DEV）

此代理供已核定的 `Xprinter_XP-235B` USB 佇列使用。工作台建立標籤工作後，Mac 每 3 秒主動向固定 DEV API 領取工作，將 50 × 30 mm PDF 交給既有 CUPS 驅動。它不開 localhost listener，也不使用 raw、TSPL 或瀏覽器列印視窗。

目前交付為本機程式與合成測試。尚未註冊裝置、配對、安裝或啟動 LaunchAgent，也未呼叫真實列印。正式整合與實體紙張／掃碼驗收另行確認。

## 一次設定

需要 macOS、Node.js 20 以上、Xcode Command Line Tools，以及已驗收的官方驅動與 `Xprinter_XP-235B` USB 佇列。請使用日常登入帳號操作，不使用 `sudo`。

1. 在收發室 DEV 的「印表機」中按「新增配對」，取得裝置 UUID 與五分鐘內有效的一次性配對碼。此操作會寫入 DEV，應在核定的設定時段進行。
2. 在此目錄執行 `node install.mjs --device <裝置UUID>`。安裝程式只準備檔案與 LaunchAgent plist；不啟動代理、不配對、不列印。它保留既有工作紀錄，不重設未知結果。
3. 執行 `node pair.mjs --device <裝置UUID>`，在隱藏輸入提示貼上配對碼。不要把配對碼或 token 放進命令參數、環境變數或檔案。配對程式只顯示成功或簡短錯誤，不顯示 token；收到的 token 直接交給 Keychain helper 的 stdin。
4. 確認配對成功後，依維運核准載入使用者 LaunchAgent：

   ```sh
   launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/cc.corely.mailroom-print-agent.dev.plist"
   ```

停止代理：

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/cc.corely.mailroom-print-agent.dev.plist"
```

`install.mjs` 複製唯讀版本檔案並編譯原生 helper。`pair.mjs` 在安裝後也可從相同 checkout 執行；它只讀固定 Application Support 設定，找到已安裝 helper。版本資料夾為唯讀，啟動時核對所有來源檔與 helper 的 SHA-256。上述安裝、配對及啟動命令沒有在本次開發中執行。

## 固定範圍

- API：`https://corely-erp-api-dev-sp5g377smq-de.a.run.app/api/v1`。沒有 origin／網址環境變數或 CLI 覆寫；拒絕 redirect。
- API headers：`x-corely-print-device: <UUID>`、`Authorization: Bearer <token>`。token 只保存在登入者 Keychain，執行時經私有 FD 3 pipe 讀入記憶體，不寫 stdout、設定或日誌。
- 設定與紀錄：`~/Library/Application Support/Corely/Mailroom Print Agent/`，目錄 `0700`，設定、journal、PDF 與日誌 `0600`。執行程式碼 `0400`、helper 與版本資料夾 `0500`。
- `journal.json` 僅存工作識別、manifest、提交結果及 ACK 狀態，不存 token、姓名、電話或標籤文字。暫存 PDF 含標籤資料，收到終態 ACK 後刪除。
- 主 journal 達 1 MiB 或 1000 筆時，在領取新工作前將較舊的**已 ACK、已清除 PDF 的 SUBMITTED／FAILED**完整原紀錄原子封存至私有 `archive/<工作UUID>.json`，保留最近 200 筆。archive 檔案與目錄仍為 `0600`／`0700`，不自動刪除。先 fsync archive，再原子移出主 journal；兩邊同時存在可安全復原，任一保存失敗都不接受下一件列印。
- `Journal.get(id)` 同時查主 journal 與 archive，舊工作被重領仍是終態，不再送印。UNKNOWN、未 ACK 或只取得不同伺服器終態證明的紀錄不會自動移走。主 journal 的 8 MiB 保護上限仍適用未解決紀錄，達限應保留現況交維運查核，不能刪除或重建 ledger。
- 單一程序鎖由 helper 的 `flock` 持有，直到父程序 stdin pipe EOF；程序中止自動釋放，沒有刪除 stale PID lock 的競態。
- 只執行固定 `/usr/bin/lpstat` 與 `/usr/bin/lp`，均不經 shell。送印參數固定為一份、`Custom.50x30mm`、`203dpi`、`Rotation180`、不鏡像、不負片、portrait。文件路徑只能是私有 spool 中的工作 UUID PDF。

## 工作與結果

工作 manifest 必須符合裝置、profile、UUID、固定 document path、SHA-256、精確 bytes、有效期限及 1–50 頁。下載上限與伺服器相同為 2 MiB（低於 10 MiB 絕對上限）。PDF 必須是此版 PDFKit profile 的 classic xref、逐頁 50 × 30 mm 結構；拒絕加密、object stream、動作、附件與外部 URI。

本機順序：`DOWNLOADED → SUBMITTING → SUBMITTED / UNKNOWN`。未呼叫 `lp` 的確認失敗記為 `FAILED`。每次 journal 更動以暫存檔、file fsync、atomic rename、parent-directory fsync 保存。

`SUBMITTING` 必須先持久保存，再取得伺服器的同狀態 ACK，才允許一次 `lp`。無論逾時、非零退出或沒有精確 CUPS 工作 ID，只要呼叫結果不明就保留 `UNKNOWN`。重啟遇到 `SUBMITTING` 也轉為 `UNKNOWN`，不重送文件。已知 CUPS ID 先保存 `SUBMITTED`，再送回執；ACK 遺失只重送同一份回執。即使伺服器沒有新工作，也會先補送未 ACK 的終態紀錄。

`SUBMITTED` 僅代表 CUPS 已接受工作，沒有宣稱紙張已印出或實體掃碼成功。未知結果應由操作人員查核既有工作；需要重印時，必須在工作台明確建立新工作。不得刪除 journal、修改工作 UUID、清空紀錄或自動重送來「修復」未知結果。

若伺服器在回執抵達前已將同一工作結束（例如到期），只接受既有回執介面的具型別 `409 PRINT_RECEIPT_TERMINAL_CONFLICT` 證明。代理核對工作、裝置、頁數、期限、終態與 CUPS／錯誤欄位，把 `serverReceipt` 與 `receiptReconciled` 另外持久保存；本機原始狀態與原因不變，`acknowledged` 仍為 false。保存與 fsync 成功後才繼續領取其他工作。錯誤裝置、非終態或不完整證明不會解除阻塞，也不會重印。

遇到 401／403、journal 遺失／毀損、權限不符或程式完整性不符時，代理停止。LaunchAgent 不會自動重新啟動失敗程序。配對回應遺失或 Keychain 寫入失敗也不自動重試一次性兌換；請由管理者撤銷該裝置後重新設定。

固定 API 的 429 與 5xx 屬暫時不可用；一般領取錯誤會以 6、12、24、最多 30 秒退避，成功後恢復每 3 秒。回執失敗仍只補送回執；提交前 ACK 不明仍記 UNKNOWN，不再送印。只有固定文件 GET 的 404／410 會視為未提交前的文件逾期／不可用，記 FAILED，再以同工作終態證明核對。

## 30 天憑證到期與裝置更換

裝置 token 有效期為 30 天；到期回 401，代理停止。不要刪除 `journal.json`、重新使用舊 UUID 或直接清空 Application Support 後再配對。

1. 先停止 LaunchAgent，在 DEV 裝置清單撤銷舊裝置，確認舊裝置已撤銷，且舊代理沒有執行。
2. 逐一保留並核對原工作與本機 `SUBMITTING`／`UNKNOWN`／未 ACK 結果。未知結果仍屬原工作；不得因換裝置就自動重印，也不能把舊工作重新領給新裝置。
3. 由維運在核定時段把**整個**私有 `Mailroom Print Agent` 資料夾原樣改名封存，例如 `Mailroom Print Agent.archive-<舊deviceUUID>-<時間>`，保留 journal、設定、PDF、版本檔與原權限。這是完整封存，不是刪除或重設 ledger；保留舊 Keychain 帳號，伺服器已撤銷其能力。若 journal 缺失或毀損，先保存現況交維運查核，不自行生成空 ledger。
4. 在 DEV 建立**新的裝置 UUID**，依一次設定流程準備新資料夾與獨立 journal，再以新的五分鐘配對碼配對。安裝程式會拒絕把新 UUID 寫進舊裝置的既有設定，不會替你覆寫舊紀錄。
5. 新代理只處理新裝置的新工作。舊 UNKNOWN 與封存紀錄持續保留；如查核後需要補印，操作人員必須在工作台明確建立可追溯原工作的重印。封存／換裝置步驟沒有在本次開發中執行。

## 本機驗證

```sh
node --test *.test.mjs
```

測試使用記憶體 HTTPS、Keychain、`lp`／`lpstat` mock 與每案獨立暫存資料夾，不連 ERP、不執行 Keychain 或 CUPS。原生 helper 可單獨以 `clang -fobjc-arc -Wall -Wextra -Werror -framework Foundation -framework Security keychain-helper.m -o /tmp/corely-keychain-helper-check` 編譯；編譯不執行 helper。

仍需在核定 DEV 環境完成裝置註冊／撤銷、登入 Keychain 可用性、LaunchAgent 登入啟動、真實 USB queue／官方驅動、50 × 30 mm 紙張方向及完整網址 QR 實體掃碼驗收。
