-- Rename the existing role and clarify its existing permissions only.
-- No role links, employee assignments or department bindings change here.
UPDATE roles SET name = '維修師' WHERE code = 'REPAIR_TECHNICIAN';

UPDATE permissions
SET description = '查看同公司維修案件、待認領物件與維修歷程'
WHERE resource = 'repair_workbench' AND action = 'read';

UPDATE permissions
SET description = '認領、本人簽收及填寫本人檢修與維修紀錄'
WHERE resource = 'repair_workbench' AND action = 'update';
