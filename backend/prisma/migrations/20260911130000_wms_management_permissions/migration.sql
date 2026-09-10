-- Catalog only. No memberships, user grants, brand scopes or business data are changed.
INSERT INTO "permissions" ("id","resource","action","description") VALUES
 ('6dab8701-0b09-4d60-8f8b-dfa0858c9211','wms_overview','read','查看公司品牌範圍內的揀貨裝箱總覽'),
 ('6dab8701-0b09-4d60-8f8b-dfa0858c9212','wms_logs','read','查看授權訂單操作日誌'),
 ('6dab8701-0b09-4d60-8f8b-dfa0858c9213','wms_exceptions','read','查看授權訂單例外，不含核可結案'),
 ('6dab8701-0b09-4d60-8f8b-dfa0858c9214','wms_scan_errors','read','查看授權訂單刷錯分析'),
 ('6dab8701-0b09-4d60-8f8b-dfa0858c9215','wms_defects','read','查看授權訂單新品不良紀錄')
ON CONFLICT ("resource","action") DO NOTHING;
