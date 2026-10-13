-- Separate assignable capability: never implicitly grant technicians or employees.
INSERT INTO permissions (id, resource, action, description, created_at)
VALUES ('repair_workbench-manage', 'repair_workbench', 'manage', '審核產品檢測標準與設備校正證明', CURRENT_TIMESTAMP)
ON CONFLICT (resource, action) DO NOTHING;
