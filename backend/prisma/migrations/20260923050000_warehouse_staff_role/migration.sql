-- Stop for review if a station template was customized beyond the combined role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
    WHERE r.code IN ('WAREHOUSE_PICKER','WAREHOUSE_PACKER') AND NOT EXISTS (
      SELECT 1 FROM role_permissions target JOIN roles t ON t.id=target.role_id
      WHERE t.code='WAREHOUSE_OPERATOR' AND target.permission_id=rp.permission_id))
  THEN RAISE EXCEPTION 'Warehouse station roles have custom permissions; review before consolidation'; END IF;
END $$;
-- Keep the stable operator ID. Replace only the two former station templates.
UPDATE roles SET name='倉儲人員', description='進入工作台選擇揀貨或裝箱，並使用個人出勤、請假與費用申請' WHERE code='WAREHOUSE_OPERATOR';
INSERT INTO user_roles(user_id,role_id)
SELECT DISTINCT ur.user_id,target.id FROM user_roles ur JOIN roles old ON old.id=ur.role_id CROSS JOIN roles target
WHERE old.code IN ('WAREHOUSE_PICKER','WAREHOUSE_PACKER') AND target.code='WAREHOUSE_OPERATOR' ON CONFLICT DO NOTHING;
DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code IN ('WAREHOUSE_PICKER','WAREHOUSE_PACKER'));
DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE code IN ('WAREHOUSE_PICKER','WAREHOUSE_PACKER'));
DELETE FROM roles WHERE code IN ('WAREHOUSE_PICKER','WAREHOUSE_PACKER');
