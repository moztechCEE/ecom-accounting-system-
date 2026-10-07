# DOA DEV 發布 operator 唯讀審查（2026-10-08）

本輪結論：在下列固定版本及私有工具範圍內，未發現仍未關閉的 P1／P2。新版純記憶體 mock 共 32 項通過（6 正向、26 負向）；沒有執行 cloud、DB、init、外部 replace、migration 或部署。這不是 live snapshot／候選 UI／DEV traffic 的驗收。

## 固定範圍

- ERP checkout：`corely-erp-aftersales-20261005`；目前 clean HEAD `0c4eacb04511d00678f0b342871dbd1c886680ec`。
- 私有 [operator.py](/private/tmp/corely-doa-release-20261008/operator.py:1) SHA256：`f2f3a9f50e6a825b46b0ab92e165349a44c046bc90d9e55fb8b8338462ee8215`。
- 沿用 [doa_release.py](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/scripts/dev/doa_release.py:124>) 的固定 DEV guards、context／build metadata 驗證，以及 [b2b_release.py](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005/scripts/dev/b2b_release.py:142>) 的 portable／fingerprint／identity。
- schema 與 migration 相對 `f3f14c4104906cc6ca23bd1d38ba4589563b6801` 的 `git diff --name-only` 為空。工具仍在 init 強制檢查；本輪沒有執行任何 migration。
- 工具只產生本機計畫與觀察票、讀固定雲端 metadata，沒有部署命令。審查過程未讀 credentials，也未輸出 raw spec、env 或完整 state。

## 經核對的 guard

| 範圍 | 實際限制與來源 |
| --- | --- |
| ERP baseline／build | [init:46–66](/private/tmp/corely-doa-release-20261008/operator.py:46) 要求 clean source、完整 context hash、SUCCESS 的兩個固定 DEV image、符合受審 cloudbuild tags／steps、基線一致、現行 f3 100% 與已知 owned tags。不是從未知 latest template 認定 serving image。 |
| Source 主版本 | [Source pins:9–24](/private/tmp/corely-doa-release-20261008/operator.py:9) 各固定 20f-f／20f-s 的 100% active 配對、service／revision Ready 與 immutable digest。revision describe 僅允許這兩個確切名稱。可保留另一個 Ready 的 0% template，不把該 template 當已核准主版本。`sourceProof` 另存 init state。 |
| 九服務保護 | [snapshot/current:27–45](/private/tmp/corely-doa-release-20261008/operator.py:27) 含 ERP DEV2、Source DEV2、ERP 正式2、WMS2、正式 Source1。除本階段固定 ERP DEV target 外，逐項 identity 比較；Source／module／正式／WMS 均不是 plan target。ERP／Source DEV 要求 Ready，正式 Source 不額外強加 Ready。 |
| 五階段順序 | [PHASES:25](/private/tmp/corely-doa-release-20261008/operator.py:25) 固定 candidate-api → candidate-web → final-web → promote-api → promote-web。每個 plan 前重查 source/context 與九服務 identity。 |
| image／API 組合 | [plan:79–105](/private/tmp/corely-doa-release-20261008/operator.py:79) 候選 web 使用 candidate API，final web 使用 canonical stable API；只允許模板 revision、固定 immutable image、traffic 與 web `API_URL`／`WS_URL` 的必要變更。其他 env（含 secret refs）、SA、resources 與配置比較相等。 |
| 原主流量與 tags | [traffic:85–107](/private/tmp/corely-doa-release-20261008/operator.py:85) 候選階段只重指自家 review／final tag 到 0%，原 100% 主流量保留；所有無關 tags 保留，包括 Copilot 0% candidate。0% Copilot 不被視為 approved main。 |
| promotion 驗收 | [acceptance:71–78](/private/tmp/corely-doa-release-20261008/operator.py:71) 兩次 promotion 均要求同 source SHA／build／兩 image／三 candidate revisions、五個明確 true checks，以及 `validatedAt` 不早於最近階段觀察時間。web promotion 因而不能沿用 API promotion 前的票。 |
| 外部 replace 的 CAS | [plan／verify-replace:108–117](/private/tmp/corely-doa-release-20261008/operator.py:108) plan 綁完整 spec bytes hash、state hash、原 resourceVersion。外部 CLI 前再次核對 bytes、RV、source/context／九服務快照與最新 RV。portable fingerprint 本身不保留 RV，現以獨立欄位補足。 |
| 寫入後觀察 | [record:118–131](/private/tmp/corely-doa-release-20261008/operator.py:118) 重核 plan bytes／RV；非 target identity 不變；target UID／config／active traffic／Ready 與 latestReady==latestCreated；固定期望 revision 的 Ready、immutable image 一致才記錄 completed。 |

## 先前缺口與目前結果

先前 promotion-web 未強制最近階段之後的驗收、以及 portable hash 無法發現 spec 的 resourceVersion 遭移除／修改，已由父代理修補。正式 Source 也已納入第九個固定保護服務；Source 兩個 serving revisions 增加獨立精確 digest 證据。

32 項離線檢查使用合成 metadata 與記憶體檔案，未呼叫網路、DB 或寫入檔案：

- 正向 6：Source init pins 成功，以及五階段 plan → verify-replace → 模擬 observed metadata → record。
- 負向 5：錯 Source active、錯 digest、service 不 Ready、revision 不 Ready、非 allowlist revision read；皆拒絕。
- 負向 6：API／web promotion 各測 missing timestamp、舊 timestamp、錯 candidate revisions；皆拒絕。
- 負向 15：五階段各測移除 spec RV、修改 spec bytes、replace 前 live RV 改變；皆拒絕。
- 同時核對九服務邊界、Copilot 無關 tag、原主 100%、candidate／final API transport 配對。

## 實際發布仍需的證據

父代理必須在外部 CLI 前依序使用 plan → verify-replace → 外部 replace → record，保留 emitted resourceVersion；出現未知結果或 concurrency 差異就停止重新核對。init 與各階段仍須實際最新 cloud metadata／revision／image／build 證據，本輪 mock 不提供這些證據。

`acceptance.json` 的 checks 是父代理提供的受審驗收票；operator 不會自己執行 UI／登入／回歸測試，也不驗證其所有 underlying 子票。因此實際 authentication、permission、Source read、UI、regression 必須由另外的真實驗收產生。promote-api 完成後，promote-web 前須再取得 final web 使用已升級 stable API 的新驗收票。

目前審查結論只適用上述 operator hash；後續工具或 runtime 變更須重新核對。正式服務／WMS／Source 的 unchanged 與 Copilot 保留，仍以父代理本次 fresh snapshot 及逐階段 record 的真實結果為準。
