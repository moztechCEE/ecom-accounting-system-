-- Explicit opt-in only: do not infer supervisors from titles or existing reports.
ALTER TABLE employees ADD COLUMN is_department_supervisor boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD CONSTRAINT employee_supervisor_department_required CHECK (NOT is_department_supervisor OR department_id IS NOT NULL);
ALTER TABLE departments ADD COLUMN member_role_id text REFERENCES roles(id) ON DELETE RESTRICT;
ALTER TABLE departments ADD COLUMN supervisor_role_id text REFERENCES roles(id) ON DELETE RESTRICT;
INSERT INTO permissions (id,resource,action,description,created_at)
VALUES (gen_random_uuid()::text,'attendance_team','read','查看本部門出勤與請假',NOW()),
(gen_random_uuid()::text,'attendance_team','review','審核本部門請假',NOW())
ON CONFLICT (resource,action) DO NOTHING;
