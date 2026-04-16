-- AlterTable
ALTER TABLE "payroll_runs"
ADD COLUMN "bank_account_id" TEXT,
ADD COLUMN "paid_at" TIMESTAMP(3),
ADD COLUMN "paid_by" TEXT;

-- AddForeignKey
ALTER TABLE "payroll_runs"
ADD CONSTRAINT "payroll_runs_bank_account_id_fkey"
FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs"
ADD CONSTRAINT "payroll_runs_paid_by_fkey"
FOREIGN KEY ("paid_by") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
