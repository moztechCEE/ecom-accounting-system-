CREATE TABLE performance_cycles (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  title TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT performance_cycles_valid_period CHECK (period_start <= period_end),
  CONSTRAINT performance_cycles_entity_period_unique UNIQUE (entity_id, period_start, period_end)
);
CREATE INDEX performance_cycles_entity_created_idx ON performance_cycles(entity_id, created_at);

CREATE TABLE performance_reviews (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES performance_cycles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  subject_employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  reviewer_employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  score INTEGER,
  goals TEXT,
  comment TEXT,
  submitted_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT performance_reviews_distinct_people CHECK (subject_employee_id <> reviewer_employee_id),
  CONSTRAINT performance_reviews_valid_score CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  CONSTRAINT performance_reviews_valid_status CHECK (
    (status = 'DRAFT' AND submitted_at IS NULL) OR
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL AND score IS NOT NULL)
  ),
  CONSTRAINT performance_reviews_cycle_subject_unique UNIQUE (cycle_id, subject_employee_id)
);
CREATE INDEX performance_reviews_reviewer_status_idx ON performance_reviews(reviewer_employee_id, status);
CREATE INDEX performance_reviews_subject_idx ON performance_reviews(subject_employee_id);

-- Catalog and opt-in templates. Existing user assignments are not changed.
INSERT INTO permissions (id, resource, action, description, created_at)
VALUES
  (gen_random_uuid()::text, 'product_cost', 'read', '查看產品採購與庫存成本', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'product_cost', 'update', '維護產品採購與庫存成本', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'financial_margin', 'read', '查看銷售毛利', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'financial_net_profit', 'read', '查看估算與正式淨利', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'employee_compensation', 'read', '查看員工薪資與薪酬設定', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'employee_compensation', 'update', '維護員工薪資與薪酬設定', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'performance_reviews', 'read', '查看被指派的考核', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'performance_reviews', 'write', '填寫並送出被指派的考核', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'performance_reviews', 'manage', '建立考核週期與指派評核人', CURRENT_TIMESTAMP)
ON CONFLICT (resource, action) DO NOTHING;

INSERT INTO roles (id, code, name, description, hierarchy_level, created_at)
VALUES
  (gen_random_uuid()::text, 'PERFORMANCE_REVIEWER', '主管考核', '僅可填寫與送出指派給自己的考核；不含薪資。', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PERFORMANCE_HR', '人資考核管理', '建立考核週期與指派評核人；不含薪資。', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PROCUREMENT_COST', '採購成本作業', '查看及建立採購單與產品成本；不含薪資及公司淨利。', 3, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE
  (r.code IN ('SUPER_ADMIN', 'ADMIN') AND (
    p.resource IN ('product_cost', 'financial_margin', 'financial_net_profit', 'employee_compensation', 'performance_reviews')
  )) OR
  (r.code = 'ACCOUNTANT' AND (
    (p.resource = 'product_cost' AND p.action = 'read') OR
    (p.resource IN ('financial_margin', 'financial_net_profit') AND p.action = 'read') OR
    (p.resource = 'employee_compensation' AND p.action = 'read')
  )) OR
  (r.code = 'PERFORMANCE_REVIEWER' AND p.resource = 'performance_reviews' AND p.action IN ('read', 'write')) OR
  (r.code = 'PERFORMANCE_HR' AND p.resource = 'performance_reviews' AND p.action IN ('read', 'manage')) OR
  (r.code = 'PROCUREMENT_COST' AND (
    (p.resource = 'purchase_orders' AND p.action IN ('read', 'create')) OR
    (p.resource = 'inventory' AND p.action = 'read') OR
    (p.resource = 'product_cost' AND p.action IN ('read', 'update'))
  ))
ON CONFLICT DO NOTHING;
