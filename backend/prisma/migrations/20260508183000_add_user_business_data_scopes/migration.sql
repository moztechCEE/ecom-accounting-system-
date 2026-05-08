ALTER TABLE "users"
  ADD COLUMN "accounting_data_scope" TEXT NOT NULL DEFAULT 'SELF',
  ADD COLUMN "inventory_data_scope" TEXT NOT NULL DEFAULT 'SELF',
  ADD COLUMN "sales_data_scope" TEXT NOT NULL DEFAULT 'SELF',
  ADD COLUMN "purchasing_data_scope" TEXT NOT NULL DEFAULT 'SELF',
  ADD COLUMN "banking_data_scope" TEXT NOT NULL DEFAULT 'SELF';
