# SN 批次退回覆核

Base: ERP DEV Web `9224bad3df81e87b26cf3e578fe67ec57d559229`; the SN module and its prior migration match the serving API source `f95790b73b7407cba9923ee6e86e64fab9506627`.

- 庫存編輯人員可對整個已啟用批次送出理由；同日追加的所有原始草稿都在範圍內。申請期間暫停追加及檔案輸出。另一位同公司範圍的管理員可覆核；系統拒絕自審。
- ECOUNT 進貨單是收貨依據。現有程式沒有以標籤批次或箱號核對 ECOUNT 進貨的自動介面；覆核人需要人工查證，留下公司、查詢倉庫、採購來源單號、品號、批次對照、查詢結果紀錄、範圍、核對時間與實際收貨數量。空白、資料不足或範圍不完整不代表零；零收貨需涵蓋所有關聯採購、倉庫及截至覆核日的紀錄。查證後到核准前須維持倉儲的收貨及使用暫停。
- 部分或全部收貨只要有對應進貨單，整批禁止退回。已使用的 WMS 紀錄、實物使用紀錄，或 ERP 中相同公司、商品、完整 SN 的庫存記錄，也禁止退回。缺少 ERP SN 資料不能證明未收貨。WMS 草稿、封箱、下載及列印分別處理；它們不代表 ECOUNT 進貨。若有匯入後尚未確認且未使用的草稿，倉儲管理員可在 WMS 箱號明細作廢草稿箱並填寫原因，再將作廢紀錄列入覆核證據。已發出的貼紙、下載或匯出檔案須核對未使用；需要時收回或作廢，再留下處理紀錄。本功能不會撤銷 WMS 或 ECOUNT 記錄。
- 核准時保留原批次、標籤、箱號、SN、原始草稿和覆核證據，將舊批次列為已退回，再按原始草稿逐份建立可編輯的新草稿。後續重新啟用沿用正常配號，任何計數器都不倒退。不同請求與批次版本受同一資料庫鎖保護，並在輸出前最後檢查狀態；已核准、駁回或攔下的覆核結果無一般修改路徑。

The migration is additive except for replacing unconditional active merge-key uniqueness with a unique index limited to non-retired batches. Database guards also block legacy tagged revisions from recording exports or appending to a pending/retired batch. It adds no inventory, purchasing, ECOUNT, WMS or external-effect write. Apply only the reviewed migration before routing matching API/Web candidates. Rolling back application code alone after any retirement is unsafe because old code lacks the retirement list/filter; retain a compatible build or design a reviewed forward fix. No cloud deployment or live business data is used by the tests.

Reproduce evidence validation with `cd backend && npm test -- --runInBand sn-label-batch-review`. To exercise the real migration and service SQL on a disposable database, build the backend and run `SN_BATCH_REVIEW_PGLITE=/absolute/path/to/@electric-sql/pglite node --test test/sn-batch-review-pglite.test.cjs` from `backend`. The PGlite fixture verifies SQL and transaction rollback on one process; it does not establish two real scanners, multi-connection production concurrency or ECOUNT business acceptance.
