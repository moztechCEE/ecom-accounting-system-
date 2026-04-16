ALTER TABLE "leave_types"
ADD COLUMN "balance_reset_policy" TEXT NOT NULL DEFAULT 'CALENDAR_YEAR',
ADD COLUMN "allow_carry_over" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "carry_over_limit_hours" DECIMAL(6,2) NOT NULL DEFAULT 0;

ALTER TABLE "leave_balances"
ADD COLUMN "period_start" TIMESTAMP(3),
ADD COLUMN "period_end" TIMESTAMP(3),
ADD COLUMN "manual_adjustment_hours" DECIMAL(6,2) NOT NULL DEFAULT 0;

UPDATE "leave_balances"
SET
  "period_start" = make_date("year", 1, 1)::timestamp,
  "period_end" = (make_date("year", 12, 31) + interval '23 hours 59 minutes 59 seconds')::timestamp
WHERE "period_start" IS NULL OR "period_end" IS NULL;

ALTER TABLE "leave_balances"
ALTER COLUMN "period_start" SET NOT NULL,
ALTER COLUMN "period_end" SET NOT NULL;
