-- Catalog only: no user roles, memberships, scopes or business records are changed.
-- Apply separately after review; never infer WMS access from inventory:read.
INSERT INTO "permissions" ("id", "resource", "action", "description") VALUES
 ('28a52d0d-a0e8-42e1-a9b8-79d204c793f1', 'wms_tasks', 'read', '查看授權範圍的儲運任務'),
 ('a218802a-2012-4726-bb76-1714e60c2717', 'wms_orders', 'create', '建立與調度出貨訂單'),
 ('ed2983f7-0cc9-4d2e-8e1e-f635f410c6cf', 'wms_picking', 'execute', '認領與操作授權的揀貨任務'),
 ('1c59379d-07f7-4a7d-9eb0-bad24c238205', 'wms_packing', 'execute', '認領與操作授權的裝箱核對'),
 ('e29254c6-b78a-4d7c-aedb-a8925a19cacb', 'wms_shipping', 'execute', '操作授權的出貨交接')
ON CONFLICT ("resource", "action") DO NOTHING;
