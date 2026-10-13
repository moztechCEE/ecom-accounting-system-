# 儲運工作台原生整合候選

## 操作結果

ERP 的儲運工作台直接開啟通路訂單轉檔、預揀與倉庫放行、揀貨、裝箱及例外。操作保留 ERP 側欄、登入者與公司，完整作業頁使用同一套 WMS 元件及既有服務。首頁保留揀貨、裝箱主要操作，移除重複教學段落。

商城轉檔、ECOUNT 銷貨下載、理貨回匯核對、預揀總表和逐筆明細列印、掃碼與任務移交仍由原 WMS 實作處理。銷貨金額、條碼審查、SN、箱號、請求 UUID、版本及唯一銷庫邊界沒有改寫。ECOUNT 本身的匯入仍由人員執行；介面整合不等於已完成 ECOUNT 或實物驗收。

## 固定基底與所有權

- ERP：`d3b7ed2c654de1605b6051db75c74789b3a1c068`，隔離分支 `codex/warehouse-native-workspace-20261013`。
- WMS：`995ec5b3fa195d6f12e582e964347a353dea9d66`，配對分支 `codex/wms-native-workspace-20261013`。
- 本批不修改 Prisma/schema/migration、App 的共同路由、navigation.ts、workspaces.ts 或正式服務。
- ERP 共用 DEV 發布由 DOA 整合視窗持有；需與其正在修改的 `main.ts`、DEV sandbox、知識目錄逐段核對並重新生成最後整合版本的來源 hashes。

## 模組與身份

WMS 發布 public `workspace-manifest.json`、含 source SHA 的 ESM entry、Shadow CSS 及 scoped portal CSS。ERP 僅從設定的精確配對 WMS 來源載入同一份 manifest，核對 full SHA 並在 ERP 內建立獨立 React root。WMS 既有 BrowserRouter 在原生模式使用 MemoryRouter；原有 sidebar/header/logout 不重複出現。

ERP `/wms/native/session` 沿用既有 ticket/exchange，服務端驗證使用者、公司與來源 session。每個 `/wms/native/proxy/*` 命令仍核對當前 ERP JWT、WMS本人身份和公司，再由 WMS 執行原始方法、body、query 和業務授權。不重送失敗或結果未明的命令。切換人員、公司、入口、登出或離開頁面會取消舊請求並釋放模組。

下載 cookie 只存在服務端：`/wms/native/files/:id/:kind` 完成既有 scoped-cookie 流程，再回傳檔案 bytes 和 filename；JavaScript 及 URL 不收到該 cookie/ticket。ERP bearer 不回傳給 WMS 下載 response/error 的 config。一般 WMS逾時停在目前 ERP 作業頁，重新連線只建立身份，不重送業務動作。

## 配對 DEV 發布條件

1. 發布前重查 ERP API/web、WMS DEV 與正式服務目前 revision、traffic、source/digest，保留完整私有 runtime baseline。先與 DOA 發布者核對目前整合版本，不能以此舊基底覆寫正在完成的售後/收發/維修工作。
2. WMS packager 必須由乾淨固定 commit 執行 `node tools/release/prepare-build.cjs <new-absolute-output> dev`。Cloud Build 的 `VITE_SOURCE_COMMIT` 必須等於打包 commit； manifest 和 SDK exports 必須配對。
3. WMS Socket.IO 必須保留原 CORS_ORIGINS 並加入自己的 canonical DEV origin `https://corely-wms-dev-sp5g377smq-de.a.run.app`，以便原生與 standalone 精確 origin 檢查均可連線。ERP_PORTAL_ORIGIN 仍為既有精確 ERP DEV URL；SSO/server session 驗證不變。
4. ERP API 以 `WMS_NATIVE_ENABLED=true` 啟用 gated adapter 與 DEV sandbox egress；保留既有配對 WMS_PORTAL_SERVICE_URL、SSO與 entity `tw-entity-001`。前端使用既有 WMS_PORTAL_URL，不新增公開密鑰。
5. 先候選、再以已授權真實角色做登入與唯讀 UI 驗證；確認 manifest CORS、工作台各入口、公司不切換、列印預览/國條、核對與權限限制、401重新連線。實際出貨/銷庫/商城或ECOUNT寫入需另有本次驗收授權與可刪除測試單，不能以本機合成測試宣稱完成。
6. WMS 版本更新時，舊頁可能需要重新连線以取得新 hashed lazy chunks。原生「重新載入」會重新讀取 manifest，不重試業務命令。
7. 整體回滾使用發布前 ERP API/web 與 WMS revision；先回滾 ERP 前端，再處理 adapter flag/API與 WMS 配對版本，保留原有登入、資料與去重紀錄。

## 驗證與未驗收邊界

本機 ERP backend 126 suites／1702 tests 通過；原生 HTTP、DEV sandbox、權限及 bridge 正反檢查通過。ERP 前端 TypeScript/Vite build、原生 transport／navigation、4項瀏覽器場景（身份、公司、路由、逾時）通過；知識覆蓋79篇雙語、103 routes、251 sources通過。WMS 配對 SDK 的實際瀏覽器、列印及完整 suite 結果以配對提交回執為準。

Host DOM 測試的 module façade 與 SDK 瀏覽器資料皆是本機合成資料，沒有連線真實訂單或執行實際庫存異動。截圖只證明各自的本機介面／生命周期。候選尚未代表共用 DEV 主流量、ECOUNT 匯入、實物掃描、印表機或完整營運驗收。

新增前端測試：`node --import jiti/register --test tests/warehouse-native.test.ts tests/wms-portal.test.ts`；DOM：設定 `WAREHOUSE_PLAYWRIGHT_MODULE` 指向可用 Playwright，再執行 `node --test tests/warehouse-native-dom.test.mjs`。在 CI獨立 dependencies 安裝後執行正常 backend build/tests 與 frontend build；不在共用 node_modules 執行 generate/install。
