CREATE TABLE wms_portal_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  station TEXT NOT NULL CHECK (station IN ('picker','packer')),
  nonce TEXT NOT NULL,
  password_version TEXT NOT NULL,
  session_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ticket_expires_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX wms_portal_sessions_user_idx ON wms_portal_sessions(user_id);
CREATE INDEX wms_portal_sessions_expiry_idx ON wms_portal_sessions(expires_at);

-- New role templates only: no existing employee is silently granted access.
INSERT INTO permissions (id,resource,action,description)
VALUES ('warehouse-expense-self-read','expense_self','read','查看自己的費用申請'),
       ('warehouse-expense-self-create','expense_self','create','建立自己的費用申請')
ON CONFLICT (resource,action) DO NOTHING;
INSERT INTO roles (id,code,name,description,hierarchy_level)
VALUES ('warehouse-picker','WAREHOUSE_PICKER','儲運揀貨員','揀貨作業與員工自助功能',3),
       ('warehouse-packer','WAREHOUSE_PACKER','儲運裝箱員','裝箱作業與員工自助功能',3),
       ('warehouse-operator','WAREHOUSE_OPERATOR','儲運作業員','可在工作台選擇揀貨或裝箱',3)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('WAREHOUSE_PICKER','WAREHOUSE_PACKER','WAREHOUSE_OPERATOR')
AND ((p.resource IN ('wms_tasks','attendance_self','leave_self','profile_self','expense_self') AND p.action='read')
  OR (p.resource='expense_self' AND p.action='create')
  OR (p.resource='wms_picking' AND p.action='execute' AND r.code IN ('WAREHOUSE_PICKER','WAREHOUSE_OPERATOR'))
  OR (p.resource='wms_packing' AND p.action='execute' AND r.code IN ('WAREHOUSE_PACKER','WAREHOUSE_OPERATOR')))
ON CONFLICT DO NOTHING;
