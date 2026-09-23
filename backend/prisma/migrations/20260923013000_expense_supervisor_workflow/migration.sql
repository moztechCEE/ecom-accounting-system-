-- Do not guess reporting lines or silently discard existing payment tasks.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM payment_tasks WHERE expense_request_id IS NOT NULL GROUP BY expense_request_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate expense payment tasks require accounting review before expense workflow migration';
  END IF;
END $$;
ALTER TABLE employees ADD COLUMN supervisor_employee_id TEXT;
ALTER TABLE employees ADD CONSTRAINT employees_supervisor_employee_id_fkey FOREIGN KEY (supervisor_employee_id) REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE employees ADD CONSTRAINT employees_no_self_supervisor CHECK (supervisor_employee_id IS NULL OR supervisor_employee_id <> id);
CREATE UNIQUE INDEX payment_tasks_expense_request_id_key ON payment_tasks(expense_request_id);

-- Optional role templates. No user_roles or existing user scope is changed.
INSERT INTO permissions (id,resource,action,description)
VALUES ('expense-self-read','expense_self','read','自己的費用申請與被指派的主管審批'),
       ('expense-self-create','expense_self','create','建立自己的費用申請'),
       ('expense-cashier-accounts-read','accounts','read','讀取授權範圍內的費用與應付資料'),
       ('expense-cashier-banking-read','banking','read','讀取被授權的銀行帳戶'),
       ('expense-cashier-banking-update','banking','update','登記已實際完成的付款')
ON CONFLICT (resource,action) DO NOTHING;
WITH created_templates AS (
INSERT INTO roles (id,code,name,description,hierarchy_level)
VALUES ('expense-employee-template','EXPENSE_EMPLOYEE','費用申請與主管審批','員工申請自己的費用；主管僅可審批被指派的申請。需另外設定公司及直屬主管。',3),
       ('expense-cashier-template','CASHIER','出納費用付款登記','登記已實際完成的費用付款；需另外設定公司、會計與出納資料範圍及銀行帳戶可見名單。',3)
ON CONFLICT (code) DO NOTHING
RETURNING id,code
)
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM created_templates r CROSS JOIN permissions p
WHERE (r.code IN ('EXPENSE_EMPLOYEE','CASHIER') AND p.resource='expense_self' AND p.action IN ('read','create'))
OR (r.code='CASHIER' AND ((p.resource='accounts' AND p.action='read') OR (p.resource='banking' AND p.action IN ('read','update'))))
ON CONFLICT DO NOTHING;
