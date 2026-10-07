# DOA cleanup 私有 UI 驗收工具獨立核對（2026-10-08）

本輪只做離線 helper 核對，不代表 candidate／DEV UI 驗收。沒有登入、瀏覽器啟動、credential／實際 release state 讀取、網路、Cloud／DB 操作或真正 acceptance 寫入；沒有修改產品或 Source 程式。

## 原始固定版本與差異

| 工具 | SHA256 | 核對結果 |
| --- | --- | --- |
| `/private/tmp/corely-doa-cleanup-release-20261008/verify-dev-ui.mjs` | `ff27796792140afb88ef764376115cd272296803cf3500897f7460661159b6d2` | 與原 `/private/tmp/corely-doa-release-20261008/verify-dev-ui.mjs` 只有 `PRIVATE` 目錄 literal 差異 |
| `/private/tmp/corely-doa-cleanup-release-20261008/make-acceptance.py`（原 e5） | `e5da63956586e1b2eaafb8e2caba6b06173e88edb9646e254684c7d2dbc1ecb3` | 與原 release helper 只有 verifier hash literal 差異；缺口為既有邏輯，不是 cleanup 複製新引入 |
| 原 e5 唯讀備份 `/private/tmp/corely-doa-cleanup-release-20261008/make-acceptance.e5da639.original.py` | `e5da63956586e1b2eaafb8e2caba6b06173e88edb9646e254684c7d2dbc1ecb3` | mode 0400、exclusive 建立；保留原始實作，後續修正另記 |

## 已執行原版本驗證

```sh
node /private/tmp/corely-doa-cleanup-release-20261008/verify-dev-ui.mjs --selftest
python3 /private/tmp/corely-doa-cleanup-proof-review-20261008/review-acceptance.py
```

- UI verifier 自測：27/27 PASS，network calls 0、credentials read false、browser launched false。來源採 exact ff277 原程式的 `--selftest` 分支（410–446 行），沒有執行 `--run`。
- Composer：以真 e5 程式 body，注入完全記憶體的 `doa_release` 模組、私有 read/write/digest adapter；所有 subprocess/socket 呼叫禁止，歷史存在檢查亦為假 fixture。兩階段各有正例，並以原 5 個 scenario、唯一 83 check IDs 組成基準，再逐項修改負例。
- 原 e5 結果：41 情境，32 符合預期；2 正例接受，30 負例拒絕，9 負例被錯誤接受。runner exit 2 是已定位缺口，不是測試環境失敗；原 e5 的整體 acceptance conformance 為 **FAIL**。

兩階段的正例為 `final-web` 使用 candidate-web＋candidate-api，`promote-api` 使用 final-web＋canonical API；錯 URL／web revision／API revision、built SHA、build ID、stale completedAt 均拒絕。另 wrong phase、path／receipt name、schema、pending UI、verifier digest、Source commit／revision、clean source、role／check count、failed check、基本 network write／auth-only 安全標記與既有歷史接受檔亦拒絕。拒絕情境的記憶體寫入數為 0，真 acceptance 寫入數始終為 0。

## 原 e5 的 P2：接受證據語意尚未完整核對

1. `make-acceptance.py:21` 只核 role 數量／狀態及 check 數量／passed。保留 5／83 數量時，重複 wrong role key、錯誤 `QA7999`、`freshContext/login=false`、重複並缺少 check ID 都仍產生 acceptance。應核固定 scenario key＋employeeNo、登入與 fresh context、pageErrors，以及 exact 83 唯一 IDs。
2. `:16–17` 未比 `pins.erpSha`，只比 built SHA；也只要求 completedAt 在 phase 後。wrong erp SHA 或 startedAt 早於 phase 的負例仍接受。應核 erpSha＝builtSha＝state sourceSha，startedAt／completedAt 均在 phase 後並維持時間順序。
3. `:13、:22` 未驗固定 DOADEV entity、完整安全布林與 observed bundles。wrong entity、noSubmitControlsClicked=false、observed bundle checksum 不符仍接受。應核固定公司、每個 scenario 實際觀察 bundle 與可信 build manifest 的 path／hash／status，以及原安全旗標。

這些是私有 release 證據組合的完整性缺口，沒有證明正常 verifier 能登入錯誤帳號，亦不是產品授權或 backend gate 繞過。verifier 的程式 digest 只能識別工具版本，不能代替檢查 receipt 的 role、context、時間及 build 觀察內容。

## 原始重現材料

- Fixture script：`/private/tmp/corely-doa-cleanup-proof-review-20261008/review-acceptance.py`，SHA256 `05bf98df9947c334004e04ebd50e338a38080c448a9a93f0cb15df522060c15c`。
- 封存結果：`/private/tmp/corely-doa-cleanup-proof-review-20261008/acceptance-fixture-results.json`，SHA256 `a5997141d5e744c669ce37926162370402106ce0286604b2dde7116e9d6a8f15`，mode 0600。
- 9 個錯誤接受 ID：`duplicate-wrong-role`、`wrong-fixed-employee`、`role-not-fresh-login`、`wrong-company`、`wrong-erp-sha-pin`、`stale-started-at`、`duplicate-missing-check`、`no-submit-controls-false`、`wrong-observed-bundle`。

