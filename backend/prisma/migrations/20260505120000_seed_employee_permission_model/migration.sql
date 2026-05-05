INSERT INTO "permissions" ("resource", "action", "description")
VALUES
  ('access_control', 'read', '查看帳號與權限管理'),
  ('access_control', 'update', '維護帳號、角色與權限設定'),
  ('purchase_orders', 'read', '查看採購訂單'),
  ('purchase_orders', 'create', '建立採購訂單'),
  ('inventory', 'read', '查看庫存與產品'),
  ('inventory', 'update', '維護庫存與產品'),
  ('banking', 'read', '查看銀行與對帳資料'),
  ('banking', 'update', '執行銀行與對帳作業'),
  ('reports', 'read', '查看報表中心'),
  ('attendance_self', 'read', '查看自己的打卡與出勤'),
  ('leave_self', 'read', '查看與申請自己的請假'),
  ('payroll_self', 'read', '查看自己的薪資單'),
  ('payroll_self_breakdown', 'read', '查看自己的薪資明細與計算方式'),
  ('profile_self', 'read', '查看自己的個人資料'),
  ('employees_admin', 'read', '查看員工與部門資料'),
  ('employees_admin', 'update', '維護員工與部門資料'),
  ('attendance_admin', 'read', '查看考勤後臺審核資料'),
  ('attendance_admin', 'update', '維護考勤規則與執行審核'),
  ('payroll_admin', 'read', '查看薪資批次與設定'),
  ('payroll_admin', 'update', '執行薪資計算與發薪')
ON CONFLICT ("resource", "action") DO UPDATE
SET "description" = EXCLUDED."description";

INSERT INTO "roles" ("code", "name", "description", "hierarchy_level")
VALUES
  ('EMPLOYEE', 'EMPLOYEE', '一般員工，預設只可查看自己的資料與進行自助作業', 5)
ON CONFLICT ("code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "hierarchy_level" = EXCLUDED."hierarchy_level";

WITH role_permission_matrix AS (
  SELECT 'SUPER_ADMIN'::text AS role_code, 'access_control'::text AS resource, 'read'::text AS action UNION ALL
  SELECT 'SUPER_ADMIN', 'access_control', 'update' UNION ALL
  SELECT 'SUPER_ADMIN', 'purchase_orders', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'purchase_orders', 'create' UNION ALL
  SELECT 'SUPER_ADMIN', 'inventory', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'inventory', 'update' UNION ALL
  SELECT 'SUPER_ADMIN', 'banking', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'banking', 'update' UNION ALL
  SELECT 'SUPER_ADMIN', 'reports', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'attendance_self', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'leave_self', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'payroll_self', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'payroll_self_breakdown', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'profile_self', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'employees_admin', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'employees_admin', 'update' UNION ALL
  SELECT 'SUPER_ADMIN', 'attendance_admin', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'attendance_admin', 'update' UNION ALL
  SELECT 'SUPER_ADMIN', 'payroll_admin', 'read' UNION ALL
  SELECT 'SUPER_ADMIN', 'payroll_admin', 'update' UNION ALL

  SELECT 'ADMIN', 'access_control', 'read' UNION ALL
  SELECT 'ADMIN', 'access_control', 'update' UNION ALL
  SELECT 'ADMIN', 'purchase_orders', 'read' UNION ALL
  SELECT 'ADMIN', 'purchase_orders', 'create' UNION ALL
  SELECT 'ADMIN', 'inventory', 'read' UNION ALL
  SELECT 'ADMIN', 'inventory', 'update' UNION ALL
  SELECT 'ADMIN', 'banking', 'read' UNION ALL
  SELECT 'ADMIN', 'banking', 'update' UNION ALL
  SELECT 'ADMIN', 'reports', 'read' UNION ALL
  SELECT 'ADMIN', 'attendance_self', 'read' UNION ALL
  SELECT 'ADMIN', 'leave_self', 'read' UNION ALL
  SELECT 'ADMIN', 'payroll_self', 'read' UNION ALL
  SELECT 'ADMIN', 'payroll_self_breakdown', 'read' UNION ALL
  SELECT 'ADMIN', 'profile_self', 'read' UNION ALL
  SELECT 'ADMIN', 'employees_admin', 'read' UNION ALL
  SELECT 'ADMIN', 'employees_admin', 'update' UNION ALL
  SELECT 'ADMIN', 'attendance_admin', 'read' UNION ALL
  SELECT 'ADMIN', 'attendance_admin', 'update' UNION ALL
  SELECT 'ADMIN', 'payroll_admin', 'read' UNION ALL
  SELECT 'ADMIN', 'payroll_admin', 'update' UNION ALL

  SELECT 'ACCOUNTANT', 'access_control', 'read' UNION ALL
  SELECT 'ACCOUNTANT', 'attendance_self', 'read' UNION ALL
  SELECT 'ACCOUNTANT', 'leave_self', 'read' UNION ALL
  SELECT 'ACCOUNTANT', 'payroll_self', 'read' UNION ALL
  SELECT 'ACCOUNTANT', 'payroll_self_breakdown', 'read' UNION ALL
  SELECT 'ACCOUNTANT', 'profile_self', 'read' UNION ALL
  SELECT 'ACCOUNTANT', 'reports', 'read' UNION ALL
  SELECT 'ACCOUNTANT', 'banking', 'read' UNION ALL
  SELECT 'ACCOUNTANT', 'attendance_admin', 'read' UNION ALL
  SELECT 'ACCOUNTANT', 'payroll_admin', 'read' UNION ALL

  SELECT 'OPERATOR', 'attendance_self', 'read' UNION ALL
  SELECT 'OPERATOR', 'leave_self', 'read' UNION ALL
  SELECT 'OPERATOR', 'payroll_self', 'read' UNION ALL
  SELECT 'OPERATOR', 'payroll_self_breakdown', 'read' UNION ALL
  SELECT 'OPERATOR', 'profile_self', 'read' UNION ALL
  SELECT 'OPERATOR', 'purchase_orders', 'read' UNION ALL
  SELECT 'OPERATOR', 'purchase_orders', 'create' UNION ALL
  SELECT 'OPERATOR', 'inventory', 'read' UNION ALL
  SELECT 'OPERATOR', 'inventory', 'update' UNION ALL

  SELECT 'EMPLOYEE', 'attendance_self', 'read' UNION ALL
  SELECT 'EMPLOYEE', 'leave_self', 'read' UNION ALL
  SELECT 'EMPLOYEE', 'payroll_self', 'read' UNION ALL
  SELECT 'EMPLOYEE', 'payroll_self_breakdown', 'read' UNION ALL
  SELECT 'EMPLOYEE', 'profile_self', 'read'
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM role_permission_matrix rpm
JOIN "roles" r ON r.code = rpm.role_code
JOIN "permissions" p ON p.resource = rpm.resource AND p.action = rpm.action
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
