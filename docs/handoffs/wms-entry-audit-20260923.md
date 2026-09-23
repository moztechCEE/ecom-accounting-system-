# WMS 全入口登入與日誌整合

基底 ERP c3c29e25 已包含 fc82e903 SSO/2FA 和另一視窗的權限費用修改。WMS 基底 1ee777e。獨立 worktrees，不修改他人未提交檔案。

改動：所有入口經 nonce 單次票證，伺服器固定目的頁面與最小角色；WMS 增加唯讀 viewer、ERP-only 開關、簡化返回入口和使用者控制側欄；日誌移除資料廣播、新資料庫操作者快照。具體中央日誌方案見 docs/plans/company-operation-audit.md。

本文件初版時尚未部署；部署版本、測試、migration、回滾與未驗收事項於驗收後補記。不可視為全公司日誌收集已完成。
