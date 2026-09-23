-- Existing role/permission APIs require UUID identifiers. Existing links cascade.
UPDATE roles SET id='40802214-42f3-5dfd-94d1-1a6c098d63c5' WHERE id='warehouse-picker';
UPDATE roles SET id='13c95b0c-4535-55b8-b35f-16aa8b00a77a' WHERE id='warehouse-packer';
UPDATE roles SET id='d2b46ac0-32c8-54a3-af73-de244a445d26' WHERE id='warehouse-operator';
UPDATE permissions SET id='d085a4ba-756e-5471-88a2-1faef20adaf7' WHERE id='warehouse-expense-self-read';
UPDATE permissions SET id='26d49bea-6a51-5f16-90dd-6149812e621a' WHERE id='warehouse-expense-self-create';