此原始 FAIL 證據保持不改。父代理已授權只修新的 cleanup composer，待修正版固定 hash 與父代理獨立核對後，再補記修正版離線結果。真正 UI、Source 表單及 Cloud metadata 驗收仍為 **未執行**。

## 已授權修正版：離線 PASS，待父代理最終審查

只修改新的 `/private/tmp/corely-doa-cleanup-release-20261008/make-acceptance.py`，固定 SHA256 為 `8bf6a522afbb44827076855bc26fafcbe4dbf87965c6b7901f613b89701a134e`。原 e5、原 FAIL JSON、舊 release private 目錄與歷史 acceptance 檔不改。中間 c604 版本亦另有 mode 0400 備份，最終版補強父代理指出的 reviewer 正常角色與財務授權。

修正內容：

- `APPROVED_ROLES` 固定五個 scenario key 與 QA employeeNo；freshContext／login 必須為真，pageErrors 為整數 0。技師需原 REPAIR_TECHNICIAN、收發需 MAILROOM_OPERATOR；reviewer 需 DOA_DEV_QA_REVIEW、admin=false 且 invoice／accounting=true。保留原 CSR company scope 與專用財務授權限制。
- `APPROVED_CHECK_IDS` 固定 83 個唯一 IDs，允許調換順序；其 sorted JSON SHA256 為 `4e6d482ec2aaab47448ac06dff643f7c8dc9256a5a018c94ea85c3deca30b77f`。已逐分支對照 approved ff277 的 check() 呼叫，並只讀既有實際 83 receipt 的 QA metadata／IDs 交叉一致。
- 起訖時間須滿足 `phase.observedAt <= startedAt <= completedAt`。保留 final-web candidate pair、promote-api final-web＋canonical API 的 exact URL／revision 核對，ERP source、built SHA 與 build ID 均須相同。
- 只以 AST 讀 operator 的三個 literal pins，不 import／execute operator。context 必須是批准的 cleanup context，state.manifestHash、operator literal 與 manifest bytes digest 必须相符，並呼叫原 `r.verify_context`。從可信 manifest.filesSha256 導出唯一 frontend 主 bundle 的 path/hash，再核五個 observed context 的 path/hash/status；不再只相信 CLI checksum。
- Source pins 固定 20f commit、module revision 與 build `cdc6dd0a-d2ad-42b4-bac9-022dc8f55f82`。CSR 1440 的八個 Source entries、六份原表單需有真 readiness／readOnly 旗標；保持原 defaultType 與 defaultsMatchEntry 的事實，不要求每張入口自動帶入新增類型。
- 核完整八個安全布林；外部 LINE／付款／發票／實物／庫存標記必須保留 NOT_VERIFIED，unit gate 必須保留 NOT_EXECUTED_BY_THIS_SCRIPT。說明 tool 身分不能提升為外部業務驗收。

修正版 fixture 共 **73/73 PASS**：final-web／promote-api 各一正例、順序可交換一正例，70 個負例全部拒絕，包含原 e5 九個錯誤接受及 reviewer admin／缺 invoice／缺 accounting／錯 roleCode、mailroom 錯 roleCode。每個拒絕情境的記憶體寫入數為 0；所有 fixture 的真 network、credential、release-state read 與 acceptance write 皆為 0。

目前 final operator pins 仍由父代理保管；本輪以假 operator literals、假 manifest 與假 `r.verify_context` 作離線測試，没有讀取真正 state／build context、沒有初始化 operator pins，也沒有執行修正版對真 UI receipt。父代理須先審查最終 helper，再於 build SUCCESS 與固定 pins 後執行實際流程。

可重跑命令：

```sh
node /private/tmp/corely-doa-cleanup-release-20261008/verify-dev-ui.mjs --selftest
# 下列原 e5 重現預期 exit 2，保留九個被錯誤接受的證據。
python3 /private/tmp/corely-doa-cleanup-proof-review-20261008/replay-original-acceptance.py
# 下列固定修正版離線測試預期 exit 0。
python3 /private/tmp/corely-doa-cleanup-proof-review-20261008/review-acceptance-final.py
```

| 修正版材料 | SHA256 |
| --- | --- |
| `review-acceptance-final.py` | `92747157ee5a059e16dedff4d2db2a7bdb34f35df37336195bd507a0bd2b3e55` |
| `acceptance-final-fixture-results.json`（mode 0600） | `515c4cfb9f948d0b64bbe06e0caad757d4647d808a72ae20aaba882b226797ca` |

以上 fixture 檔皆在 `/private/tmp/corely-doa-cleanup-proof-review-20261008`。原 e5 replay 結果與封存原 JSON 的 checksum 相同（`a5997141d5e744c669ce37926162370402106ce0286604b2dde7116e9d6a8f15`），原錯誤接受事實保持可重現；本輪結論是 **helper 離線修正 PASS，真 DEV UI／外部業務未驗收**。
