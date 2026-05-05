ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "employee_data_scope" TEXT NOT NULL DEFAULT 'SELF',
ADD COLUMN IF NOT EXISTS "attendance_data_scope" TEXT NOT NULL DEFAULT 'SELF',
ADD COLUMN IF NOT EXISTS "payroll_data_scope" TEXT NOT NULL DEFAULT 'SELF';

UPDATE "users"
SET
  "employee_data_scope" = 'ENTITY',
  "attendance_data_scope" = 'ENTITY',
  "payroll_data_scope" = 'ENTITY'
WHERE id IN (
  SELECT ur.user_id
  FROM "user_roles" ur
  JOIN "roles" r ON r.id = ur.role_id
  WHERE r.code IN ('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
);
